# Project tab — backlog

## Project cleanup buttons

Two buttons on the Project tab for getting back to a clean state without
opening a file manager.

### (a) Reset this project

Deletes the `.forge/{stem}/` chain files and progress for the currently
loaded project. Keeps the original funscript and the project file. Lets
you re-run the workflow from scratch on the same input.

- **Risk**: low
- **Confirmation**: simple yes/no dialog
- **Use case**: "I made a mess of the transforms, start the workflow over"

### (b) Delete this project entirely

Removes the project's `.forge/` folder + the `.forge` JSON file next to
the funscript. The original funscript stays. User can re-create the
project on next load.

- **Risk**: medium — wipes all assessment / progress / chain files
- **Confirmation**: confirm dialog with project name typed in, or two-click
- **Use case**: "I want to load this funscript fresh as if I never opened it"

### Open questions

- Where exactly on the Project tab? Top (with project name) or bottom
  (after locations + media)?
- Should (a) preserve the assessment cache (so the slow tag-detection
  doesn't have to re-run) or wipe it too?
- Should there be a "reset to last commit" mid-tier option that only
  rolls back since the last `Accept`?

### Out of scope (future, separate features)

- **Wipe ALL projects** (nuclear option for testing) — would need typed
  confirmation. Dev tool only. Don't ship in user-facing UI.
- **Clear output folder only** — wipes the `mechanical/` + `estim/`
  subfolders, the heatmap, the copied media, but leaves the in-progress
  chain files. Lets you re-export cleanly. Different feature.

---

## Funscript source path display (SHIPPED 2026-04-11)

Project tab now shows both the **Funscript source** path and the
**Export location** in the Locations section. If the source path is
inside a temp folder (which happens when the user uploads via the
browser), a warning explains that exports will also be temporary and
suggests pasting a real disk path instead of uploading.

## Load funscript from disk path (NOT YET SHIPPED — 2026-04-11)

The current `render_upload` widget is upload-only — the only way to
get a funscript into FunscriptForge is via Streamlit's file uploader,
which copies the file into `tempfile.mkdtemp()`. This means
`_default_output_for()` derives an export folder under `Temp/`, and
all exports land in a folder Windows may clean up.

Workaround today: warning banner in the Locations section explains
the situation but offers no fix.

Real fix: add a "**Load from path**" option next to the upload widget.
A `st.text_input` accepting an absolute path, with a Browse button
(via `forge_ui_components.file_picker` if it supports OS-native browse)
or just paste-and-Enter. When the path is set, `funscript_path` points
at the real file on disk and `_default_output_for()` produces a real
`.forge/{stem}/` next to it.

Open question: should the upload path stay (for users without a real
filesystem path, e.g. iOS Safari) or be removed entirely? Probably
keep both: upload for newcomers, path for repeat users who know where
their files live.

This isn't strictly required for the export-restructure PR but it's
the most-impactful follow-up because every export today goes to temp.
