# Building recipes

A recipe is a **named modulation behavior** the Events tab (and other tabs, eventually) lets users apply to a span of the timeline. This document explains how recipes are defined, what fields they carry, what each field does, and how to author a new one.

Recipes are intended to live in **forgeworkbench** (the renamed FunscriptForge Pro) as the recipe-library editing surface. The Events tab is a *consumer*. This document describes the recipe shape that both the library and consumers see; the workbench's authoring UI is out of scope here.

---

## 1. Recipe vs primitive

Two concepts; don't confuse them:

- **Primitive** — a single modulation shape from the engine's alphabet:
  - `pulse` — on-beat bumps
  - `wave` — slow sinusoidal swell
  - `tremor` — high-frequency oscillation
  - `sustain` — held level
  - `rolling` — continuous swell, ocean-wave shape
  - `impact` — single hit / spike
- **Recipe** — a *named composition* of one or more primitives, with envelopes, default values, tunable parameters, a family, a compose mode, and a preview shape.

Primitives are the engine's *implementation* alphabet. Recipes are the user's *vocabulary*. Users pick recipes; the engine renders primitives.

Example: the `surge` recipe is a `wave` (ramp-in) + `sustain` (hold) + `wave` (ramp-out), stitched together with sensible defaults. The user sees "Surge"; the engine sees three primitives in sequence.

---

## 2. Recipe shape

```js
{
  id:        "surge",                // stable identifier — lowercase, snake_case
  label:     "Surge",                // user-facing name
  family:    "release",              // one of: edging | release | rhythm | punctuate | texture | baseline
  desc:      "Slow ramp-in, sustained throb, slow ramp-out. Big release moments.",
                                     // one-sentence description shown in picker + hint

  primitives: [                      // the engine-side composition
    { pattern: "wave",    period: "0.5b", envelope: "ramp-in"  },
    { pattern: "sustain", level: 0.85,    envelope: "hold"     },
    { pattern: "wave",    period: "1b",   envelope: "ramp-out" },
  ],

  defaults: {                        // baseline values for this recipe
    intensity:   0.85,               // 0..1 — the recipe's "natural" intensity
    duration_ms: 8000,               // recipe's natural duration; used for tap-to-create
  },

  tunables: [                        // per-event overridable parameters
    { key: "ramp_in_ms",  label: "Ramp in",
      min: 200, max: 4000, step: 100, default: 800,  unit: "ms" },
    { key: "throb_freq",  label: "Throb",
      min: 0.5, max: 4,    step: 0.1, default: 1.5,  unit: "Hz" },
    { key: "ramp_out_ms", label: "Ramp out",
      min: 500, max: 8000, step: 100, default: 2500, unit: "ms" },
  ],

  preview: [                         // 24 normalized samples 0..1 — the picker preview shape
    0.10, 0.18, 0.30, 0.42, 0.55, 0.68, 0.78, 0.85,
    0.82, 0.85, 0.78, 0.82, 0.85, 0.80, 0.78, 0.72,
    0.65, 0.55, 0.46, 0.38, 0.30, 0.22, 0.16, 0.12,
  ],

  compose:      "additive",          // optional; default "additive". Use "replace" for eraser recipes.
  isBaseline:   false,               // optional; true only for the Normal recipe
  tapToCreate:  false,               // optional; true → Set End auto-derives from defaults.duration_ms
}
```

---

## 3. Field reference

### `id` *(required, unique)*
Lowercase snake_case. The stable key referenced by events in `.feel.yml`. Don't rename — events break.

### `label` *(required)*
User-facing name. Title-case (`"Surge"`, `"Edge"`). Can be renamed safely; it's display-only.

### `family` *(required)*
Pick one:

| Family | Color | Use for |
|---|---|---|
| `edging` | `#ff7b7b` pink | Tension / build / hold-and-release |
| `release` | `#ff8c42` orange | Crescendo / climax / big payoff |
| `rhythm` | `#4dabf7` blue | Pulse / wave / loops that ride the beat |
| `punctuate` | `#c77dff` purple | Single hits / impacts / accents |
| `texture` | `#3ed598` green | Ambient layer / mood / aftercare |
| `baseline` | `#6b7390` gray | Reserved for Normal (eraser). Don't reuse. |

Family color drives the band fill on the strip, the swatch in the picker, and the section header in the search-grouped dropdown. Recipes in the same family should *feel* similar — that's the user contract.

### `desc` *(required)*
One sentence, declarative, second-person allowed. Shows up in the picker's row, the capture-row hint, and (eventually) the modal palette.

Good: *"Single hit. Gunshot, slap, punch landing."*
Bad: *"This recipe triggers a brief modulation event with an attack envelope and decay characteristics suitable for representing impactful moments in the content."*

### `primitives` *(required, may be empty)*
The engine-side composition. An ordered list of primitive descriptors. Each primitive object is `{ pattern: "<name>", ...params }`. Per-pattern params depend on the primitive:

