# Auto-Metadata & Tone Suggestion Spec

## Core Idea

FunScriptForge derives most project metadata automatically from the funscript
analysis it already runs. Author reviews and overrides. Nothing is blank.

The same phrase vocabulary that drives transforms drives the metadata.
One analysis pass. Everything downstream benefits.

---

## Auto-Derived Fields

All derived from existing funscript assessment output.

### Pace
Source: average BPM across all phrases

| BPM range | Label |
|---|---|
| < 40 | Slow |
| 40–80 | Medium |
| 80–140 | Fast |
| > 140 | Intense |

### Intensity
Source: avg_speed from funscript_stats()

| avg_speed | Label |
|---|---|
| < 20 | Low |
| 20–50 | Medium |
| 50–80 | High |
| > 80 | Extreme |

### Stroke depth
Source: (max_pos - min_pos) from funscript_stats()

| range | Label |
|---|---|
| < 30 | Shallow |
| 30–60 | Mid |
| 60–85 | Deep |
| > 85 | Full |

### Duration category
Source: duration_s

| seconds | Label |
|---|---|
| < 300 | Short |
| 300–900 | Medium |
| 900–1800 | Long |
| > 1800 | Feature |

### Arc type
Source: sequence of phrase tone labels across the funscript

| Pattern | Label |
|---|---|
| Same tone throughout | Flat |
| Tone intensity increases toward end | Building |
| Alternating high/low intensity phrases | Episodic |
| Low → high → release at end | Climactic |

### Dominant mood
Source: most frequent phrase tone label

Maps directly to the tone vocabulary:
Build / Climax / Tease / Edge / Tender / Dominant

### Variety
Source: count of distinct phrase tone labels

| distinct types | Label |
|---|---|
| 1–2 | Focused |
| 3–4 | Varied |
| 5–6 | Complex |

---

## Tone Suggestion

Derived from arc type + dominant mood + intensity. Pre-populates Tone tab.
Author can override. This is a suggestion, not a lock.

| Derived characteristics | Suggested tone |
|---|---|
| Dominant mood = Tease, Edge-heavy phrases | Teasing |
| Clear building arc, climax phrase at end | Build → Climax |
| High avg BPM throughout, Dominant phrases | Dominant |
| Low BPM, Tender phrase heavy | Tender |
| Episodic arc, mixed phrase types | Varied (no single suggestion) |

The Tone tab opens with this suggestion already selected.
User walks in with a recommendation. The easy button.

---

## Tag Generation for Liquid Releasing Hub

Auto-generated tags (shown with distinct style in UI):
- `pace:slow` / `pace:medium` / `pace:fast` / `pace:intense`
- `intensity:low` / `intensity:medium` / `intensity:high` / `intensity:extreme`
- `depth:shallow` / `depth:mid` / `depth:deep` / `depth:full`
- `duration:short` / `duration:medium` / `duration:long` / `duration:feature`
- `arc:building` / `arc:episodic` / `arc:climactic` / `arc:flat`
- `mood:teasing` / `mood:intense` / `mood:tender` / etc.

Human-input tags (author adds manually, different color chip):
- Genre (content type — we can't infer this)
- Source title / performer / studio
- Custom Hub discovery tags

---

## Video Motion Cross-Check (if analyzed)

If motion heatmap data exists, cross-check against funscript:
- High funscript intensity + low video motion → flag: "funscript may not match video"
- Low funscript intensity + high video motion → flag: "consider more active funscript"
- Good match → "✅ Motion consistent with funscript"

---

## UI Behavior

Author & credits expander:
- Auto-populated fields show a subtle "auto" badge
- All fields are editable — author override always wins
- Tags shown as chips: auto-generated (muted) vs manual (accent color)
- "Refresh auto-detect" button if funscript changes

Tone tab:
- Opens with suggested tone pre-selected
- Shows rationale: "Suggested based on: dominant mood Tease, building arc, medium intensity"
- One-click accept or choose different

---

## Implementation Notes

- Auto-detection runs in funscript_stats() or a new derive_metadata() function
- No additional analysis needed — all inputs already computed
- derive_metadata(stats, phrases) → dict of labels + suggested tone
- Saved to .forge file under "auto_metadata" key
- Shown in UI alongside author-editable fields
