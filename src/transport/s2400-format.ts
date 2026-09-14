/** Native record layout observed in Project002; see docs/s2400-export.md for provenance. */
export interface S2400Track {
  index: number;
  name: string;
  frames: number;
  channels: number;
  level: number;
  muted: boolean;
}
export interface S2400Pattern {
  phrase: number;
  steps: boolean[][];
}

class Records {
  private parts: Uint8Array[] = [];
  private record(type: number, id: number, value: number, blob?: Uint8Array): void {
    const bytes = new Uint8Array(7 + (blob?.length ?? 0));
    const view = new DataView(bytes.buffer);
    view.setUint8(0, type);
    view.setUint16(1, id, true);
    view.setUint32(3, value >>> 0, true);
    if (blob) bytes.set(blob, 7);
    this.parts.push(bytes);
  }
  u(id: number, value: number): void {
    this.record(1, id, value);
  }
  i(id: number, value: number): void {
    this.record(2, id, value);
  }
  b(id: number, bytes: Uint8Array): void {
    this.record(3, id, bytes.length, bytes);
  }
  fields(values: readonly (readonly [number, number])[]): void {
    for (const [id, value] of values) this.u(id, value);
  }
  string(id: number, text: string, size = text.length + 1): void {
    const bytes = new Uint8Array(size);
    bytes.set(new TextEncoder().encode(text).subarray(0, size - 1));
    this.b(id, bytes);
  }
  finish(): Uint8Array {
    const bytes = new Uint8Array(this.parts.reduce((sum, part) => sum + part.length, 0));
    let offset = 0;
    for (const part of this.parts) {
      bytes.set(part, offset);
      offset += part.length;
    }
    return bytes;
  }
}

export function buildS2400Kit(tracks: S2400Track[]): Uint8Array {
  const r = new Records();
  r.fields([
    [0, 0x20002],
    [1, tracks.length],
    [58, 1],
  ]);
  for (const track of tracks) {
    const end = track.frames - 1;
    r.fields([
      [2, track.index],
      [3, 0x5e9fff],
      [4, 0],
      [5, track.channels === 2 ? 1 : 0],
      [59, 0],
      [64, 0],
      [6, 0],
      [7, 1],
      [8, track.channels === 2 ? 3 : 1],
      [36, 2],
      [37, 1],
      [49, 0],
      [57, 0],
      [55, 0],
      [52, 0],
      [56, 0],
    ]);
    r.i(53, 0);
    r.i(60, 0);
    r.string(10, track.name);
    for (let slot = 0; slot < 9; slot++) {
      r.fields([
        [11, slot],
        [12, track.level],
        [13, 32],
        [54, 20000],
        [15, 0],
        [35, 0],
      ]);
      r.i(61, 0);
      r.fields([
        [17, 0],
        [18, end],
        [19, end],
        [51, end],
        [34, 0],
        [50, 0],
      ]);
      for (let envelope = 0; envelope < 2; envelope++) {
        r.fields([
          [42, envelope],
          [43, 0],
          [44, 0],
          [45, 0],
          [46, 1023],
          [47, 1023],
          [48, 0],
        ]);
        r.b(40, new Uint8Array(2));
        r.b(41, new Uint8Array(2));
      }
    }
  }
  for (let id = 20; id <= 33; id++) r.u(id, id < 26 ? 0 : 127);
  return r.finish();
}

