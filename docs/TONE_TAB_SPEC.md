# Tone Tab — Design Specification

**Status:** Design
**Tab position:** Tab 2 in the forge workflow (Project → **Tone** → Export)

---

## Purpose

Tone is the Easy Button. It is the single most important creative decision in a
forge project — the one choice that defines how the haptic output feels across
the whole scene.

Most users open this tab, glance at the suggestion, accept or change it, and
click **Continue**. Done. Three steps total. That is the design goal.

Power users who want per-phrase control use the Phrase Editor's Transform button 4
(same vocabulary, local scope). That is optional depth, not a requirement.

---

## The Six Tones

The tone vocabulary is the shared language across every FunscriptForge system:
metadata derivation, beat weight envelopes, caption emotion (V2), and device output.

| Tone | One-line meaning | Haptic character |
|---|---|---|
| **Build** | Tension grows | Intensity increases steadily; no release until the end |
| **Climax** | Everything, now | Maximum intensity, full range, urgent pacing |
| **Tease** | Pull back at the peak | Oscillates — rises toward a peak then retreats; reward withheld |
| **Edge** | Hold there | Sustained plateau; high intensity maintained, no release |
| **Tender** | Slow and close | Soft, slow, shallow strokes; intimate and present |
| **Dominant** | Driving, relentless | Fast, wide, assertive; device takes charge |

These six are permanent vocabulary. Adding tones is a breaking change to the
entire pipeline — treat them as locked.

### Why "Tones" and not "Characters"

The vocabulary was previously called **characters** — names that described device
behavior (Gentle, Reactive, etc.). It was renamed to **Tones** deliberately.

"Characters" is mechanism-first: it describes what a device does. "Tones" is
sensation-first: it describes what a user feels. That difference matters because
the vocabulary needs to apply to any output surface — a single-axis toy, an estim
device, a multi-zone haptic suit, a spatial audio rig. The mechanism varies. The
sensation is consistent.

Tease on a Handy oscillates amplitude. Tease on a haptic suit swirls sensation
toward a zone and pulls away before committing. The same word. The same felt
experience. Different surfaces, same intent.

The renaming is what makes the vocabulary extensible without modification.

---

## Tab 2 — Global Tone Selection

### Entry state

The tab opens with a tone **pre-selected** based on auto-metadata derived from
the funscript (see `docs/AUTO_METADATA_SPEC.md` and `forge/metadata.py`).

A rationale line appears above the picker explaining the suggestion:

> *Suggested based on: dominant mood Tease, building arc, medium intensity*

This is not binding. It is a starting point. The user can change it in one click.

### Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Tone                                                        │
│                                                             │
│  Suggested: Tease                                            │
│  "Suggested based on: dominant mood Tease, building arc"    │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │  Build   │  │  Climax  │  │  Tease ✓ │  ← selected      │
│  │          │  │          │  │          │                   │
│  │[preview] │  │[preview] │  │[preview] │                   │
│  │          │  │          │  │          │                   │
│  │ Select   │  │ Select   │  │Selected ✓│                   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐                  │
│  │   Edge   │  │  Tender  │  │ Dominant │                   │
│  │          │  │          │  │          │                   │
│  │[preview] │  │[preview] │  │[preview] │                   │
│  │          │  │          │  │          │                   │
│  │ Select   │  │ Select   │  │ Select   │                   │
│  └──────────┘  └──────────┘  └──────────┘                  │
│                                                             │
│  ── Global controls ─────────────────────────────────────  │
│  Beat influence   [●──────────] 0.5    (when beats loaded)  │
│                                                             │
│  ── What you'll feel ────────────────────────────────────  │
│  Tease: Intensity builds across each phrase, then pulls     │
│  back just before the peak. The beat rhythm oscillates      │
│  in and out rather than driving straight through.           │
│                                                             │
│                        [ Continue → ]                       │
└─────────────────────────────────────────────────────────────┘
```

### Tone card — anatomy

Each of the six cards shows:

| Element | Description |
|---|---|
| **Name** | Tone label |
| **Micro-preview** | Small chart showing what a representative phrase looks like after this tone is applied (BPM envelope or position trace shape) |
| **Select / Selected ✓** | Action button; selected card gets accent border + checkmark badge |
| **Dimming** | Unselected cards render at reduced opacity — selection state is visually unambiguous |

### "What you'll feel" panel

Below the card grid, a plain-English description of the selected tone — two to three
sentences explaining the haptic sensation, not the technical mechanism.

Example for **Tease**:
> *Intensity builds across each phrase, then pulls back just before the peak.
> The device follows your rhythm but never quite commits. You'll always want more.*

Example for **Dominant**:
> *Fast, wide, and unrelenting. The device drives the pace — you follow it.
> Phrases hit hard and push through to their end.*

### Beat influence slider

Visible only when beat data has been generated (beats were extracted in the Project tab).

| Position | Effect |
|---|---|
| 0 | Beats have no influence on haptic output |
| 0.5 (default) | Moderate beat accent — rhythm visible but not dominant |
| 1.0 | Beats fully shape the phrase intensity envelope |

The beat influence interacts with the selected tone — **Build** = influence
increases across the phrase; **Tease** = influence oscillates; **Climax** =
full influence throughout; **Tender** = influence suppressed below 0.3 regardless
of slider.

See beat weight envelope table below.

---

## Tone as Transform (Phrase Editor — local scope)

The same six tones appear as **Transform button 4** in the Phrase Editor.

```
[Shape ▼]  [Tempo ▼]  [Intensity ▼]  [Tone ▼]
                                        Build
                                        Climax
                                        Tease  ← selected for this phrase
                                        Edge
                                        Tender
                                        Dominant
