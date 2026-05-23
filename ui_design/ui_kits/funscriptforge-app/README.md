# Funscriptforge App — UI Kit

Pixel-faithful recreation of the Funscriptforge alpha editor as reusable JSX components.

## Files
- `index.html` — interactive demo (Library → Editor flow)
- `tokens.css` — app-local layout vars on top of root `colors_and_type.css`
- `data.js` — synthetic funscript / chapters / phrases for the demo
- `primitives.jsx` — Button, Pill, Card, Field, TextInput, Slider, Segmented, Icon, format helpers
- `AppShell.jsx` — NavRail, TopBar, StatusBar
- `SectionViewer.jsx` — **the core viz**: chapter band + curve + playhead
- `Inspector.jsx` — right-panel chapter editor + chapter list + ToneIcon
- `LibraryScreen.jsx` — landing screen with recents and tone templates

## Conventions
- All components attached to `window` at the bottom of each file (Babel script-tag scope).
- Style objects scoped/inlined; no shared `styles` const.
- Icons via Lucide CDN with `<Icon name="..." />`; tone glyphs are PNGs in `/assets`.
- Time stored as **ms** everywhere; `fmtTime` / `fmtTimeShort` for display.
