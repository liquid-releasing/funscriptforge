# FunscriptForge — Backlog

Items are loosely ordered by dependency and value. Move to DONE when shipped.

---

## Open — v1 Ship

### Accept pattern on all tabs

Every tab with user actions gets an Accept button. No arrow, no auto-navigation.
Advisory text below Accept after processing: "Your next step in the workflow is **[Tab]**."

Consider: workflow mermaid diagram showing completed (filled) vs remaining (outline) steps.

- Remove `→` from Accept buttons on Project and Tone tabs
- Add advisory text after Accept completes
- Apply same pattern to Device Awareness, Phrases, Stim, Export tabs

---

### Tone tab refinements

1. **Dual suggestions** — "Enhance what you have" + "Add variety." Monotone scripts get variety, varied scripts get a new arc.
2. **Impact slider** — How much of the tone to apply (0 = no change, 1 = full tone). Top slider, above the others.
3. **Variable slider count** — Show all effective sliders per tone (1–4, not fixed at 2). Pull from sensitivity matrix data.
4. **Save to config** — Tone selection, slider values, and modified funscript saved to .forge on Accept.
5. **Edger credit** — "Incorporates the significant work of Edger's Funscript-Tools" with link to GitHub repo.

---

### Device Awareness tab (new — after Tone, before Phrases)

Apply device-safe fixes globally before phrase editing. Tab layout:

- Device selection checkboxes (moved from Project tab)
- Phrase detection settings (moved from top of Phrases)
- Beat bar plotly (if video/audio loaded) for reference
- Fix strategy: `[X] Performance [ ] Halve strokes [ ] Shorten strokes [ ] Beat`
  - **Note:** "Rebuild from beats" requires pre-release testing. Mark as roadmap — do not ship without validation against multiple funscripts and beat data sources.
- Apply scope: `[ ] Entire funscript [ ] Alternate by phrase [ ] Random by phrase`
- Accept rebuilds phrase list, creates full-color chart for Phrases tab
- Saves devices + decisions to .forge config

Design: sections are [Headline][Small description][Plotly]

Open question: Device fix before or after Tone? Leaning before — make it right sooner.

Export change: device-specific subfolders (`output/Timeline1/handy/`, `output/Timeline1/estim-foc/`).

---

### Phrases tab — Tone as first transform

- Add Tone as first radio option in Transform selector: [Tone][Behavior][Structure][Plugins]
- Default selection = currently applied global Tone (no change if already applied)
- Dropdown shows the Tone sliders including Impact as top slider
- Video/audio player for phrase preview (was implemented in earlier branch — check history)
- Beat bar between as-is and preview sections for reference
- Preview works as currently laid out

---

### ReTransform → rename to "Stim"