```

This is the same component, narrower scope. It overrides the global tone for the
selected phrase or segment only.

Shape (1), Tempo (2), and Intensity (3) transforms run first. Tone (4) is applied
last — it colors the result, not the raw input.

---

## Beat Weight Envelopes

When beats are present, each tone defines a different shape for how beat influence
is applied across a phrase over time.

| Tone | Envelope shape | Behavior |
|---|---|---|
| **Build** | Linear ramp up | Beat influence starts low, ends high — rhythm grows |
| **Climax** | Flat at maximum | Full beat influence throughout the phrase |
| **Tease** | Sine oscillation | Beat influence rises and falls — never fully commits |
| **Edge** | Step function | Full influence until 80% of phrase, then drops — sustain then release |
| **Tender** | Flat at low | Beat influence capped at 0.3 regardless of slider — stays soft |
| **Dominant** | Flat at high | Beat influence capped at 0.9 — relentless rhythm |

The envelope is applied per phrase, not globally. A funscript with mixed phrase
types gets mixed envelopes — each phrase has its own Tone assignment.

---

## Caption Emotion → Tone (V2)

> **V2 gate:** Requires vocal separation (Demucs/Spleeter) to isolate the vocal
> track before emotion analysis. Mixed audio gives unreliable results.
> This feature ships when vocal separation is integrated.

The mapping from detected speech emotion to Tone vocabulary:

| Detected emotion | Tone label |
|---|---|
| Anger, command | Dominant |
| Joy, playful | Tease |
| Sadness, softness | Tender |
| Fear, urgency | Climax |
| Neutral, sustained | Edge |
| Rising tension | Build |

Caption emotion overrides the global tone for the duration of that caption window.
It does not replace the phrase-level tone — it composes with it.

---

## Tone vocabulary across systems

One vocabulary. All systems speak it.

| System | Where tone appears |
|---|---|
| **Auto-metadata** | `derive_metadata()` → `tone_suggestion` — seeds the Tone tab pre-selection |
| **Tone tab (global)** | User picks or accepts suggestion — applies to the whole project |
| **Phrase Editor (local)** | Transform button 4 — overrides global tone for one phrase or segment |
| **Beat weight envelopes** | Each tone defines an envelope shape for beat influence per phrase |
| **Caption emotion (V2)** | Detected speech emotion maps to a tone → overrides locally |
| **Export** | Tone label drives haptic output shaping for each device profile |
| **Spatial haptics (backlog)** | Same intent record drives body-zone distribution — see below |

### Tone as spatial haptic intent

The same Tone decisions that shape funscript output also describe how sensation
moves across a haptic suit. Funscript is one axis of motion. A haptic suit is a
surface — dozens of zones that can receive independent signals simultaneously.

Tone maps naturally to spatial movement:

| Tone | Spatial character |
|---|---|
| **Build** | Sensation grows inward — starts at the periphery, converges toward center |
| **Climax** | Everything activates simultaneously — full body, full intensity |
| **Tease** | Sensation swirls and retreats — arrives at a zone then pulls away before committing |
| **Edge** | Sustained activation across a zone — plateau, no release |
| **Tender** | Soft, slow, spreading — sensation diffuses rather than concentrating |
| **Dominant** | Driving wave across the body — directional, assertive, one zone leads |

The `.forge` intent record (global Tone + phrase overrides) is already sufficient
to generate spatial haptic output. No new user decisions required. The same creative
choice that shaped the main funscript also describes how the experience moves
through the body.

This is the same architectural pattern as the device profile expansion — one set of
decisions, one more output surface.

---

## Data model

Tone state is stored in the `.forge` project file.

```json
{
  "tone": {
    "global": "Tease",
    "suggestion": "Tease",
    "rationale": "Suggested based on: dominant mood Tease, building arc",
    "beat_influence": 0.5,
    "phrase_tones": {
      "3": "Climax",
      "7": "Tender"
    }
  }
}
```

| Key | Description |
|---|---|
| `global` | The tone the user selected (or accepted) — the foundation for the whole funscript |
| `suggestion` | What auto-metadata recommended (preserved for display) |
| `rationale` | Human-readable rationale string from `derive_metadata()` |
| `beat_influence` | Global beat influence slider value (0–1) |
| `phrase_tones` | Dict of phrase index → tone label. These modulate the global tone, they do not replace it. |

---

## Navigation

**Continue →** advances to the Export tab. It is available as soon as a tone is selected
(which it is by default — the suggestion is pre-selected on load).

The **Continue** button is not gated on beat influence or any slider. Tone selection
is the only required decision.

### Default Tone resolution

A Tone is always set. The system never reaches Export without one.

Resolution order:

1. **User selection** — the user clicked a card in Tab 2. This is the active Tone.
2. **Auto-metadata suggestion** — `derive_metadata()` produced a `tone_suggestion`. Pre-selected on tab load. Used if the user never changed it.
3. **System default** — `"Build"`. Used only when auto-metadata returned no suggestion (very short funscript, no detectable arc).

The resolved Tone is stored in `forge_project["tone"]["global"]` before export begins.
No Tone picker appears on the Export tab — the choice was made in Tab 2.

---

## Three-stage application model

**Simple version:** Export uses exactly what the user decided — the global Tone from
Tab 2, and any per-phrase influences set in the Phrase Editor. Nothing more.

| Stage | Where | Scope | What happens |
|---|---|---|---|
| **1 — Intent** | Tab 2 (global) | Whole project | User picks (or accepts) a Tone. Applied as the foundation across the entire funscript. Stored in `.forge`. |
| **2 — Phrase work** | Phrase editor button 4 | Per phrase (optional) | Per-phrase Tones stored in `.forge`. These modulate the global foundation — they do not replace it. |
| **3 — Export** | Export pass | All output files | Global Tone applied first. Phrase Tones layer on top. Writes all device output files. |

Export is a read of stored decisions — it does not re-derive or re-prompt.

### Tone composition — influence, not replacement

A phrase Tone **modulates** the global Tone. It does not replace it.

- **Global Tone** is the foundation. It changes the funscript fundamentally — the
  character of the whole piece is established here.
- **Phrase Tone** is a local emphasis. It intensifies, softens, or redirects the
  global character within a phrase. The global foundation remains underneath.
- **No phrase Tone set** — the global Tone expresses fully in that phrase. Phrase
  Tones have the most impact when a strong global Tone is already established.

Example: global = Tease, phrase 3 = Climax.
Phrase 3 is not purely Climax. It is Tease with Climax urgency applied — the
oscillating character of Tease is still present, but the phrase pushes harder
and pulls back less. The user gets a peak moment that fits the overall Tease arc.

```python
def effective_tone(phrase_index, forge_project):
    global_tone = forge_project["tone"]["global"]
    phrase_tone = forge_project["tone"].get("phrase_overrides", {}).get(str(phrase_index))
    # phrase_tone modulates global_tone — both are passed to the recipe layer
    return {"global": global_tone, "phrase": phrase_tone or global_tone}
