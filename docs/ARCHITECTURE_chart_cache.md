# Chart Cache Architecture

## Problem

Streamlit re-renders ALL tabs on every `st.rerun()`. Each Accept triggers
a full page rebuild. With vibrant static PNG charts (2-3s each) across
8 tabs, this creates 15-20s repaints even when the user only sees one tab.

## Solution: Chain-Cached PointSeries + On-Demand PNG

### Chain stages
```
Original → Device → Tone → Phrases
```

Each Accept computes and caches a `PointSeries` (velocity colors, positions,
timestamps) for its output. This is the expensive step (~1s for 23K actions).

### Cache keys in session_state
```python
"chain_series_device"   → PointSeries after device awareness
"chain_series_tone"     → PointSeries after tone applied
"chain_series_phrases"  → PointSeries after phrase edits
"chain_bands"           → AnnotationBand list (phrase boundaries)
```

### PNG rendering (cheap, ~0.5s from cached PointSeries)
Each tab requests a PNG with or without overlays:

| Tab | PointSeries source | Phrase boxes | Notes |
|-----|-------------------|-------------|-------|
| Project | original (no cache) | No | Rendered fresh on load |
| Device before | original | No | |
| Device after | chain_series_device | No | |
| Tone before | chain_series_device | No | |
| Tone after | chain_series_tone | No | |
| Phrases overview | chain_series_tone (or _phrases) | **Yes** | Boxes from chain_bands |
| Patterns overview | chain_series_tone | No | Mono OK |
| Pattern detail | chain_series_tone (slice) | No | Vibrant |
| Stim input | latest chain series | No | Vibrant |
| Stim channels | separate data | No | Monochrome |
| Export preview | latest chain series | **Yes** | Boxes from chain_bands |

### When caches invalidate
- **Device Accept** → rebuilds chain_series_device, clears tone/phrases
- **Tone Accept** → rebuilds chain_series_tone, clears phrases
- **Phrase edit** → rebuilds chain_series_phrases
- **Re-analyse** → rebuilds chain_bands (phrase boundaries only)
- **New funscript** → clears everything

### Pre-compute on Accept
Each Accept pre-builds the **next expected tab's** PointSeries:
- Project Accept → pre-compute device analysis
- Device Accept → pre-compute chain_series_device
- Tone Accept → pre-compute chain_series_tone + PNG with phrase boxes
- Phrases Done → pre-compute chain_series_phrases

### Unexpected tab jumps
If a user skips tabs or goes backward:
- Check if cached PointSeries exists
- If yes: render PNG from cache (0.5s)
- If no: show spinner, compute, cache, render

### Why PointSeries not PNG
- PointSeries is framework-agnostic (can render to Matplotlib PNG, Plotly, or future React)
- Same data, different overlays per tab (with/without phrase boxes)
- Phrase box changes don't require re-computing velocity colors
- Smaller in memory than PNG bytes

### Streamlit limitation
`st.tabs` executes ALL tab blocks on every rerun. We cannot skip inactive
tabs. The cache strategy makes this tolerable — each tab renders from
cached data in milliseconds, only computing if cache is missing.