| Primitive | Common params |
|---|---|
| `pulse` | `period` (string like `"1b"`, `"0.25b"`, `"500ms"`), `envelope` |
| `wave` | `period`, `level`, `envelope` |
| `tremor` | `freq` (Hz or beat string), `amount` (0..1) |
| `sustain` | `level` (0..1), `envelope` |
| `rolling` | `period`, `amount` |
| `impact` | `amount`, `envelope` |

Envelopes (recognized strings, applied to that primitive's amplitude over time):
- `snap` — instantaneous attack, fast decay (Impact)
- `ramp-in` — gradual rise from 0
- `ramp-out` — gradual fall to 0
- `hold` — flat / sustained
- `decay` — gradual fall from peak
- `ease-in` — slow then accelerate to target

For an **eraser recipe** (Normal), `primitives: []` is correct — there's nothing to render.

### `defaults.intensity` *(required)*
0..1. The "natural" intensity for this recipe at 100%. The event-level `intensity` slider multiplies into this.

### `defaults.duration_ms` *(required)*
The recipe's "natural" duration. Used by **tap-to-create** to auto-derive an end time. Also used as the recipe's *fingerprint* duration when the user adds a new event and the picker is showing the recipe — gives a sensible visual hint.

### `tunables` *(required, may be empty)*
Per-recipe parameters the user can override on a per-event basis. Each tunable becomes a slider in the Params row of the capture surface.

```js
{
  key:     "tremor_freq",  // saved into event.params[key]
  label:   "Tremor",       // UI label (short — fits in a chip)
  min:     1, max: 20,     // range
  step:    0.5,            // step size
  default: 10,             // pre-filled value when the recipe is first picked
  unit:    "Hz",           // suffix shown after the number; "" for unitless
}
```

Tunable conventions:
- `*_ms` for durations
- `*_freq` for frequencies (Hz)
- `*_amount`, `*_amplitude`, `*_level`, `*_depth` for normalized 0..1
- `period_beats` for beat-relative durations
- Keep `label` short. The slider chip is ~110px wide.

An event's `params` block stores ONLY the keys the user overrode. The engine merges with defaults at render time. Empty params block = use recipe defaults verbatim.

### `preview` *(required)*
**24 normalized values 0..1** representing the modulation shape over time. Rendered as a tiny area-chart waveform in the picker. The shape should *look like the recipe feels*:

- Surge: low → high → low (smooth)
- Impact: flat → spike → decay → flat
- Pulse: bumps (zigzag)
- Tease: low flutter
- Soften: high → low, gradually
- Normal: flat (dashed)

Don't agonize over precision; this is a *visual hint*, not a render. The eventual modal palette (`#3` in the picker discussion) will render the preview at larger scale; same array drives both.

### `compose` *(optional, default `"additive"`)*
How the event composes with anything else playing at the same time. Two values today:

- `additive` — sum per device, capped at 1.0. The default.
- `replace` — override everything underneath for the span. Use sparingly — Normal is the only recipe today that uses this.

If you find yourself reaching for `replace` for a non-baseline recipe, ask whether the user goal is better served by **lower intensity** + **additive** — `replace` always feels jarring and reduces compositional flexibility.

### `isBaseline` *(optional, default `false`)*
Only `true` for **Normal**. Two effects:

1. UI renders the recipe with a dashed border + hatched fill (negative-space treatment).
2. Intensity slider is disabled in the capture surface (a Normal event has no intensity to set).

Don't add a second baseline recipe without re-checking the UI assumptions.

### `tapToCreate` *(optional, default `false`)*
If `true`, the event can be committed with only a begin anchor — the end auto-derives from `defaults.duration_ms`. Set End label changes to `END (AUTO) + <duration> ms`. Add button label changes to `+ Add hit`.

Good for recipes where the user thinks of the event as a *single moment*: Impact, possibly Pulse for a single tap.

Bad for long recipes: Surge (8 s default), Climax (6 s default), Tease (5 s default). Auto-extending 8 seconds of the video silently is a UX trap.

---

## 4. Authoring walkthrough — building a new recipe

Let's build a hypothetical new recipe: **Heartbeat** — a slow double-pulse pattern that rides at the project's BPM and feels like a heartbeat.

### Step 1 — name + family + desc

```js
{
  id:     "heartbeat",
  label:  "Heartbeat",
  family: "rhythm",     // it rides the beat
  desc:   "Slow double-pulse, on every other beat. Feels like a heartbeat.",
  ...
}
```

### Step 2 — primitives

A heartbeat is two close pulses, then silence, repeating. Closest primitive: `pulse` with a short period.

```js
primitives: [
  { pattern: "pulse", period: "0.15b", envelope: "snap" },   // the double-tap
  { pattern: "sustain", level: 0.0, envelope: "hold" },      // the gap
],
```

(In a real engine this would be expressed more carefully with explicit gaps; the prototype's primitives are illustrative.)

### Step 3 — defaults

```js
defaults: { intensity: 0.55, duration_ms: 4000 },
```

55% intensity — heartbeats are body-rhythm, not climaxes. 4 seconds is a natural minimum duration (a couple of double-beats).

### Step 4 — tunables

Two knobs the user might want:
- Gap between the two pulses of a double-beat
- Whether the second pulse is louder than the first

```js
tunables: [
  { key: "gap_ms",  label: "Gap",        min: 80,   max: 400, step: 10,   default: 180,  unit: "ms" },
  { key: "second_pulse_boost", label: "Second pulse",
                                         min: 0.5,  max: 1.5, step: 0.05, default: 1.10, unit: "" },
],
```

### Step 5 — preview shape

A heartbeat preview is two close spikes, a gap, two close spikes:

```js
preview: [
  0.05, 0.05, 0.50, 0.30, 0.55, 0.20, 0.10, 0.05,
  0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.50, 0.30,
  0.55, 0.20, 0.10, 0.05, 0.05, 0.05, 0.05, 0.05,
],
```

Two double-spikes with a flat valley between. When rendered as a 64×18 mini-SVG it'll *look like a heartbeat trace*.

### Step 6 — compose + flags

It's additive (you might layer a Heartbeat under a Tease for a "she's breathing fast" feeling). Not tap-to-create — a heartbeat is intrinsically a duration thing.

```js
compose: "additive",
// tapToCreate omitted → false
// isBaseline omitted → false
```

### Step 7 — full recipe

```js
{
  id:        "heartbeat",
  label:     "Heartbeat",
  family:    "rhythm",
  desc:      "Slow double-pulse, on every other beat. Feels like a heartbeat.",
  primitives: [
    { pattern: "pulse",   period: "0.15b", envelope: "snap" },
    { pattern: "sustain", level: 0.0,       envelope: "hold" },
  ],
  defaults: { intensity: 0.55, duration_ms: 4000 },
  tunables: [
    { key: "gap_ms",  label: "Gap",        min: 80,   max: 400, step: 10,   default: 180,  unit: "ms" },
    { key: "second_pulse_boost", label: "Second pulse",
                                           min: 0.5,  max: 1.5, step: 0.05, default: 1.10, unit: "" },
  ],
  preview: [
    0.05, 0.05, 0.50, 0.30, 0.55, 0.20, 0.10, 0.05,
    0.05, 0.05, 0.05, 0.05, 0.05, 0.05, 0.50, 0.30,
    0.55, 0.20, 0.10, 0.05, 0.05, 0.05, 0.05, 0.05,
  ],
  compose: "additive",
}
```

Add it to `EV_RECIPES`. It now appears in:
- The recipe picker, grouped under **Rhythm**, with its preview waveform shown
- Search results when the user types "heart" or "beat"
- The Params row when selected (Gap + Second pulse sliders)
- The recipe hint at the bottom of the capture row
- Generated events' `recipe: "heartbeat"` field in `.feel.yml`

---

## 5. Cross-cutting design rules

### Recipes are *user vocabulary*, not engine internals
Recipes should be nameable, describable in one sentence, and reflect a *feeling* a user wants to express. If a recipe doesn't have a natural one-sentence description, it's probably not a recipe — it's a primitive or a low-level parameter dump.

### Don't proliferate
Quality > quantity. Edger's 15 recipes are plenty for v1. The picker is sectioned + searchable specifically so the library can grow, but a sprawl of *Edge-Hard, Edge-Soft, Edge-Variable-Threshold-A, Edge-Variable-Threshold-B* makes the picker worse, not better.

### Same vocabulary across surfaces
The recipes the Events tab consumes are the same recipes the (future) Phrases-tab recipe assignments will consume, the same recipes Characters will eventually project from. One library, many consumers. Don't fork the catalog per surface.

### Per-device support
A production recipe needs **device packs** describing how it renders on each device class. These are out of scope for this design pass (they live in the workbench, not the Events tab) but the recipe schema is forward-compatible — see `HANDOFF.md` §5.3 for the shape.

### Compose-replace is rare
Default to additive. `replace` exists for Normal (the eraser) and possibly for "global stop" semantics like a safe-word event. Reaching for replace too often is a sign your recipes aren't composing well — fix the recipes first, not the rules.

---

## 6. Worked examples — the eight recipes in the prototype

Quick read-through of how each prototype recipe instantiates the schema:

| Recipe | Family | Compose | Tap? | What it expresses |
|---|---|---|---|---|
| **Normal** | baseline | replace | – | Pass-through; the eraser. |
| **Surge** | release | additive | – | Slow ramp-in, sustained throb, ramp-out. The classic release. |
| **Edge** | edging | additive | – | Quick pulse ramp + 10 Hz tremor. Tension build. |
| **Tease** | edging | additive | – | Light flutter with held breath. Anticipation. |
| **Climax** | release | additive | – | Hard crescendo, peak intensity. Saved for the moment. |
| **Impact** | punctuate | additive | **yes** | Single hit. Gunshot, slap, punch landing. |
| **Pulse** | rhythm | additive | – | Steady on-beat pulse. The metronome. |
| **Rolling** | rhythm | additive | – | Continuous swell, ocean-wave shape. |
| **Soften** | texture | additive | – | Drop intensity floor. Recovery / aftercare. |

Each one's full definition is in `events_tab/data.js`. They're the working set for the design prototype; production should ship them as the baseline library and grow from there.