```

The recipe layer receives both and composes them. When phrase == global, it is
equivalent to a single Tone applied fully.

### One decision set drives all output files

The `.forge` file is the complete record of user intent: global Tone + per-phrase
influences. Export applies that intent through each device profile's translation layer.

```
.forge (global=Tease, phrase_tones={3: Climax, 7: Tender})
    │
    ├── main funscript recipe      → my-scene.funscript
    ├── estim alpha recipe         → estim/alpha.funscript
    ├── estim beta recipe          → estim/beta.funscript
    ├── estim pulse_frequency      → estim/pulse_frequency.funscript
    ├── estim pulse_width          → estim/pulse_width.funscript
    ├── estim pulse_rise           → estim/pulse_rise.funscript
    ├── estim E1–E4, prostate      → estim/E1.funscript … prostate.funscript
    └── Handy funscript            → handy/my-scene.funscript
```

The user never re-decides Tone per device. The same Tone choices flow through
every device profile automatically. All output files express the same creative intent.

This means Tone decisions made incrementally during phrase editing accumulate in
`.forge` and are already complete at export time. Export has no new questions to ask.

### Scope: phrases only, not patterns

Tone applies to **phrases** edited in the Phrase Editor. It does not apply to
behavioral pattern instances fixed in the Pattern Editor. Pattern fixes (normalize,
recenter, beat_accent, etc.) are corrective — they fix broken motion. Tone is
expressive — it shapes intent. These are separate concerns and do not compose.

---

## Safety through intent

Safety is not a check added at export. It is built into the architecture.

The system stores **intent** (what the user decided), not **results** (a processed
signal). Export applies intent once, from a clean source, every time. There is no
state that can accumulate damage.

- The user sets a Tone globally and optionally per phrase. Those decisions live in
  `.forge` as data — never as a mutated funscript.
- Export reads clean source + stored intent → writes output. Same inputs, same output,
  every run.
- There is no way to accidentally apply a Tone twice, because the system never stores
  "this Tone was applied to this funscript." It stores "this is the Tone for this phrase."

By the time the user ships, safety is already in place — not through guards or
warnings, but because the model never allowed unsafe state to exist.

The result for the user: a rich, coherent experience across every device they own.
One set of creative decisions. Every output file expresses it faithfully. No
degradation, no drift, no re-work.

---

## Source integrity — the single most important architectural constraint

**The Stage 2 cleaned funscript is the permanent canonical source.
The Stage 3 export pass always reads from it. Export outputs are never
fed back into the project as a new source.**

This matters because several transforms used in Tone recipes are **not idempotent** —
applying them more than once degrades the funscript:

| Transform | What happens on repeated application |
|---|---|
| `smooth` | Each pass lowers the effective cutoff frequency. Converges toward a flat line at average position. |
| `amplitude_scale < 1.0` | Amplitude × 0.7ⁿ → 0. Energy drains to zero. |
| `halve_tempo` | BPM halved each time. 4 applications: 120 BPM → 7.5 BPM. Near stillness. |
| `boost_contrast` | Converges toward binary 0/100 signal. Loses all mid-range nuance. |

Safe transforms (idempotent — re-running produces no change):

| Transform | Why safe |
|---|---|
| `normalize` | Second application: min already 0, max already 100. No-op. |
| `recenter` | Same target: no movement on second pass. |

**Violation scenario to prevent:**

```
Day 1: Export → Tone(Tender) applied to clean funscript → tender_output.funscript
Day 2: tender_output.funscript becomes the project source (wrong)
       Export again → Tone(Tender) applied again → doubly smoothed, half amplitude
