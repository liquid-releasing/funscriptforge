
## Enhancement System

Enhancements are **composable, multi-axis effects** applied to the generated
output channel files at specific timecodes. They are NOT funscript transforms
— they operate on alpha, beta, volume, pulse_frequency, pulse_width, and
frequency channels AFTER `cli.process()` generates them.

Each event is a sequence of operations:
- `apply_linear_change` — linear ramp on an axis (with ramp_in/ramp_out)
- `apply_modulation` — sinusoidal/waveform modulation on an axis

Events don't rebuild the funscript — they **enhance** it. The baseline channels
carry the funscript's intent; events layer additional sensation on top
(additive mode is the default for most events).

Events are **composable**: multiple events at the same timecode hit different axes. Edge builds tension on volume/pulse, freq_shift changes texture, pulse_wobble changes feel — all stackable.

### Processing order

```
cli.process()        → generates baseline channel files
process_events()     → modifies those files at phrase timecodes
                       (reads .events.yml, applies to channel .funscript files)
```

Sequential, not separate. Events enhance the generated channels — they layer on top of the baseline, they don't replace it.

### Enchantments (ship with FunScriptForge)

Ten enchantments ship with FunScriptForge — the General events from funscript-tools v2.2.0. These are NOT funscript transforms — Tone shapes
the funscript, Enchantments layer sensation onto the output channels.

They operate on completely different things and never conflict.

Three families:

**Buzz family** — modulate volume + pulse to create intensity effects:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Cum** | Release — high pulse, slow 1.5Hz throb, wide pulse sweep | volume_boost: +0.2, pulse_freq: 90→80 | additive |
| **Edge** | Tension build — pulse ramp, 10Hz volume buzz | volume_boost: +0.15, pulse_freq: 40→50 | additive |
| **Stay** | Hold — locked high pulse, subtle 15Hz hum | volume_boost: +0.1, pulse_freq: +80 | additive |

**Stroke family** — modulate alpha (spatial movement) + volume:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Slow** | Pull back — quarter-speed alpha, volume reduction | stroke_freq: 0.25, volume_boost: -0.1 | additive |
| **Medium** | Neutral — moderate movement, no volume change | stroke_freq: 1.0, volume_boost: 0.0 | additive |
| **Fast** | Speed up — fast alpha, volume push | stroke_freq: 2.0, volume_boost: +0.03 | additive |
| **Lube** | Ease off — gentle movement, pull back intensity | stroke_freq: 0.5, volume_boost: -0.1 | additive |

**Control family** — overwrite or gently shape the signal:

| Enchantment | Feel | Key params | Mode |
|---|---|---|---|
| **Ruin** | Kill — volume to zero, 10s ramp recovery | duration: 30s, ramp_in: 10s | overwrite |
| **Stop** | Floor — volume to minimum, hold | duration: 30s, vol: 0.05→0.1 | overwrite |
| **Tranquil** | Breathe — gentle 15Hz volume oscillation | duration: 20s, osc_amplitude: 0.5 | additive |

### User controls per enchantment

Only one slider in our UI:

- **Intensity** — scales volume_boost / buzz_intensity / stroke_intensity proportionally (maps to the right params behind the scenes)

Event Time comes from the video player position — no typing.

### Why these don't duplicate Tone

Tone operates on the **funscript** (position data, timing, rhythm).
Enhancements operate on the **output channels** (volume, pulse_frequency,
frequency, pulse_width, alpha, beta). Different layers entirely.

A phrase can have Tone "Gentle" AND Enhancement "Edge" — Tone shapes the
stroke pattern, Edge layers tension onto the electrical channels. No conflict.

### Advanced event library (gateway to funscript-tools)

The full catalog (30+ events including MCB and Clutch libraries by
AquariumParrot) lives in funscript-tools. Power users can access them
through edger's Custom Event Builder:

> "Want more enhancements? funscript-tools has 30+ events including
> reverse-engineered effects from MCB and Clutch hardware.
> [Link to funscript-tools]"

We are the gateway. Power users graduate to the full toolkit.

### Our own yml is an import artifact

i found through experiments, that I like the idea of figuring out duration and describe what is happening. We don't really need a video editor for that. we can send the user off to do homework and return with:

