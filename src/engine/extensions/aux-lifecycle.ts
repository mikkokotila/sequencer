/** Own delayed stop restoration and processor reset acknowledgements for aux effects. */
import { on, off } from '../../events';

export interface AuxLifecycle {
  readonly ready: boolean;
  update(): void;
  stop: () => void;
  dispose(): void;
}

export function createAuxLifecycle(
  ctx: BaseAudioContext,
  wet: GainNode,
  processor: AudioWorkletNode,
  enabled: () => boolean,
  apply: () => void,
  silenceFeedback: () => void,
  fadeSeconds: number,
): AuxLifecycle {
  // A fresh offline graph has no processor history or live transport lifecycle.
  // Apply before rendering: asynchronous reset acknowledgements would otherwise
  // race the first notes and make a bounce depend on main-thread timing.
  if (ctx instanceof OfflineAudioContext) {
    return {
      ready: true,
      update(): void {
        wet.gain.value = 0;
        if (enabled()) apply();
        else silenceFeedback();
      },
      stop(): void {
        wet.gain.value = 0;
        silenceFeedback();
      },
      dispose(): void {
        wet.gain.value = 0;
      },
    };
  }
  let generation = 0;
  let pendingRestore: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ready = false;
  let disposed = false;

  function cancel(): void {
    generation++;
    pendingRestore = null;
    ready = false;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    wet.gain.cancelScheduledValues(0);
  }
  function reset(restore: boolean): void {
    wet.gain.value = 0;
    silenceFeedback();
    pendingRestore = restore ? generation : null;
    processor.port.postMessage({ type: 'reset', generation });
  }
  function update(): void {
    if (disposed) return;
    cancel();
    reset(enabled());
  }
  function acknowledged(event: MessageEvent<unknown>): void {
    const message = event.data;
    if (
      !message ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'reset' ||
      !('generation' in message)
    )
      return;
    if (disposed || !enabled() || pendingRestore === null || message.generation !== pendingRestore)
      return;
    pendingRestore = null;
    ready = true;
    apply();
  }
  processor.port.addEventListener('message', acknowledged);
  processor.port.start();
  on('engine:start', update);

  return {
    get ready() {
      return ready;
    },
    update,
    stop(): void {
      if (disposed) return;
      cancel();
      if (!enabled()) {
        reset(false);
        return;
      }
      const current = generation;
      silenceFeedback();
      wet.gain.setValueAtTime(wet.gain.value, ctx.currentTime);
      wet.gain.linearRampToValueAtTime(0, ctx.currentTime + fadeSeconds);
      timer = setTimeout(
        () => {
          if (disposed || current !== generation || !enabled()) return;
          timer = null;
          wet.gain.cancelScheduledValues(0);
          reset(true);
        },
        fadeSeconds * 1000 + 150,
      );
    },
    dispose(): void {
      cancel();
      disposed = true;
      wet.gain.value = 0;
      processor.port.removeEventListener('message', acknowledged);
      off('engine:start', update);
    },
  };
}
