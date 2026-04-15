# FunscriptForge — Backlog

Items are loosely ordered by dependency and value. Move to DONE when shipped.

---

## Open — v1 Ship

### Code signing for desktop app

Sign the Windows `.exe` and macOS `.app` to eliminate SmartScreen/Gatekeeper
warnings on first launch. Linux doesn't need signing.

**Why v1, not alpha**: alpha users tolerate "unknown publisher" clickthroughs.
v1 users on mainstream distribution won't — SmartScreen warnings kill conversion
and look unprofessional.

**Windows**:

- OV or EV code signing certificate (~$200-400/year from DigiCert, Sectigo,
  SSL.com). EV removes SmartScreen warning immediately; OV builds reputation
  over time.
- Sign with `signtool sign /fd sha256 /tr <timestamp-url> /td sha256 FunscriptForge.exe`
- Add signing step to `.github/workflows/release-desktop.yml` with cert stored
  as GitHub secret

**macOS**:

- Apple Developer Program ($99/year)
- Developer ID Application certificate
- `codesign --deep --sign "Developer ID Application: ..." FunscriptForge.app`
- Notarize with `notarytool submit ... --wait` — required for Gatekeeper
- Staple the notarization: `stapler staple FunscriptForge.app`
- Add secrets: APPLE_ID, APPLE_TEAM_ID, APPLE_APP_PASSWORD, cert .p12

**Cost**: ~$300-500/year total. Defer until alpha feedback confirms the
warnings are hurting adoption. Reference: `internal/design/desktop_app.md`
"Phase 3: Polish" section.

---

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

### Device Awareness tab — IMPLEMENTED (2026-03-22)

Device tab applies minimum-fix clamp globally before Tone. Redesigned:

- Device selection: Handy, OSR2, Estim FOC, Estim Stereo, Generic/Intiface
- Limits table shows combined constraints + bottleneck device per parameter
- Minimum-fix algorithm: only clamps violating actions, preserves the rest
- Side-by-side preview: Original | Device Aware, plus full-width result chart + stats
- Intensity spikes slider for estim (None/Rare/Moderate/Frequent)
- Device specs in `forge/device_specs.json` — community-refinable without code changes
- Vocabulary: "awareness" not "safe" (liability)

**Decided:** Device before Tone. Device = physics, Tone = feel.

**TODO:** Per-device export subfolders (`output/handy/`, `output/estim-stereo/`).
**TODO:** Every transform that modifies positions should verify result stays within device limits.

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

### Workflow templates — export (v1)

Export a `.forgetmpl` file alongside funscripts on every export. The template
captures all workflow decisions (tone, sliders, device settings, phrase rules)
without project-specific data (paths, timestamps).

v1 scope: export only. Validate that templates capture enough to replay.

---

### [v2] Workflow templates — import + catalog + CLI

- Import `.forgetmpl` on Project tab → pre-fill all decisions, user walks through
- Ship starter templates: Driving Beat, Hypnotic Mix, Romance, Party Mix, Intensity
- Template catalog in UI
- Community template sharing
- CLI batch processing: `funscriptforge run --project x.forgeproj --template y.forgetmpl`
- `.forgeproj` = project definition (input files, output folder, devices)
- `.forgetmpl` = reusable decisions (tone, sliders, phrase rules, stim prefs)

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

## Done — Component Refactor (2026-03-21)

Extracted shared components to [forge-ui-components](https://github.com/liquid-releasing/forge-ui-components).
See [ARCHITECTURE_components.md](../docs/architecture/ARCHITECTURE_components.md) for details.

- ✅ funscript_chart — monochrome + vibrant, replaced 6 inline chart functions (~600 lines removed)
- ✅ file_picker — 4 pickers in project_tab, upload guard + callbacks
- ✅ beat_bar — wraps videoflow AudioBeatMap, replaces inline librosa
- ✅ project_status — sidebar dashboard, ProjectStatus snapshot
- ✅ visualizations/ — converted to backward-compat shims
- ⬜ transform_editor — stub (already shared via transform_picker.py, extraction later)
- ⬜ tone_selector — stub (extraction when Tone panel becomes reusable per-phrase)

Related: cloned xolvco/media-tools (ffmpeg probe/audio/video) and xolvco/videoflow (beat analysis, scene detection).

### Remaining component work

- Replace pymediainfo with media-tools probe() for video/audio stats
- Extract device_specs to shared lib (forge-core) for ForgePlayer/SyncPlayer/forgegen
- Delete visualizations/ shims once all consumers are migrated

---

## Done — Phrases UX + Device Awareness (2026-03-22/23)

- ✅ White phrase boxes + P labels
- ✅ Auto-accept workflow: Prev/Next/Done nav, Cancel reverts all
- ✅ All 6 tones as phrase transforms (Tone category first in picker)
- ✅ Vibrant chart data cached on Device/Tone Accept
- ✅ Phrases tab Accept button with green guidance
- ✅ Device specs JSON with minimum-fix clamp algorithm
- ✅ Device tab redesign: limits table, analysis, preview, intensity spikes
- ✅ Re-clamp after Tone (preview + Accept)
- ✅ Estim: speed=250, delta=100, 125 BPM comfort
- ✅ "Safe" → "aware" vocabulary sweep
- ✅ Large funscript threshold raised to 25K (full color lines)
- ✅ CLI: device-aware command
- ✅ File upload spinner

### Open from testing

- Re-clamp after phrase/pattern transforms (Tone done, phrases TODO)
- Pattern instance mismatch bug (table checkbox vs editor number)
- Pattern editor below table — user doesn't see it
- Reorder Catalog tab (right of Export in tab bar)
- Reorder items in Catalog view (Tone on top)
- Save to catalog / Apply to all need (i) tooltips
- Multiple transform chain visibility
- Tone tab double-rendered cards

---

## Open — Existing

### Set up test environment with real funscript files

Assemble a set of real funscript files for comprehensive testing:
- Fast/driving beat content
- Slow/hypnotic content
- Mixed/varied content
- Short clips and long (90+ min) files
- Files with matching video/audio for beat detection testing

Owner: Bruce

---

### Fix hosting site for release cycle testing

Set up the deployment/hosting infrastructure so we can test the full
release cycle (build → deploy → install → run). Mac arrives 2026-03-20
for cross-platform testing.

Owner: Bruce

---

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
