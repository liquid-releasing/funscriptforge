# Architecture & Design

Internal documentation for developers and contributors.
These are **not** user-facing — see [docs/guide/](../guide/) for the user guide.

## Architecture

| Document | Description |
|----------|-------------|
| [Accept & Chain](ARCHITECTURE_accept_and_chain.md) | Tab workflow, cascading funscript chain, Accept pattern |
| [Chart Cache](ARCHITECTURE_chart_cache.md) | Visualization caching strategy |
| [Components](ARCHITECTURE_components.md) | Shared UI component library (forge-ui-components) |
| [Device Awareness](ARCHITECTURE_device_awareness.md) | Groove, speed clamp, combined device limits |
| [Estim Pipeline](ARCHITECTURE_estim_pipeline.md) | Three-tool estim workflow, channel vocabulary |
| [Stim & Events](ARCHITECTURE_stim_and_events.md) | Stim rendering, event handling |

## Specifications

| Document | Description |
|----------|-------------|
| [Auto Metadata](AUTO_METADATA_SPEC.md) | Auto-derived metadata — pace, intensity, arc, mood, tone suggestion |
| [Haptic Composition](HAPTIC_COMPOSITION_SPEC.md) | Three-layer haptic composition — base + beats + emotion |
| [Tone Tab](TONE_TAB_SPEC.md) | 6 tones, card UI, beat envelopes, caption emotion |
| [Stingy Analysis](STINGY_ANALYSIS.md) | EDA on funscript corpus — velocity, delta, BPM metrics |
| [OSS Integration](OSS_INTEGRATION_PATTERN.md) | Integration patterns with open-source tools |

## Development

| Document | Description |
|----------|-------------|
| [Development Setup](DEVELOPMENT.md) | Test assets, environment, hot-reload, optional features |
