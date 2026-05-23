# Chrome pass — Phrases / Patterns / Stanzas / Characters

Reference: [`funscriptforge,viewer_shape.png`](funscriptforge,viewer_shape.png).

Scope (2026-05-23, user clarified):
> "this is not a redesign, just some fixes to how the big blocks go and what they are colored. spacing colors etc should all use the current css you already have."

So: block positioning + which existing CSS tokens are applied to which surfaces. No new tokens, no new affordances that need data wiring (character subtitle, acoustic stats, suggested transform → defer until data exists).

## Block positioning changes

1. **Collapse button moves back to the LEFT panel** (strip header row, top right). It was briefly in the right column above the viewer for "stable position across collapse" — the paint mock shows it on the left. Revert.
2. **Right column = just the MediaViewer card.** No collapse, no extra wrapper chrome above it.
3. **Drop the divider between the chapter ribbon and the editing surface** so they read as one continuous workspace, not two stacked panels.

## Selected-state visual family

Three different selection treatments; don't fight to unify them all:
- **Top tab bar** ("Phrases" tab) — dark rounded-top, white text, no underline.
- **Lens chip strip** ("Audio" inside MediaViewer) — should match the top tab bar.
- **Ribbon band** ("ch1") — colored band with white border outline. Inherently different (it's an outline over a colored waveform, not a chip).

The chip-strip-↔-top-tab-bar parity is the only one to actively check.

## Deferred (need data wiring first)

- Per-slice character subtitle (`● bass-heavy · silent`) — phrase's audio fingerprint, not in sidecar today.
- Acoustic stat row (`E: N [lo-hi]  ƒ: NHz [lo-hi]  ♩ NN`) — same source.
- Suggested-transform affordance (`Suggested transform: <name> — <desc> — mark as reviewed`) — pattern data has `suggestedTransformId`, phrase data doesn't yet.

When the data lands, the right-column viewer header gets the first two; the strip header on the left gets the third.

## Per tab

- **Phrases / Patterns**: apply both positioning changes above (Collapse → left, no right-column chrome) plus drop the divider.
- **Stanzas**: smaller surface; mirror Phrases when the chrome lands.
- **Characters**: skeleton today, defer.
