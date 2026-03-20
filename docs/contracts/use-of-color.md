# Color Contract

## Philosophy

Color communicates **instrument group identity only**. Three hue families, one per section. Within each family, tracks differentiate by hue shift, never by dropping brightness. The dimmest shade in any family must remain clearly visible against the background.

## Background

`#18181D`

## Color Families

### Percussion — warm amber/orange

| Track | Active | Bright (playhead hit) | Idle (filled step) | Grid (empty step) |
|-------|--------|-----------------------|--------------------|--------------------|
| Kick | `#F5C04E` | `#FFDA6E` | `rgba(245,192,78,0.75)` | `rgba(245,192,78,0.14)` |
| Snare | `#EEA83E` | `#FFC258` | `rgba(238,168,62,0.70)` | `rgba(238,168,62,0.12)` |
| Closed Hat | `#E49432` | `#F8AE4C` | `rgba(228,148,50,0.65)` | `rgba(228,148,50,0.11)` |
| Open Hat | `#DA822A` | `#EE9C44` | `rgba(218,130,42,0.60)` | `rgba(218,130,42,0.10)` |
| Crash | `#D07224` | `#E48C3E` | `rgba(208,114,36,0.55)` | `rgba(208,114,36,0.09)` |

### Melodic — cool blue-violet

| Track | Active | Bright (playhead hit) | Idle (filled step) | Grid (empty step) |
|-------|--------|-----------------------|--------------------|--------------------|
| Synth 1 | `#A0B4FF` | `#BCC8FF` | `rgba(160,180,255,0.70)` | `rgba(160,180,255,0.10)` |
| Synth 2 | `#8C9CF0` | `#A8B4FF` | `rgba(140,156,240,0.62)` | `rgba(140,156,240,0.09)` |
| Synth 3 | `#7C8AE2` | `#96A2F6` | `rgba(124,138,226,0.55)` | `rgba(124,138,226,0.08)` |

### Samples — teal

| Track | Active | Bright (playhead hit) | Idle (filled step) | Grid (empty step) |
|-------|--------|-----------------------|--------------------|--------------------|
| Sample 1 | `#5CDCC8` | `#7AEEDA` | `rgba(92,220,200,0.70)` | `rgba(92,220,200,0.11)` |
| (future) | `#4CC8B4` | `#66DCC8` | `rgba(76,200,180,0.62)` | `rgba(76,200,180,0.10)` |

## Step Cell States

1. **Empty, off-beat**: `rgba(255,255,255,0.025)` — barely visible grid texture
2. **Empty, on-beat** (every 4th step from 0): `rgba(255,255,255,0.06)` — subtle pulse grid
3. **Empty, playhead passing**: `rgba(255,255,255,0.12)` — playhead sweep
4. **Filled, normal**: track's idle color
5. **Filled, playhead hit**: track's bright color + glow: `box-shadow: 0 0 16px [bright]80, 0 0 6px [active]60`

## Color in Controls

### Track indicator strip
3px wide, left of track name. Uses track's active color. Full opacity when selected, 0.7 when not.

### Aux sends (sidebar)
Each send row gets a 3px indicator strip using the corresponding track's active color at 0.9 opacity. Slider is monochrome: `rgba(255,255,255,0.10)` track, `rgba(255,255,255,0.25)` fill. Color only identifies which track, never decorates the control.

### Effect panel sliders
Entirely monochrome. No track color. Track `rgba(255,255,255,0.10)`, fill `rgba(255,255,255,0.38)`, knob border `rgba(255,255,255,0.55)`.

### Selected track state
Background `rgba(255,255,255,0.04)`, track name `#eee` weight 600, indicator strip full opacity. Nothing else changes.

## Text Hierarchy

| Element | Color | Size | Weight | Spacing |
|---------|-------|------|--------|---------|
| Section label (PERCUSSION, MELODIC, SAMPLES) | `#606068` | 9px | — | 0.14em |
| Track name (selected) | `#eee` | — | 600 | — |
| Track name (unselected) | `#999` | — | 400 | — |
| Track secondary label | `#58585F` | — | — | — |
| Sidebar heading | `#bbb` | — | — | — |
| Sidebar subhead | `#666` | — | — | — |
| Param label | `#999` | — | — | — |
| Param value | `#ddd` | — | — | — |
| Aux send name | `#999` | — | — | — |
| Aux send value | `#777` | — | — | — |
| Bar markers | `#666` | — | — | — |
| BPM label | `#777` | — | — | — |
| BPM input value | `#ddd` | — | — | — |

## Adding Future Tracks

Pick the next hue step within the family. Rules:

- Active color lightness must stay **above L=55** in HSL
- Idle opacity must stay **above 0.50**
- If more than 5 tracks in a family, wrap the hue range tighter rather than dropping brightness