- Only visible when estim is selected as output device
- Fixed chart scale (don't auto-rescale on slider changes)
- Show generated channels: alpha, beta, pulse_frequency
- Consider showing all 4 channel charts (with last selectable to toggle others)
- Edger credit + link to advanced Funscript-Tools
- Re-ask output device checkboxes at top of tab
- On Accept: show workflow diagram

---

### Export improvements

- Copy input media to output folder
- Device-specific subfolders per selected device
- Show output folder location prominently
- On completion: "Open in Explorer/Finder" button
- Progress wheel shows generation with stroke/action count

---

### Play tab (placeholder)

Placeholder tab with text: "SyncPlayer is coming soon."
Links to SyncPlayer repo when available. Could ship as part of this release.

---

### Cleanup: uidesign_for_v1_considerations.md → user guide → delete

Before deleting `funscriptforge/uidesign_for_v1_considerations.md`:

1. Extract design learnings that help users make good decisions and incorporate
   into user guide docs (e.g. why Device before Tone, why Impact slider exists,
   what each fix strategy does, how Tone respects global arc at phrase level,
   the "don't match — complement" suggestion philosophy).
2. Ensure all actionable items are captured in this backlog.
3. Then delete the file.

The content has been captured in this backlog but the *reasoning* behind
decisions should live in user-facing docs, not just developer notes.

---

## Open — Existing

### Test FunscriptForge on Linux

Build and run the Linux PyInstaller package end-to-end to verify the Linux release works before shipping to users.

- Build using `build_linux.sh` in WSL2 (Ubuntu) or a native Linux machine
- Verify the app launches, browser opens, and a funscript loads correctly
- Check `xdg-open` browser behaviour in both WSL2 (Windows 11) and native Linux
- Confirm ffprobe/media player gracefully handles missing ffmpeg (guide user to `apt install ffmpeg`)
- Add any Linux-specific troubleshooting rows to `docs/INSTALL.md`
- Update CI if any spec or dependency changes are needed

---

### Zoom and pan on main editor charts · [#14]

The waveform chart in the media player supports Plotly's built-in zoom and pan
(scroll to zoom, drag to pan). Enable the same on the main editor charts:

- **Phrase Selector** — BPM timeline and phrase chart; zoom to inspect dense sections
- **Phrase Detail** — original action chart and transform preview chart; zoom to
  align a specific beat or verify a transition
- **Pattern Editor** — per-phrase action chart; zoom to compare phrases side by side

Implementation: set `displayModeBar: "hover"` (or `true`) in Plotly config so
the zoom/pan/reset toolbar appears on hover. Currently set to `false` everywhere.
Consider persisting zoom state across rerenders so it survives Streamlit widget
interactions without snapping back to full range.

Note: the player waveform chart already supports zoom/pan. Double-click resets
to full range. A hint line is shown below the chart after it renders.

---

### Register FunscriptForge trademark · [#10]

`funscriptforge.com` is registered. File a trademark application for
**FunscriptForge** with USPTO (US) before SaaS launch to protect the brand.

- File under USPTO in relevant class(es) — software / interactive entertainment
- Until registration is confirmed, use ™ (unregistered claim): **FunscriptForge™**
- Once registered, switch to ®: **FunscriptForge®**
- "funscript" / ".funscript" is a community file format — do not claim ownership;
  keep the README notice: *"The .funscript file format is a community standard
  not owned by Liquid Releasing."*
- Consider EUIPO filing if EU market is targeted

---

### Upload funscripts · [#5](https://github.com/liquid-releasing/funscript-updater/issues/5)

Allow the user to upload a `.funscript` file directly from the browser instead
of requiring it to live on disk under `test_funscript/`. The uploaded file
should be written to a temp location, assessed on the fly, and treated exactly
like a locally-loaded file for the rest of the session.

Acceptance criteria:

- `st.file_uploader` in the sidebar (accepts `.funscript`)
- Uploaded file saved to `output/uploads/` so the path-based session state still works
- Existing local-file picker remains available alongside upload

---

### Upload and sync media / audio for playback · [#6](https://github.com/liquid-releasing/funscript-updater/issues/6)

Users often want to hear the audio track while reviewing or editing a phrase to
confirm timing and feel.

Scope:

- `st.file_uploader` accepting common audio/video formats (`.mp4`, `.mkv`, `.mp3`, `.m4a`, `.wav`, `.ogg`)
- Uploaded media stored in `output/uploads/` for the session
- Audio/video player embedded in the UI (`st.audio` / `st.video` or custom HTML5 player via `st.components`)
- **Timestamp display** — show the current playback position (M:SS) in real time so the user can note cut points
- **Seek to phrase / segment** — when a phrase or segment is selected in the Pattern Editor or Phrase Selector, a button seeks the player to that phrase's `start_ms`
- **Loop mode** — option to loop the current phrase window so the user can listen while adjusting transform sliders
- Stop / play controls visible alongside the chart (no scrolling required)

---

### Clean up UI tabs — remove stale / low-value tabs · [#7](https://github.com/liquid-releasing/funscript-updater/issues/7)

The current tab bar has grown over time. Audit and remove or merge tabs that
no longer pull their weight, keeping only what a first-time user actually needs.

Candidate tabs to review:

- **Navigator** — mostly superseded by the Phrase Selector chart; consider folding remaining value into Assessment or removing
- **Work Items** and **Edit** — evaluate whether these should merge into a single panel now that the Pattern Editor handles most per-phrase work
- **Assessment** — keep as read-only reference; consider collapsing into an expandable section of the Phrase Selector

Target tab order after cleanup (proposal — confirm before implementing):

1. Phrase Selector (viewer)
2. Pattern Editor
3. Catalog
4. Work Items / Edit (merged)
5. Export

### Phrase player layout options · [#9]

The "Show player" row in Phrase Detail currently spans full width, which is fine
for focus but can feel heavy in wide-screen layouts.

Options to expose as a toggle or persistent preference:

- **Full-width (current)** — player takes its own row above charts
- **Side-by-side (3-column)** — player column | action chart | transform panel
- **Compact (1-column)** — player stacked in the transform sidebar column

Acceptance criteria:

- Layout preference persisted in `st.session_state` (or sidebar radio)
- No layout contamination when toggling between modes
- Pattern Editor player honours the same preference

---

### Generate REST API · [#8](https://github.com/liquid-releasing/funscript-updater/issues/8)

Expose the pipeline as a REST API so external tools, scripts, and the planned
SaaS web UI can consume it programmatically.

Scope:

- Framework: FastAPI (planned under `ui/web/`)
- Minimum viable endpoints:
  - `POST /assess` — upload a `.funscript`, return assessment JSON
  - `POST /transform` — upload funscript + assessment, return transformed funscript
  - `POST /customize` — upload funscript + assessment + window JSONs, return customized funscript
  - `POST /phrase-transform` — apply a named catalog transform to a phrase slice
  - `GET  /catalog` — return the persistent pattern catalog summary
  - `GET  /transforms` — list available transforms and their parameters
- Auth: API-key header for SaaS deployment; unauthenticated for local use
- Input/output: multipart form-data for file uploads; JSON for structured payloads
- OpenAPI schema auto-generated by FastAPI (available at `/docs`)

Notes: core pipeline modules are already framework-agnostic — the API layer is a thin wrapper.
`ui/web/` directory is already reserved for this purpose.

---

---

### [v2] Output folder structure redesign

The output folder is accumulating a lot of artifacts: `.forge` project file, cached
`_video_motion.json`, `_beat_data.json`, copied input files (`_input_*`), and
eventually exported funscripts and device profiles.

Redesign the output folder layout for v2:

- Separate concerns: inputs / cache / exports / project metadata
- Consider whether cached analysis (motion, beats) should live alongside exports
  or in a separate `.forge-cache/` subdirectory
- Evaluate whether the output folder should be user-visible at all, or if the
  user just picks an "export to" location and the working state lives elsewhere
- Background processing: beat analysis, motion heatmap, and assessment should
  run concurrently while the user fills out the Project tab (v1: user waits)
- Define cleanup strategy: what gets deleted on "Clear project"?

---

### [v2 · Pro] Agentic funscript authoring · [#13]

Tier: paid subscription (Pro)

Expose the FunscriptForge pipeline as tools for an AI agent so a user can
describe what they want in plain language and the agent assembles, applies,
and iterates transforms autonomously.

Example interactions:

- *"Make the frantic section feel more controlled but keep the energy"*
  → agent selects `halve_tempo` + `amplitude_scale`, previews, asks to confirm
- *"The break at 1:42 is too abrupt — soften the entry"*
  → agent locates the phrase, applies `blend_seams`, shows before/after
- *"Export a version at 80% intensity for a slower device"*
  → agent applies `amplitude_scale(0.8)` across all phrases, exports

Architecture:

- REST API (#8) provides the tool surface — each endpoint becomes a Claude tool
- Claude Agent SDK drives the loop: plan → apply transform → inspect result → iterate
- Phrase waveform player gives the agent visual/audio grounding for feedback
- Session undo stack means agent mistakes are reversible

Foundation already in place: framework-agnostic pipeline, CLI, REST API planned,
`GET /transforms` and `POST /phrase-transform` are natural agent tools.

---

### [v2 · Pro] Interactive waveform editor · [#12]

Tier: paid subscription (Pro)

Build on the phrase-restricted media player to deliver a full in-browser
funscript editor comparable to OpenFunScripter — without leaving FunscriptForge.

Core capabilities:

- **Click-to-seek** on the Plotly waveform chart — clicking a point seeks the
  player to that timestamp
- **Action point editing** — drag existing action dots up/down to change position
  (0–100); right-click to delete; double-click empty area to insert
- **Live preview** — edits reflected in real time on the waveform; transform
  preview chart updates on commit
- **Undo/redo** — integrates with the existing undo stack
- **Phrase-scoped** — all edits are confined to the current phrase window,
  consistent with the transform model

Why Pro: this is the core value proposition of dedicated funscript editors.
Offering it as a paid feature funds ongoing development while the free tier
remains fully functional for transform-based workflows.

Foundation already in place: phrase-restricted player, Plotly waveform with
animated playhead, action interpolation, phrase undo stack.

---

## Done

### Input validation and graceful error messages for malformed funscripts · [#11](https://github.com/liquid-releasing/funscriptforge/issues/11)

All pipeline file I/O now raises descriptive `FileNotFoundError` / `ValueError` with
user-friendly messages instead of crashing with bare `KeyError` or `IndexError`.
Silent `except Exception: pass` blocks replaced with specific exception handling.
Window JSON files validated for required `"start"` / `"end"` keys before parsing.
Config dataclasses validated via `__post_init__` with clear range-error messages.

Shipped in: `clean-up-and-security` → merged to `main`

---

*© 2026 [Liquid Releasing](https://github.com/liquid-releasing). Licensed under the [MIT License](LICENSE).  Written by human and Claude AI (Claude Sonnet).*