Starting time, ending time, what is happening.

my format looks like this to set durations:

```text
beg time
normal
next time
excitement
next time
excitement
next time
sound ramp
next time
normal
...
end time
```

### The `.events.yml` is an export artifact

We export the generated `.events.yml` alongside the channel files in the
output folder. It's human-readable YAML. The user can:

1. **Edit by hand** — tweak timing, swap events, adjust params
2. **Open in edger's Custom Event Builder** — full visual editor with
   access to all 30+ events, parameter controls, timeline view
3. **Re-run `process_events()`** — apply their changes without re-exporting

This is the graduation path. We make it easy, the YAML makes it portable,
edger's tools make it powerful. The user's work isn't locked in our UI.

### Event catalog visualization

Each event is deterministic math — `apply_linear_change` and `apply_modulation`
with known parameters. We render previews directly from the YAML definitions
without touching any funscript data.

```
┌─────────────────────────────────────────┐
│  Edge                                   │
│  "Builds tension across multiple        │
│   channels simultaneously"              │
│                                         │
│  pulse_freq   ╱‾‾‾‾‾‾‾‾‾‾‾             │
│  volume       ∿∿∿∿∿∿∿∿∿∿∿∿             │
│  pulse_width  ∿∿∿∿∿∿∿∿∿∿∿∿             │
│                                         │
│  Duration: 15s    Mode: additive        │
│  Axes: pulse_frequency, volume,         │
│        volume-prostate, pulse_width     │
└─────────────────────────────────────────┘
```

Each catalog card shows:
- **Name + description** — what it feels like
- **Matplotlib mini-charts** per axis it touches (fixed x = 0 to duration, fixed y = 0 to 1)
- **Duration and mode** (additive vs overwrite)
- **Axes affected** — so user knows what channels change

Previews generate automatically from YAML. If edger adds a new event, the
preview renders without code changes.

### Event axis coverage

No single event is comprehensive — they're surgical by design:

| Event | pulse_freq | volume | alpha | beta | frequency | pulse_width |
|---|---|---|---|---|---|---|
| edge | X | X | | | | X |
| freq_shift | | | | | X | |
| pulse_wobble | | | | | | X |
| mcb_edge_ce | X | X | X | X | | |

This is the composability model. Stack events to cover more axes.

## Enchantment Tab (new tab, after Stim)

### Purpose

Point-in-time enchantment placement. The user watches the video within a
phrase, stops at the moment something happens, and drops an enchantment
on that exact timecode. Enchantments are moments, not phrase-wide blankets.

This feature is about micro-updates within a phrase — not about the full funscript. The UI is scoped tight to keep focus.

### Layout

Under my new framing, user inputs without a video player, although that whole process is a lot of copy and paste in mpv.

So your complete workflow is:

0. start at the beginning phrase.
1. Play the video
2. When you find a point of interest, pause and adjust. use Ctrl+Right/Left to step frame-by-frame
3. User clicks to enter a start time. 
4. User plays video, finds a point of interest, pause and adjust. 
5. User clicks end time. (This sets the duration)
6. User selects Enchantment from catalog. Clicks [+Add]
7. when user gets to end of phrase, click NEXT to start the next phrase.

NOTE: Timecodes and time offsets are both shown.

