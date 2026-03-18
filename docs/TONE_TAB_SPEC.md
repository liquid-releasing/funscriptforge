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
    "phrase_overrides": {
      "3": "Climax",
      "7": "Tender"
    }
  }
}
```

| Key | Description |
|---|---|
| `global` | The tone the user selected (or accepted) |
| `suggestion` | What auto-metadata recommended (preserved for display) |
| `rationale` | Human-readable rationale string from `derive_metadata()` |
| `beat_influence` | Global beat influence slider value (0–1) |
| `phrase_overrides` | Dict of phrase index → tone label for per-phrase overrides |

---

## Navigation

**Continue →** advances to the Export tab. It is available as soon as a tone is selected
(which it is by default — the suggestion is pre-selected on load).

The **Continue** button is not gated on beat influence or any slider. Tone selection
is the only required decision.

---

## Three-stage application model

Tone is applied at three points in the workflow. The same Tone picked at Stage 1
is the one used at Stage 3 — by default, unchanged.

| Stage | Where | Scope | What happens |
|---|---|---|---|
| **1 — Intent** | Tab 2 (global) | Whole project | Tone is set as creative direction. Drives transform recommendations for Stage 2. No signal processing yet. |
| **2 — Phrase work** | Phrase editor button 4 | Per phrase (optional) | Per-phrase overrides. Recommendations for Shape/Tempo/Intensity are informed by the phrase's effective Tone. |
| **3 — Export** | Export pass | All output files | Tone recipe applied once to the clean funscript. Same Tone drives all 6–7 output files simultaneously. |

The default at Stage 3 is always `forge_project["tone"]["global"]` — the Tone
the user picked in Tab 2. Phrase overrides apply locally. No re-picking at export.

```python
def effective_tone(phrase_index, forge_project):
    overrides = forge_project["tone"].get("phrase_overrides", {})
    return overrides.get(str(phrase_index), forge_project["tone"]["global"])
```

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
