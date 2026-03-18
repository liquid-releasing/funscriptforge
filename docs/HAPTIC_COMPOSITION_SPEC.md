# Haptic Composition — Multi-Layer Architecture

## Core Idea

Haptic output is composed from three independent layers. Each layer is opt-in
by inclusion of media. If you don't include a captions file, the caption layer
doesn't exist. No configuration needed — presence of media IS the configuration.

```
Layer 1: Funscript          — base motion, always present
Layer 2: Beat               — rhythm emphasis, weighted by Tone envelope
Layer 3: Caption emotion    — mood felt in the body, same weight system
```

All three layers share the same **Tone vocabulary** as their common language.
The Tone system is not a separate thing — it IS the bridge between layers.

---

## Layer 1 — Funscript (Base)

The original funscript. Always present. Other layers augment it, never replace it.

---

## Layer 2 — Beat Augmentation (V1)

### Source
- Primary: video audio track (extracted via PyAV, analyzed via librosa)
- Override: separate audio file dropped in Media section

### Pipeline
```
video → PyAV (audio decode) → librosa.beat.beat_track() → beat timestamps + strength
→ cached to _beat_data.json in output folder
→ displayed as: amplitude envelope chart + vertical beat markers (Plotly)
→ exported as: beat_data.csv (timestamp_ms, beat_number, tempo_bpm)
```

### Tone as Weight Envelope
Beat influence is NOT a global setting. It is a per-phrase weight curve
determined by the phrase's Tone type:

| Tone / Phrase type | Beat influence curve |
|---|---|
| Build | Starts low, grows exponentially to end of phrase |
| Climax | Maximum throughout |
| Tease | Low, oscillates — beat peeks through occasionally |
| Edge | High but interrupted — beat influence cuts out at hold points |
| Tender | Minimal — beat is felt as gentle pulse not emphasis |
| Dominant | Full, sharp — beat hits hard on every marker |

The beat does not replace the funscript shape. It modulates amplitude and
timing of existing strokes toward the nearest beat timestamp, weighted by
the curve above.

### Parameters (per phrase, set in Tone tab)
- Beat division: 1/1, 1/2, 1/4 (which beats to target)
- Direction on beat: peak up or peak down
- Amplitude source: fixed or inherit from original funscript shape

### Generation UX
- [Analyze motion] button already present on video — generates motion heatmap
- [Generate beat data] button appears under video stats row
- Both are on-demand, cached, non-blocking
- On Continue: cached data written to output folder

---

## Layer 3 — Caption Emotion (V2)

### Why V2
Requires vocal separation before analysis. A raw audio track mixes vocals,
music, and background noise. Emotion analysis on mixed audio is unreliable.

Vocal separation dependency: **Demucs** (Meta, MIT license) or **Spleeter**
(Deezer). Both are heavy but accurate. This is the gating dependency for V2.

### Pipeline (V2)
```
video → PyAV → Demucs (vocal stem) → emotion analysis per caption segment
→ emotion label → maps to Tone vocabulary label
→ applies corresponding Tone transform for that time window
```

### Caption → Tone vocabulary mapping
Captions provide timestamped text. Emotion analysis per segment outputs a
label from the **same 6-tone vocabulary** the Tone system already uses.
No new vocabulary needed — the labels unify the systems.

| Detected emotion | Tone label applied |
|---|---|
| Anger, aggression | Dominant |
| Urgency, panic | Build |
| Tenderness, love | Tender |
| Tension, suspense | Edge |
| Playful, flirty | Tease |
| Ecstasy, release | Climax |

### Emotion detection options
- V2a: VADER sentiment → hand-tuned decision tree to Tone labels (local, no API)
- V2b: Claude API → direct emotion → Tone label mapping (richer, requires key)

### Generation UX (V2)
- Drop captions file → scrollable 2" table appears (time | text)
- [Parse captions] → generates captions.json (timestamp_ms, end_ms, text)
- [Analyze emotion] (V2) → generates emotion_track.json (timestamp_ms, tone_label, confidence)
- On Continue: all cached data written to output folder

---

## Unified Tone Vocabulary

The same 6 labels are used across:
- eTransforms (phrase-level haptic character)
- Beat weight envelopes (how beat influence grows within a phrase)
- Caption emotion output (what emotion maps to which label)
- Future: Explorer analysis labels, character catalog

This is intentional. One vocabulary. All systems speak it.

---

## Implementation Order

| Phase | Feature | Blocker |
|---|---|---|
| V1 now | Beat detection pipeline (video → librosa → chart + CSV) | None |
| V1 now | Beat data display in Project tab | None |
| V1 soon | Beat-to-haptic transform in Tone tab | Beat data cached |
| V1 soon | Per-phrase beat weight envelope in Tone tab | Tone tab redesign |
| V2 | Vocal separation (Demucs) | Heavy dependency |
| V2 | Caption emotion analysis | Vocal separation |
| V2 | Caption emotion → Tone transform | Emotion pipeline |

---

## Notes

- Caption emotion is part of the audio/tone system. Opt-in by including captions.
- The Tone tab needs to shift from "global setting" to "per-phrase weight envelope."
  This is a design change, not just a feature addition.
- Beat division parameters (1/1, 1/2, 1/4) are the creative controls that make
  beat augmentation feel musical rather than mechanical.