```
┌─────────────────────────────────────────────┬──────────────┐
│  [Vibrant phrase chart — dimmed context]     │ ◄Prev [P__] │
│  Current phrase highlighted, neighbors dim   │    Next►     │
├─────────────────────────────────────────────┴──────────────┤
│  Phrase stats table (start, end, duration, BPM, cycles)    │
├────────────────────────────────────────────────────────────┤
│  Editing Phrase 3                                          │
│  Tone: Tease | Transforms: Halve, Normalize                │
│  Stim: Reactive                                            │
├─────────────────────────────────┬──────────────────────────┤
│                                 │                          │
│   [Video player]                │   Enchantment catalog    │
│   Scoped to current phrase      │                          │
│                                 │   ○ Cum                 │
│   [━━━━━━●━━━━━━━━━]            │   ○ Edge                │
│   1:45        2:15              │   ○ Fast                │
│                                 │   ○ Lube                │
│   Timecode Begin: [button 
            or time 1:52.300]     │   ○ Medium              │
│   Timecode End:   [button 
            or time 1:52.300]      │   ○ Slow                │
│   Active: Edge (1:52-2:07) 🗑    │   ○ Stay                │
│                                 │   ○ Ruin                │
│  ─── or if no video: ───        │   ○ Stop                │
│                                 │   ○ Tranquil            │
│   Begin Timecode: [_1:52.300]   |                         |
│   End Timecode: [__1:52.300__]  | [Intensity ━━━━●━━]     │
│   (editable input field)        │                         │
│                                 │  Description             |│                                 │                          │
│                                 │  [+ Add]                 │
├─────────────────────────────────┴──────────────────────────┤
│                                                            │
│  Enchantments for Phrase 3:                                │
│  ┌──────────┬──────────────┬──────────┬───┐                │
│  │ Timecode │ Enchantment  │ Duration │   │                │
│  ├──────────┼──────────────┼──────────┼───┤                │
│  │ 1:52     │ Edge         │ 15s      │ 🗑 │               │
│  │ 2:03     │ Cum          │ 15s      │ 🗑 │               │
│  │ 2:41     │ Tranquil     │ 20s      │ 🗑 │               │
│  └──────────┴──────────────┴──────────┴───┘                │
│                      [Load prebuilt]                       │
│                       [Accept]                             │
└────────────────────────────────────────────────────────────┘
```

### Top section — context, not editing

The top of the tab shows context for the current phrase. You can see it,
you can't change it here:

- **Vibrant phrase chart** — same velocity-colored PNG as the phrase editor,
  dimmed on neighboring phrases. Shows the shape of what you're enhancing.
- **Prev / [Go to P__] / Next** — navigate phrases. Prev and Next step
  through sequentially. "Go to P__" dropdown lets you jump to any phrase
  directly without clicking through all of them.
- **Stats table** — start, end, duration, BPM, cycles. Read-only.
- **Context bar** — Editing Phrase 3 | Tone applied | Transforms applied |
  Stim character. Every upstream decision visible in one place.

### Middle section — video + catalog

Two panels side by side:

**Left panel (video/timecode):**
- Video player scoped to current phrase (30-90s, not 2 hours)
- Timecode display below video
- Active enchantment indicator — as video plays, shows which enchantment
  the playhead is inside (name + time range + trashcan). Enchantments
  light up as you watch. When in a gap: empty (ready to add).
- If no video: timecode edit field (user types)
- Add button — places enchantment at current timecode. and sets timers end timer to begin and end timer is blank.

**Right panel (catalog + controls):**
- Enchantment list — all 10 basics. Click to select.
- Duration slider (default from YAML)
- Intensity slider (scales the right params per family)


### Bottom section — phrase enchantment table + Accept

- Table shows enchantments for THIS phrase only
- Columns: Timecode, Enchantment name, Duration, Trashcan
- Each row = one `.events.yml` entry. What you see is what exports.
- **Accept** saves all enchantments (all phrases) to `.events.yml` on disk

### Accept and navigation

- Accept persists to disk but is not the main action
- The real workflow is **Prev/Next** — scroll to top, move to the next
  phrase, keep building. Work is kept in session across phrases.
- Adding enchantments is implied acceptance — rows are kept as you
  navigate. Accept just writes the file.

### Key design decisions

- **Phrase-scoped everything** — video, chart, table all show only the
  current phrase. You never get lost in a two-hour video.
- **Context is read-only** — the chart, stats, tone, transforms, stim
  are shown for reference but can't be changed here. This tab is only
  about placing enchantments.
- **The table IS the YAML** — each row maps to one event entry. What you
  see is what gets exported.
- **One sliders, not five** — Intensity. Intensity scales
  the right params behind the scenes (volume_boost, buzz_intensity,
  stroke_intensity depending on the enchantment family).
- **Timecode from video** — stop the video, click Add. No millisecond typing.
- **No video? Still works** — timecode edit field appears instead.
- **Live active enchantment display** — enchantments light up as the
  video plays. Trashcan right there for quick removal.
