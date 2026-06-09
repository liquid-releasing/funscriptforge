# Chart Cache Architecture

> **Historical note.** This document originally addressed a Streamlit-specific
> re-render problem (Streamlit re-ran every tab on each `st.rerun()`, forcing
> full-page PNG repaints). The Tauri + React app no longer has that constraint —
> React re-renders only the active component, and charts are drawn live by
> forgemoment from data rather than as server-rendered PNGs. The **chain-cached
> `PointSeries`** model below survives because it is framework-agnostic: `cli.py`
> still emits per-stage `PointSeries` JSON, and caching avoids recomputing the
> expensive velocity-color pass for every view.

## Original problem (Streamlit era)

Streamlit re-rendered ALL tabs on every `st.rerun()`. Each Accept triggered
a full page rebuild. With vibrant static PNG charts (2-3s each) across
8 tabs, this created 15-20s repaints even when the user only saw one tab.

## Solution: Chain-Cached PointSeries

### Chain stages
```
Original → Device → Tone → Phrases
```

Each Accept computes and caches a `PointSeries` (velocity colors, positions,
timestamps) for its output. This is the expensive step (~1s for 23K actions).

### Cache keys
```
chain_series_device   → PointSeries after device awareness
chain_series_tone     → PointSeries after tone applied
chain_series_phrases  → PointSeries after phrase edits
chain_bands           → AnnotationBand list (phrase boundaries)
```

### Chart rendering (cheap, from cached PointSeries)
Each view requests a chart with or without overlays. (In the Streamlit era this
was a server-rendered PNG; in the React app forgemoment Charts draw the same
cached `PointSeries` directly.)

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

### Why PointSeries, not PNG
- PointSeries is framework-agnostic — it now renders directly in React (forgemoment
  Charts), and historically rendered to Matplotlib PNG / Plotly
- Same data, different overlays per view (with/without phrase boxes)
- Phrase box changes don't require re-computing velocity colors
- Smaller in memory than PNG bytes, and serializes cleanly to JSON across the
  `cli.py` → Rust → React bridge

### Why caching still helps
In the React app the UI no longer re-renders every tab, so the original full-page
repaint cost is gone. Caching the per-stage `PointSeries` still pays off because the
velocity-color pass (~1s for 23K actions) is expensive — computing it once per stage
and reusing it across views keeps interactions instant.