Day N: Near-flat, near-zero signal. All energy gone.
```

**Enforcement:**

- Export outputs go to the output folder only — never overwrite the source funscript
- The source funscript path in `.forge` is set once (in the Project tab) and never
  changed by an export operation
- Export is a pure read operation on the source: same input → same output every time

---

## Open questions

1. **Micro-preview content** — what shape makes each tone visually distinguishable
   at card size? Options: BPM envelope curve, beat weight envelope shape, position
   trace of a representative phrase after tone is applied.

2. **Beat influence per-phrase vs global** — the slider is global for v1. Per-phrase
   beat influence is the full vision (see haptic composition spec) but needs the
   per-phrase tone assignment to work. Sequence: global slider first → per-phrase
   envelopes in v2.

3. **Tone card color** — each tone should have a distinct color for border/accent.
   Align with the character color scheme from the original eTransform spec:
   Build=Green, Climax=Red, Tease=Purple, Edge=Orange, Tender=Blue, Dominant=Dark.

4. **Phrase override UX** — in v1 the Phrase Editor is the way to set per-phrase
   tones. A future compact view on the Tone tab (a phrase timeline with tone chips
   per phrase) could let power users review all overrides without leaving Tab 2.

---

## Related

| File | Contents |
|---|---|
| `docs/AUTO_METADATA_SPEC.md` | How `tone_suggestion` is derived |
| `docs/HAPTIC_COMPOSITION_SPEC.md` | Three-layer haptic composition; beat envelopes; caption emotion |
| `forge/metadata.py` | `derive_metadata()` — produces `tone_suggestion` + `tone_rationale` |
| `forge/tabs/tone_tab.py` | Implementation stub |
| `forge/tabs/project_tab.py` | Feeds metadata into Tone tab on Continue |