- **Overlap prevention** — can't place an enchantment where one already
  exists. Add is disabled when playhead is inside an active enchantment.
- **One enchantment per timecode** — no stacking in v1. Power users can
  stack by editing the exported `.events.yml` directly.
- **Implied acceptance** — adding rows keeps them in session across phrase
  navigation. Accept persists to disk but isn't required to keep working.
- **Trashcan removes a row** — simple, no confirmation needed.
- **Extensible catalog** — users can add MCB, Clutch, or custom events.
  If the YAML definitions are present, they show up in the catalog list.
  We ship the 10 basics. Docs show how to add more.

### Load prebuilt

User can write their own YAML file and upload it from the `Load prebuilt` button, which shows a OS-specific file selection YAML. Selection can go across phrases. It's a way to use one a user may have written by hand.

### Export integration

Accept saves the `phraseX.events.yml` per phrase to the working folder.
At export time, all phrase `.events.yml` files merge into one:

```yaml
events:
  - time: 112300       # absolute timecode from phrase 3
    name: edge
    params:
      duration_ms: 15000
  - time: 123000
    name: cum
    params:
      duration_ms: 15000
  - time: 161000
    name: tranquil
    params:
      duration_ms: 20000
```

Then:
1. `cli.process()` — generates 10 channel files from Stim config
2. `process_events()` — applies enchantments from merged `.events.yml`
3. Output folder has final files + the `.events.yml` (editable, portable)

### forgegen integration (future)

The enchantment catalog is the content generation seed for forgegen:
- Beat detection says "hit at 3:42.300" → place `edge` at that timecode
- Energy drops at 5:10 → place `tranquil`
- Scene texture change at 7:00 → place `fast`

Three layers, one catalog:
1. **FunScriptForge** (manual) — user watches video, places enchantments
2. **forgegen** (auto) — algorithm places enchantments based on analysis
3. **funscript-tools** (engine) — executes them all via `process_events()`

## Processing Time Budget

| Step | Victoria Oaks benchmark | When it runs |
|---|---|---|
| Stim preview | Instant | Stim tab (preview functions, no I/O) |
| 2D generation | ~18 seconds | Export (alpha + beta only) |
| 3-phase generation | 2-3 minutes | Export (10 files) |
| Event application | Seconds | Export (after generation) |

Stim tab is interactive. Export is async with progress bar.

## Implementation Plan

### Phase 0: PhraseNavigator shared component
- [ ] Extract top section from phrase_detail.py into reusable PhraseNavigator:
  - Vibrant phrase chart (dimmed context, read-only)
  - Prev / Go to P__ / Next navigation
  - Stats table (read-only)
  - Context bar (phrase # + tone + transforms + stim)
- [ ] Phrase editor uses PhraseNavigator + transform controls
- [ ] Enchantment tab uses PhraseNavigator + video + catalog
- Build once during Enchantment tab work, not before

### Phase 1: Stim tab refinement (current)
- [ ] Replace Plotly path chart with matplotlib (fixed axes, live update)
- [ ] Add device selector with expected output file list
- [ ] Wire `cli.preview_*()` functions for live previews
- [ ] Test restim device consumption to validate device buckets

### Phase 2: Enchantment catalog
- [ ] Parse `config.event_definitions.yml` for the 10 basic enchantments
- [ ] Render matplotlib preview cards from YAML definitions
- [ ] Build enchantment catalog component (reusable list)

### Phase 3: Enchantment tab (one evening session)
- [ ] Phrase selector scoping (video + funscript + table per phrase)
- [ ] Video player scoped to phrase time range
- [ ] Enchantment catalog list with click-to-select
- [ ] Duration + Intensity sliders (two only)
- [ ] Add button → row in table (timecode from video position)
- [ ] Trashcan delete per row
- [ ] Accept saves merged `.events.yml` to working folder
- [ ] Wire into export pipeline: `cli.process()` then `process_events()`
- [ ] Docs: how to add custom enchantments (MCB, Clutch, user-defined)

### Phase 4: forgegen integration (future)
- [ ] Auto-assign events based on scene analysis
- [ ] Suggestion engine: "this phrase looks like a climax → try Edge?"