export function buildS2400Project(
  tracks: S2400Track[],
  patterns: S2400Pattern[],
  tempo: number,
): Uint8Array {
  const r = new Records();
  let muteMask = 0xffffffff;
  for (const track of tracks) if (!track.muted) muteMask &= ~(1 << track.index);
  // Unknown fields retain neutral values from the device-saved fixture. This is not a Song-mode writer.
  r.fields([
    [0, 0x30003],
    [1, 8],
    [2, 1],
    [3, 0],
    [4, Math.round(tempo * 10)],
    [5, 24],
    [34, 0],
    [33, muteMask],
    [102, 0],
    [101, 0xffffffff],
    [49, 1],
    [36, 0],
    [40, 8],
    [87, 8],
    [88, 1],
    [89, 1],
  ]);
  for (const [id, value] of [
    [39, 0],
    [42, 1],
    [43, 1],
    [44, 1],
    [45, 255],
    [86, 0],
  ] as const)
    r.b(id, new Uint8Array(8).fill(value));
  r.b(80, new Uint8Array([32, 78, 32, 78, 32, 78, 32, 78, 32, 78, 32, 78, 32, 78, 32, 78]));
  for (const id of [47, 61, 83]) r.b(id, new Uint8Array(8));
  r.b(74, new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]));
  for (const [id, value] of [
    [90, 2],
    [100, 0],
    [91, 1],
    [92, 3],
  ] as const)
    r.b(id, new Uint8Array(8).fill(value));
  for (let track = 0; track < 32; track++) {
    r.fields([
      [8, track],
      [10, 24],
      [11, 0],
      [79, 0],
      [12, 0],
      [13, 255],
      [98, 0],
      [99, 0],
      [103, 7],
      [14, 0],
      [15, 0],
    ]);
    r.i(78, 0);
    r.i(77, -904);
    r.i(76, 0);
    r.fields([
      [93, 0],
      [94, 0],
      [95, 0],
    ]);
    for (let slot = 0; slot < 9; slot++) {
      r.fields([
        [75, slot],
        [52, 0],
        [84, 0],
        [50, 0],
        [51, 0],
        [85, 0],
        [96, [60, 62, 64, 65, 67, 69, 71, 72, 60][slot]!],
        [97, 127],
      ]);
    }
  }
  patterns.forEach((pattern, index) => {
    const words: number[] = [];
    const seen = new Set<number>();
    for (let step = 0; step < 64; step++) {
      for (const track of tracks) {
        if (!pattern.steps[track.index]?.[step]) continue;
        const first = !seen.has(track.index);
        // 96 PPQN, sixteen steps/bar. Main slice = 8; first hit initializes sample end.
        words.push(
          ((step * 24) << 16) | ((first ? 1 : 0) << 11) | (8 << 7) | (track.index << 1) | 1,
        );
        if (first) words.push(((track.frames - 1) << 8) | 8);
        seen.add(track.index);
      }
    }
    r.fields([
      [16, index + 1],
      [73, 0],
      [17, 1536],
      [18, 384],
      [19, 4],
      [20, 4],
      [82, 0],
      [81, 48],
      [21, words.length],
    ]);
    r.string(22, `Phrase ${String(pattern.phrase).padStart(2, '0')}`, 22);
    const bytes = new Uint8Array(words.length * 4);
    const view = new DataView(bytes.buffer);
    words.forEach((word, i) => view.setUint32(i * 4, word >>> 0, true));
    r.b(23, bytes);
  });
  r.u(59, 1);
  return r.finish();
}

/** Device-default MIDI track settings (manual pp. 86–88 and the supplied Project002 map). */
export function buildS2400MidiMap(): Uint8Array {
  const lines = [
    '; S2400 MIDI TRACKS MAP',
    '',
    '[ports]',
    'in-din=0',
    'in-usb-b=0',
    'in-usb-host=1',
    'in-dsp-card=0',
    'out-din=1',
    'out-usb-b=1',
    'out-usb-host=0',
    'out-dsp-card=0',
    '',
  ];
  const colors = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'CYAN', 'BLUE', 'PURPLE', 'VIOLET'];
  for (let channel = 1; channel <= 16; channel++) {
    // The device default leaves F2/channel 10 unconfigured for percussion.
    if (channel === 10) continue;
    const pad = ((channel - 1) % 8) + 1;
    const name = `${channel <= 8 ? 'E' : 'F'}${pad}`;
    const color = colors[channel <= 8 ? pad - 1 : (pad + 6) % 8]!;
    lines.push(
      `[${name}]`,
      `name=${name}`,
      `channel=${channel}`,
      `color=${color}`,
      'pad-mode=PITCHED',
      'pad-channel=TRACK',
      'pad-dynamic=0',
      'pad-root-note=C',
      'pad-scale=Chromatic',
      'a-mode=OFF',
      'b-mode=OFF',
      'mute-mode=MUTE',
      'solo-mode=SOLO',
    );
    for (const [control, number] of [
      ['fader', 7],
      ['top', 74],
      ['bottom', 71],
    ] as const) {
      lines.push(
        `${control}-mode=CC`,
        `${control}-channel=TRACK`,
        `${control}-number=${number}`,
        `${control}-min=0`,
        `${control}-max=127`,
      );
    }
    lines.push(
      'record=0',
      `rec-group=${pad}`,
      'swing-note=PATTERN',
      'swing-amount=PATTERN',
      'quant-time=DEFAULT',
      'quant-shift=0',
      '',
    );
  }
  return new TextEncoder().encode(lines.join('\r\n') + '\r\n');
}
