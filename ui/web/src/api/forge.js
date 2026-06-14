// Platform adapter — the single bridge between the React UI and whatever
// is hosting it. Three target environments:
//
//   1. Tauri desktop  → invoke() over IPC into Rust commands (src-tauri/)
//   2. Web browser    → fetch() against an HTTP API (not implemented yet)
//   3. Browser dev    → mock fallback so `npm run dev` works standalone
//
// Every backend call MUST go through this file. Components must not import
// @tauri-apps/api directly — that would bind them to the desktop runtime
// and break the web build. When Tauri isn't loaded and no HTTP base URL is
// configured, calls fall back to mock data and UI iteration can proceed
// without the Rust toolchain.

export function isTauri() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Set VITE_API_BASE_URL at build time to point the web build at a Python
// server (FastAPI/uvicorn wrapper around the funscriptforge CLI). When
// unset, browser mode falls through to mocks.
const HTTP_BASE = import.meta.env?.VITE_API_BASE_URL || null;

async function call(command, args, mockFn) {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke(command, args);
  }
  if (HTTP_BASE) {
    const res = await fetch(`${HTTP_BASE}/${command}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(args ?? {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
  if (mockFn) return mockFn();
  throw new Error(
    `forge.${command}: no backend available. Run \`npm run tauri:dev\` or ` +
    `set VITE_API_BASE_URL for HTTP mode.`,
  );
}

// ---------------------------------------------------------------------------
// In-flight Promise dedup — when multiple component-level call-sites fire the
// same expensive command in parallel (StrictMode double-invoke, race between
// AnalysisTab auto-trigger and ChaptersTab manual click, etc), merge them into
// ONE backend invocation. Each consumer awaits the same shared Promise.
//
// This implements the rule in [[feedback-dedup-at-entry-point]]: dedup MUST
// live at the forge.js wrapper, not at consumers. Component-level guards
// (state flags, refs) have race windows React can't close; only a shared
// in-flight map at the entry point provides hard guarantees.
//
// Caller-supplied key disambiguates concurrent calls for DIFFERENT targets
// (e.g. two open projects). Same key + in-flight = shared Promise.
// ---------------------------------------------------------------------------

const _inflight = new Map();

function dedupedCall(key, runFn) {
  const existing = _inflight.get(key);
  if (existing) return existing;
  const p = (async () => runFn())()
    .finally(() => { _inflight.delete(key); });
  _inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------------
// API surface — one wrapper per Tauri command. Mirrors forgegen/api/videoflow.
// As real commands land in src-tauri/src/commands.rs, add wrappers here.
// ---------------------------------------------------------------------------

/** Sanity-check the bridge. Returns { runtime, version } from Rust, or a
 *  mock equivalent in browser mode. Wired up so the dev loop can immediately
 *  see whether the desktop bridge is alive. */
export function ping() {
  return call('ping', undefined, () => ({
    runtime: 'browser-mock',
    version: '0.0.1',
  }));
}

/** Target devices supported by the funscriptforge pipeline. Mirrors the
 *  device catalog the Streamlit UI ships from forge/devices.py. Real backend
 *  will read the user's calibrated device list; mock returns the canonical
 *  six. */
export function listDevices() {
  return call('list_devices', undefined, () => [
    { id: 'handy',   label: 'The Handy',   icon: 'cpu',     maxBpm: 600, axes: 'linear',     summary: 'Linear stroker · 600 BPM ceiling' },
    { id: 'ohmibod', label: 'OhMiBod',     icon: 'radio',   maxBpm: 0,   axes: 'vibration',  summary: 'Vibrator · vibration intensity' },
    { id: 'kiiroo',  label: 'Kiiroo Keon', icon: 'cpu',     maxBpm: 240, axes: 'linear',     summary: 'Linear stroker · 240 BPM ceiling' },
    { id: 'estim',   label: 'E-stim',      icon: 'zap',     maxBpm: 0,   axes: 'estim',      summary: 'Electrostim · driven by Stim tab' },
    { id: 'sr6',     label: 'OSR2 / SR6',  icon: 'axis-3d', maxBpm: 300, axes: 'multi-axis', summary: 'Multi-axis · L0 + roll/pitch/sway' },
    { id: 'lovense', label: 'Lovense',     icon: 'radio',   maxBpm: 0,   axes: 'vibration',  summary: 'Vibrator · vibration intensity' },
  ]);
}

/** The six canonical tones, in intensity order (softest → hardest). Mirrors
 *  the source-of-truth list in [funscriptforge/forge/tabs/tone_tab.py] —
 *  Tender, Build, Tease, Edge, Climax, Dominant are locked vocabulary; adding
 *  or renaming is a breaking change across the whole pipeline.
 *
 *  Icons live in /public/tones/ (copied from funscriptforge/assets/tone_cards/);
 *  the path is relative to the served origin so it works in both Tauri and web
 *  builds. */
export function listToneTemplates() {
  return call('list_tone_templates', undefined, () => [
    { id: 'tender',   label: 'Tender',   tagline: 'Slow and close',         color: '#4a90d9', icon: '/tones/tender.png' },
    { id: 'build',    label: 'Build',    tagline: 'Tension grows',          color: '#2ecc71', icon: '/tones/build.png' },
    { id: 'tease',    label: 'Tease',    tagline: 'Pull back at the peak',  color: '#9b59b6', icon: '/tones/tease.png' },
    { id: 'edge',     label: 'Edge',     tagline: 'Hold there',             color: '#f39c12', icon: '/tones/edge.png' },
    { id: 'climax',   label: 'Climax',   tagline: 'Everything, now',        color: '#e74c3c', icon: '/tones/climax.png' },
    { id: 'dominant', label: 'Dominant', tagline: 'Driving, relentless',    color: '#2c3e50', icon: '/tones/dominant.png' },
  ]);
}

// ---------------------------------------------------------------------------
// File picker — Tauri dialog plugin (desktop) or web file input (browser).
// ---------------------------------------------------------------------------

/** Load a funscript + any adjacent sidecar files into a project. Real Tauri
 *  command should read `<path>.funscript`, look for `<stem>.ffmeta.json`
 *  (project metadata) and `<stem>.chapters.json` (chapter boundaries) next
 *  to it, parse actions, downsample for preview, and return a unified
 *  project object the React side can drive the Project tab from.
 *
 *  Shape (target):
 *    { id, path, title, duration, mediaKind, actions: [{at,pos}],
 *      chapters: [...], phrases: [...], ffmeta: {...}, sidecarsFound: [...] }
 *
 *  Mock: synthesises a project from the basename so the Project tab can be
 *  exercised before the bridge lands. */
export function loadProject(path) {
  return call('load_project', { path }, () => mockLoadProject(path));
}

/** Equal-split the funscript into `n` chapters and write the
 *  `<stem>.chapters.json` sidecar. Used from the Chapters tab when the user
 *  kicks off chapter creation on a project that has no existing sidecar.
 *  Returns the new chapter records. Browser-mode: just synthesises chapters
 *  in memory (no disk write). */
export function createChaptersSidecar(funscriptPath, n) {
  return call(
    'create_chapters_sidecar',
    { funscriptPath, n },
    () => Promise.resolve(synthMockChapters(754000, Math.max(1, n))),
  );
}

/** Run videoflow's content-aware chapter detector against the funscript's
 *  adjacent media file, write the `<stem>.chapters.json` sidecar, and return
 *  the resulting chapter records. The Rust side errors out if no media is
 *  adjacent — surface that to the user so they know to attach a file.
 *
 *  Cost: this is slow (librosa loads the whole audio, runs RMS / spectral-flux
 *  analysis, then clusters). Caller should show a progress indicator.
 *
 *  Deduped at the forge.js layer per [[feedback-dedup-at-entry-point]] —
 *  parallel calls for the same funscriptPath (e.g. AnalysisTab auto-trigger
 *  racing ChaptersTab manual click, or StrictMode double-invoke) merge into
 *  one Rust invocation. The orphan-process incident 2026-05-28 came from
 *  not having this guard. */
export function analyzeChaptersWithVideoflow(funscriptPath, targetMinutes, mediaPath, resume = false) {
  return dedupedCall(
    `analyze_chapters_with_videoflow::${funscriptPath}::${resume ? 'resume' : 'full'}`,
    () => call(
      'analyze_chapters_with_videoflow',
      { funscriptPath, targetMinutes, mediaPath, resume },
      () => Promise.resolve(synthMockChapters(754000, 6)),
    ),
  );
}

/** Generate a funscript from the project's media via the videoflow engine
 *  (Pace curve → density arc, Range curve → amplitude-gain arc). Returns the
 *  parsed payload: { ok, output, actions_list, bpm, beats, from_cache,
 *  stats:{position,motion,speed,dynamics}, band:{...} }. The first call on an
 *  un-analyzed source pays the librosa cost (progress streams via ff:progress);
 *  the persisted beat map makes every later call cheap.
 *
 *  Deduped per (output, curves) so a rapid preset re-pick can't stack runs.
 *  Browser/dev mode returns null — callers fall back to the stand-in
 *  generator so the verified UI never breaks without a backend. */
export function generateFunscript(opts) {
  const {
    outputPath, mediaPath = null, beatsPath = null,
    paceCurve = null, rangeCurve = null,
    low = null, high = null, center = null,
    strokeDensity = null, source = null, title = null, force = false,
  } = opts || {};
  return dedupedCall(
    `generate_funscript::${outputPath}::${paceCurve || ''}::${rangeCurve || ''}`,
    () => call(
      'generate_funscript',
      {
        outputPath, mediaPath, beatsPath, paceCurve, rangeCurve,
        low, high, center, strokeDensity, source, title, force,
      },
      () => Promise.resolve(null),
    ),
  );
}

/** Wipe a project's `.forge/` cache (sidecars + clips) so the next analyze
 *  runs fresh from extract. Used by the AnalysisTab's Re-analyze button.
 *
 *  Returns true if the directory was removed, false if it didn't exist
 *  (clean no-op). Errors (locked files, permission denied) propagate. */
export function wipeForgeDir(mediaPath) {
  return call(
    'wipe_forge_dir',
    { mediaPath },
    () => Promise.resolve(false),
  );
}

/** Run `cli.py assess` against the funscript and return the parsed phrase
 *  records. Used by the Phrases tab to hydrate its per-phrase edit table.
 *  Each record: { id, at_ms, end_ms, number, bpm, tag, all_tags,
 *  pattern_label }. Cost: full FunscriptAnalyzer pipeline (a few seconds
 *  on real-length funscripts) — caller should drive the footer busy
 *  indicator while it's in flight. Browser-mode mock returns empty so
 *  the empty state renders.
 *
 *  Deduped at the forge.js layer — both ChaptersTab (bundled analyze) and
 *  PhrasesTab (lazy hydrate) can call this concurrently for the same path. */
export function analyzePhrases(funscriptPath) {
  return dedupedCall(
    `analyze_phrases::${funscriptPath}`,
    () => call(
      'analyze_phrases',
      { funscriptPath },
      () => Promise.resolve([]),
    ),
  );
}

/** Read the cached phrase slice sidecar that `cli.py assess` writes
 *  into `.<stem>.forge/<stem>.phrases.json`. Cheap (no analyzer run,
 *  just JSON read). Returns `null` when the sidecar is missing —
 *  caller renders an "analyze first" CTA. Used by PatternsTab to
 *  populate the per-chapter phrase list without paying the full
 *  analyze cost on every tab mount; the schema is shared with future
 *  consumers (PhrasesTab will migrate to this cached path too once
 *  the shape field is the source of truth).
 *
 *  Returns: `{ version, slices: [{ id, at_ms, end_ms, label,
 *    chapter_id, metrics }] }` where `label` is one of the 8 shape
 *  ids (steady/pulse/three_one/tide/drift/burst/taper/swell) from
 *  assessment/shape_labeler.py. */
export function loadPhrasesSidecar(funscriptPath) {
  return call(
    'load_phrases_sidecar',
    { funscriptPath },
    () => Promise.resolve(null),
  );
}

/** Read the `stanzas` array out of videoflow's chapters sidecar.
 *  Distinct from loadPhrasesSidecar above — that one reads
 *  funscriptforge's editing-phrase `.phrases.json` sidecar (cycle-
 *  character segments from FunscriptAnalyzer). This one targets the
 *  merged sidecar that videoflow's auto_chapter pipeline writes at the
 *  `sidecar` stage: `.<stem>.forge/<stem>.chapters.json` with a
 *  `stanzas` key (16-beat rhythmic units).
 *
 *  Stanza shape: `{ id?, at_ms, end_ms, mode, chapter_id?, chapter_idx? }`
 *  where `mode` is one of `tease / steady / edging / break / fast / slow`
 *  (the vocabulary videoflow.stanzas.py classifies into). Returns an
 *  empty array if the file is missing or hasn't been filled in yet —
 *  caller renders an empty state, no error path. */
export function loadAutoChapterStanzas(mediaPath) {
  return call(
    'read_stanzas_from_chapters_sidecar',
    { mediaPath },
    () => Promise.resolve([]),
  );
}

/** Count finished chapter-clip files in a project's `.forge/clips/` dir.
 *  The Analysis tab compares this to chapters.length to detect an analyze
 *  interrupted DURING chapter_clips (all sidecars present, clips
 *  incomplete) — the case that should offer Resume. Fallback 0 outside
 *  Tauri (clips never block the state machine when the count is unknown). */
export function countChapterClips(mediaPath) {
  return call(
    'count_chapter_clips',
    { mediaPath },
    () => Promise.resolve(0),
  );
}

/** Overwrite the chapters sidecar with a user-edited chapter list.
 *  Used by ChaptersTab's split / join handlers. Rust read-merges so
 *  videoflow's `phrases` + `energy` keys (written by auto_chapter at
 *  the `sidecar` stage) survive — we only replace the `chapters`
 *  array and stamp `edited_by_user: true` on the payload.
 *
 *  `sourcePath` is whichever path the sidecar belongs to —
 *  `project.mediaPath ?? project.path`. Matches the priority chain
 *  load_project uses to find chapters. Browser-mode is a no-op
 *  (in-memory state only). */
export function writeChaptersSidecar(sourcePath, chapters) {
  return call(
    'write_chapters_sidecar',
    { sourcePath, chapters },
    () => Promise.resolve(),
  );
}

/** Read videoflow-classified stanzas (audio phrases) plus computed
 *  clusters from the `<stem>.chapters.json` sidecar next to a funscript
 *  or media file.
 *
 *  Returns:
 *    {
 *      stanzas:  [{ id, number, chapter_idx, at_ms, end_ms, mode, source }],
 *      clusters: [{ id, label, stanza_ids, mode, length_bucket, density_bucket }]
 *    }
 *
 *  Clusters bucket stanzas by (mode × length × density) and only surface
 *  groups of ≥2 members — singletons stay unclustered. Cheap (just reads
 *  JSON + computes density), no analyzer pipeline. Returns empty stanzas
 *  + empty clusters when no sidecar exists — caller renders an empty
 *  state nudging the user to run auto-chapter first. */
export function readStanzas(funscriptPath) {
  return call(
    'read_stanzas',
    { funscriptPath },
    () => Promise.resolve({ stanzas: [], clusters: [] }),
  );
}

/** List stim characters — built-in presets merged with the user's
 *  stim_presets.json overrides. Surfaces the canonical Python source for
 *  the Characters tab (matches the Streamlit panel's catalog). Returns:
 *
 *    { characters: [{ id, label, description, sliders: [...] }], warning?: string }
 *
 *  Slider records pass through as raw JSON — schema lives in
 *  funscript-tools' BUILTIN_PRESETS. Browser-mock falls back to the
 *  built-in seed catalog so dev still works without the desktop runtime. */
export function listCharacters() {
  return call(
    'list_characters',
    undefined,
    () => Promise.resolve({ characters: [], warning: null }),
  );
}

/* ── Transforms — catalog + preview/apply bridge ──────────────────────
 * The TransformPanel sources its catalog from `listTransforms` (the
 * authoritative pattern_catalog, NOT the static hand-port that drifted)
 * and drives before/after previews + Apply through the Python
 * implementations. Browser-dev mocks return empty/null so the UI falls
 * back to the static seed catalog and shows originals unchanged. */

/** Full transform catalog as a {key: {name, description, category,
 *  structural, params:{pkey:{label,type,default,min,max,step,help}}}}
 *  map. Param keys are authoritative — they match what the backend
 *  apply expects (no center/target_center-style drift). */
export function listTransforms() {
  return call('list_transforms', undefined, () => Promise.resolve({}));
}

/** Preview one transform over `spans` (a list of {start_ms,end_ms}).
 *  Returns {transform, params, spans:[{start_ms,end_ms,actions:[{at,pos}]}]}
 *  — actions are the transformed result per span (structural transforms
 *  may change count/timing). Writes nothing. */
export function transformPreview(funscriptPath, transform, params, spans) {
  return call(
    'transform_preview',
    { funscriptPath, transform, params, spans },
    () => Promise.resolve(null),
  );
}

/** Apply one transform over `spans` and return the full MERGED action list
 *  — {transform, params, actions:[{at,pos}]}. Writes nothing. The editor's
 *  in-memory roll-forward (Apply): patch `actions` into the working
 *  funscript so charts reflect it; disk persistence rides the chain step.
 *  Python owns the merge so session state matches a later chain-write. */
export function transformApplyActions(funscriptPath, transform, params, spans) {
  return call(
    'transform_apply_actions',
    { funscriptPath, transform, params, spans },
    () => Promise.resolve(null),
  );
}

/** Persist the current working actions to `<stem>.work.funscript` in the
 *  forge dir — the durable save state Export reads and reopen restores. The
 *  ORIGINAL funscript is never touched. Write-through on every Apply so a
 *  close-without-Accept loses nothing. Returns {saved, edited_at}. */
export function saveWorkingFunscript(funscriptPath, actions) {
  return call(
    'save_working_funscript',
    { funscriptPath, actions },
    () => Promise.resolve(null),
  );
}

/** Revert to the original by deleting the working copy. The next
 *  load_project falls back to the pristine original. Returns {reverted}. */
export function revertWorkingFunscript(funscriptPath) {
  return call(
    'revert_working_funscript',
    { funscriptPath },
    () => Promise.resolve(null),
  );
}

/** The Events effect catalog (all 32 Edger events), projected from the
 *  vendored event_definitions + SFW/NSFW map. `{groups, recipes:[]}` —
 *  each recipe has labels, params, and the step stack. Browser-mode mock
 *  returns empty so the UI degrades gracefully. */
export function listEventRecipes() {
  return dedupedCall('list_event_recipes', () =>
    call('list_event_recipes', {}, () => Promise.resolve({ groups: [], recipes: [] })));
}

/** Read the Events tab's events from the canonical `<stem>.feel.yml`
 *  sidecar, in the EventsTab JS shape. Returns {version, events:[]}.
 *  Empty events when the sidecar is missing. Browser mode → empty. */
export function readFeelEvents(funscriptPath) {
  return call(
    'read_feel_events',
    { funscriptPath },
    () => Promise.resolve({ version: 1, events: [] }),
  );
}

/** Write the Events tab's events to `<stem>.feel.yml` (write-through on
 *  every discrete event mutation — add / edit / delete). The funscript is
 *  never touched; events layer on the output channels. Returns {saved, count}. */
export function saveFeelEvents(funscriptPath, events) {
  return call(
    'save_feel_events',
    { funscriptPath, events },
    () => Promise.resolve(null),
  );
}

/** Read the Channels tab's per-chapter character assignments from
 *  `<stem>.characters.json`. Returns {version, characters:{chapterId:{...}}}.
 *  Empty map when the sidecar is missing. Browser mode → empty. */
export function readCharacters(funscriptPath) {
  return call(
    'read_characters',
    { funscriptPath },
    () => Promise.resolve({ version: 1, characters: {} }),
  );
}

/** Write the Channels tab's per-chapter character assignments to
 *  `<stem>.characters.json` (write-through on Accept / style change). The
 *  funscript is never touched. Returns {saved, count}. Browser mode → no-op. */
export function saveCharacters(funscriptPath, characters) {
  return call(
    'save_characters',
    { funscriptPath, characters },
    () => Promise.resolve(null),
  );
}

/** Read the Channels · Passages intensity arcs from `<stem>.passages.json`.
 *  Returns {version, passages:[...]}; empty list when the sidecar is missing. */
export function readPassages(funscriptPath) {
  return call(
    'read_passages',
    { funscriptPath },
    () => Promise.resolve({ version: 1, passages: [] }),
  );
}

/** Write the Channels · Passages intensity arcs to `<stem>.passages.json`
 *  (write-through on edit, mirroring characters). The funscript is never
 *  touched. Returns {saved, count}. Browser mode → no-op. */
export function savePassages(funscriptPath, passages) {
  return call(
    'save_passages',
    { funscriptPath, passages },
    () => Promise.resolve(null),
  );
}

/** Generate e-stim channels for a chapter window via the funscript-tools
 *  pipeline (the same proven `process()` the Streamlit stim tab used).
 *  `mode` = '2d' (alpha+beta, fast) | '3phase' (10 channels, slow). Pass the
 *  character's preset LABEL (not the slug), the cv-slider overrides, and the
 *  chapter's [startMs,endMs] window. Returns
 *  {available, mode, channels:{suffix:{actions:[{at,pos}]}}}. Browser → empty. */
export function stimProcess(funscriptPath, { character, sliders = {}, mode = '2d', startMs = null, endMs = null } = {}) {
  return call(
    'stim_process',
    { funscriptPath, character, sliders, mode, startMs, endMs },
    () => Promise.resolve({ available: false, mode, channels: {} }),
  );
}

/** Generate the secondary-axis funscripts (twist/roll/pitch/surge/sway) for a
 *  chapter window via the multiaxis engine — the Mechanical editor's live draw.
 *  Pass the position-style name (Cowgirl/Doggy/…) and the chapter window.
 *  Returns {available, style, axes:{axis:{actions:[{at,pos}]}}}. Deterministic,
 *  sub-ms per chapter. Browser → empty. */
export function multiaxisProcess(funscriptPath, { style, startMs = null, endMs = null } = {}) {
  return call(
    'multiaxis_process',
    { funscriptPath, style, startMs, endMs },
    () => Promise.resolve({ available: false, style, axes: {} }),
  );
}

/** Export the canonical `<stem>.feel.yml` to a playable Edger
 *  `<stem>.events.yml`. With `write:false` nothing is written and the
 *  rendered YAML is returned anyway (Preview). Returns
 *  {path, count, skipped:[], yaml}. Browser mode → empty preview. */
export function edgerExport(funscriptPath, { out = null, write = true } = {}) {
  return call(
    'edger_export',
    { funscriptPath, out, write },
    () => Promise.resolve({ path: null, count: 0, skipped: [], yaml: 'events: []\n' }),
  );
}

/** Import an Edger `events.yml`, returning events in the EventsTab JS shape
 *  (the caller persists them via saveFeelEvents). Returns
 *  {events:[], imported, skipped:[]}. Browser mode → empty. */
export function edgerImport(eventsYmlPath) {
  return call(
    'edger_import',
    { eventsYmlPath },
    () => Promise.resolve({ events: [], imported: 0, skipped: [] }),
  );
}

/** Polish — preview the 3-pane device-clamp trace for one station over a
 *  window. Returns {station, character, clamped, performed, stats}. The live
 *  UI preview normally runs in-process via polishEngine.js; this is the
 *  authoritative/cross-check path. Browser mode → empty traces. */
export function polishPreview(funscriptPath, station, params = {}, { startMs = null, endMs = null } = {}) {
  return call(
    'polish_preview',
    { funscriptPath, station, params, startMs, endMs },
    () => Promise.resolve({ station, character: [], clamped: [], performed: [], stats: {} }),
  );
}

/** Polish — clamp the whole track for one station and write its device-ready
 *  file(s) under `<forge>/polish/<station>/`. Returns
 *  {station, saved:[], stats, source_hash} (or {pending} for e-stim until its
 *  channel generation is wired). Browser mode → null. */
export function polishApply(funscriptPath, station, params = {}, { stem = null } = {}) {
  return call(
    'polish_apply',
    { funscriptPath, station, params, stem },
    () => Promise.resolve(null),
  );
}

/** Generate the RAW e-stim channels for a preview window so the Polish preview
 *  can show the ACTUAL channels (not the position motion). Returns
 *  {station, window, channels:{name:[{at,pos}]}} rebased to 0. ~1.7s (one
 *  chapter's generation). E-stim only; other stations → empty. Browser → null. */
export function polishChannels(funscriptPath, station, startMs, endMs) {
  return call(
    'polish_channels',
    { funscriptPath, station, startMs, endMs },
    () => Promise.resolve(null),
  );
}

/** Read the `<stem>.polish.yml` stamp record. Returns
 *  {version, schema, current_hash, passes}. Browser mode → empty. */
export function polishRead(input) {
  return call(
    'polish_read',
    { input },
    () => Promise.resolve({ version: 1, schema: 'polish/v1', current_hash: '', passes: {} }),
  );
}

/** Write the `<stem>.polish.yml` stamp record (per-station passes map). The
 *  source hash is stamped Python-side. Returns {saved, count, source_hash}. */
export function polishWrite(input, passes) {
  return call(
    'polish_write',
    { input, passes },
    () => Promise.resolve(null),
  );
}

/** Export — collect the project's outputs into a loose folder or a `.forge`
 *  zip (the packager; Polish is the generator). Returns
 *  {mode, path, artifacts, stations, manifest}. Browser mode → null. */
export function exportWrite(funscriptPath, { mode = 'forge', out = null, blendSeams = false, finalSmooth = false, stem = null, media = null, stimWav = false, stimMp3 = false, includeMedia = false, exclude = [] } = {}) {
  return call(
    'export_write',
    { funscriptPath, mode, out, blendSeams, finalSmooth, stem, media, stimWav, stimMp3, includeMedia, exclude },
    () => Promise.resolve(null),
  );
}

/** Reveal a path in the OS file manager (selects the file on Windows). */
export function revealPath(path) {
  return call('reveal_path', { path }, () => Promise.resolve(null));
}

/** Open an external URL in the user's default browser. The About dialog uses
 *  this — a plain `<a target="_blank">` does nothing inside the Tauri webview.
 *  Browser mode → window.open. */
export function openExternal(url) {
  return call('open_external', { url }, () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    return Promise.resolve(null);
  });
}

/** Launch ForgePlayer (the LQR player) as an Export hand-off. Best-effort dev
 *  launcher — locates a sibling forgeplayer/ checkout (or FORGEPLAYER_ROOT).
 *  ForgePlayer has no `.forge` importer yet, so the caller also reveals the
 *  exported file for the user to drop into a stim slot. Browser mode → null. */
export function openInForgePlayer(path) {
  return call('open_in_forgeplayer', { path }, () => Promise.resolve(null));
}

/** Import — unpack a `.forge` bundle (or a loose export folder) into a
 *  re-editable project on disk. The inverse of {@link exportWrite}: lays the
 *  motion track down as `<dest>/<stem>.funscript` and restores sidecars,
 *  stamped Polish stations, feel.yml, and the manifest into the forge dir.
 *  `outDir` defaults (backend-side) to the bundle's own folder. Returns
 *  `{ funscriptPath, stem, dest, imported, media }`; the caller loads
 *  `funscriptPath` and prompts to attach media when `media` is null. Browser
 *  mode → null. */
export async function importForgeBundle(bundlePath, outDir = null) {
  const res = await call(
    'import_forge_bundle',
    { bundlePath, outDir },
    () => Promise.resolve(null),
  );
  if (!res) return null;
  // Normalize the snake_case the CLI emits to the camelCase the UI expects.
  return {
    funscriptPath: res.funscript_path,
    stem: res.stem,
    dest: res.dest,
    imported: res.imported || [],
    media: res.media || null,
    mediaExpected: res.media_expected || null,
  };
}

/** Open a `.forge` bundle picker — the first-class onboarding input alongside
 *  pickFunscriptFile. Returns the absolute path on desktop, null if cancelled
 *  or in browser mode. */
export async function pickForgeBundle(defaultPath) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Forge bundle', extensions: ['forge'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return selected ?? null;
  }
  return null;
}

/** Open a native folder picker (directory mode). Used by Export to choose a
 *  destination other than the project folder. Returns the absolute folder path
 *  on desktop, null if cancelled or in browser mode. */
export async function pickFolder(defaultPath) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: true,
      defaultPath: defaultPath || undefined,
    });
    return selected ?? null;
  }
  return null;
}

/** Apply one transform over `spans`, writing the merged funscript to
 *  `outputPath`. Returns {saved, transform, spans}. */
export function transformApply(funscriptPath, transform, params, spans, outputPath) {
  return call(
    'transform_apply',
    { funscriptPath, transform, params, spans, outputPath },
    () => Promise.resolve(null),
  );
}

/**
 * Synthetic "Big Buck Bunny" sample project. Same shape load_project
 * returns; lives entirely in memory so the user can exercise the full
 * editor (chapters / phrases / patterns / characters / export) without
 * needing a real funscript on disk. The path is a `sample://` sentinel
 * — call sites must not pass it to load_project or any fs read.
 *
 * Mirrors the ForgeGen sample (7 chapters, 9:55, 90 BPM) so the two
 * apps share a recognisable demo asset across LQR.
 */
export function loadSampleProject() {
  const durationMs = 595_000;
  return Promise.resolve({
    id: 'sample:big_buck_bunny',
    path: 'sample://big_buck_bunny.funscript',
    title: 'big_buck_bunny',
    duration: '9:55',
    durationMs,
    mediaKind: 'video',
    color: '#ffb547',
    isSample: true,
    chapters: 7,
    chapterList: synthMockChapters(durationMs, 7),
    edited: 'just now',
    actions: null,
    actionCount: 1200,
    sidecarsFound: [],
  });
}

function mockLoadProject(path) {
  const file = String(path).split(/[/\\]/).pop() ?? 'Unknown';
  const title = file.replace(/\.funscript$/i, '');
  return Promise.resolve({
    id: `loaded:${path}`,
    path,
    title,
    duration: '12:34',
    mediaKind: 'video',
    color: '#56e0a0',
    phrases: 27,
    chapters: 5,
    // Synthetic chapter list — 5 evenly-spaced chapters across the 12:34
    // duration. Lets the Chapters tab render in browser-mode without a real
    // sidecar. The Rust bridge replaces this with the parsed chapters.json.
    chapterList: synthMockChapters(754000, 5),
    edited: 'just now',
    // Actions not pre-populated; the Project tab will synthesise a preview
    // from this stub via lib/funscriptPreview.js until the real backend
    // can return downsampled actions.
    actions: null,
    sidecarsFound: [],
  });
}

function synthMockChapters(totalMs, n) {
  const palette = ['#4a90d9', '#56e0a0', '#f39c12', '#9b59b6', '#e74c3c', '#2ecc71', '#5a8eff', '#ff8c47'];
  const out = [];
  for (let i = 0; i < n; i++) {
    const at = Math.round((i / n) * totalMs);
    const end = Math.round(((i + 1) / n) * totalMs);
    out.push({
      id: `ch${i + 1}`,
      atMs: at,
      endMs: end,
      name: `Chapter ${i + 1}`,
      intent: '',
      contentType: 'music',
      confidence: 0.8,
      evidence: [],
      color: palette[i % palette.length],
    });
  }
  return out;
}

/** Open a multi-type picker for the "Add or replace…" flow on the Project
 *  tab. The OS dialog exposes several type-group rows so the user can pick:
 *
 *  - .funscript   → load/replace the project's funscript (re-runs load_project)
 *  - .forge       → unpack the bundle into a project, then open it
 *  - audio/video  → attach as the project's media file
 *  - .chapters.json → import a chapter sidecar (future)
 *  - .ffmeta / .ffmeta.json → import the combined manifest (future)
 *
 *  Returns absolute path on desktop, null if cancelled, browser-mode null.
 *  Caller is responsible for routing by extension. */
export async function pickProjectFile(defaultPath) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Funscript',     extensions: ['funscript'] },
        { name: 'Forge bundle',  extensions: ['forge'] },
        { name: 'Audio',         extensions: ['mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac'] },
        { name: 'Video',         extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v'] },
        { name: 'Project meta',  extensions: ['ffmeta', 'json'] },
        { name: 'All files',     extensions: ['*'] },
      ],
    });
    return selected ?? null;
  }
  return null;
}

/** Compute pre-computed waveform peaks for a media file, used by the
 *  MediaViewer Audio mode. The Rust command shells out to
 *  `cli.py audio-peaks <media>` which writes `<stem>.audio.json` next to
 *  the media and reuses the cached sidecar on subsequent calls.
 *
 *  Cost: first run does a full librosa decode (tens of seconds on long
 *  files); second run is a sidecar JSON parse. Caller should drive a
 *  loading state while in-flight.
 *
 *  Returns: { hopMs, durationMs, peaks: number[] (0..1), peakCount, fromSidecar }.
 *  Browser mock synthesises a noisy sine so the Audio mode shows
 *  something instead of the placeholder. */
export function analyzeAudioPeaks(mediaPath, hopMs, force) {
  return call(
    'analyze_audio_peaks',
    { mediaPath, hopMs, force },
    () => Promise.resolve(mockAudioPeaks(hopMs ?? 10)),
  );
}

function mockAudioPeaks(hopMs) {
  // 60s of noisy sine at the chosen hop. Just enough to exercise the
  // WaveformCanvas slice math in browser mode without a real decode.
  const durationMs = 60_000;
  const n = Math.floor(durationMs / hopMs);
  const peaks = new Array(n);
  for (let i = 0; i < n; i++) {
    const env = 0.5 + 0.5 * Math.sin((i / n) * Math.PI * 4);
    const noise = (Math.sin(i * 1.7) + Math.sin(i * 0.31)) * 0.18;
    peaks[i] = Math.max(0, Math.min(1, env * 0.7 + noise));
  }
  return { hopMs, durationMs, peaks, peakCount: n, fromSidecar: false };
}

/** Load the pre-computed audio peaks sidecar for a media file (written by
 *  `videoflow.structural.auto_chapter` during chapter analysis). This is a
 *  read-only path — no decode, no compute, just a JSON parse off disk.
 *  Returns null when the sidecar is absent (project hasn't had chapter
 *  analysis run yet); the viewer renders an empty state in that case.
 *
 *  Shape on success: { hopMs, durationMs, peaks: number[] (0..1),
 *                      peakCount, fromSidecar: true }. */
export function loadAudioPeaks(mediaPath) {
  return call(
    'load_audio_peaks',
    { mediaPath },
    () => Promise.resolve(mockAudioPeaks(10)),
  );
}

/** Load the pre-computed mel spectrogram sidecar for a media file (written
 *  by `videoflow.structural.auto_chapter` during chapter analysis). Read-
 *  only — no decode. Returns null when the sidecar is absent.
 *
 *  Decodes the base64 `cellsB64` into a Uint8Array before returning so
 *  callers don't have to. The Uint8Array indexes directly into a magma
 *  colormap LUT in the renderer (one byte per mel cell, time-major:
 *  cells[t * nMels + bin]).
 *
 *  Shape on success: { hopMs, nMels, nFrames, durationMs, fmax,
 *                      dbFloor, dbCeiling, cells: Uint8Array,
 *                      fromSidecar: true }. */
export async function loadAudioSpectrogram(mediaPath) {
  const raw = await call(
    'load_audio_spectrogram',
    { mediaPath },
    () => Promise.resolve(mockAudioSpectrogram()),
  );
  if (!raw) return null;
  // Real path (Tauri / HTTP) returns cellsB64 string and we decode here.
  // Mock path already returns cells as a Uint8Array — just pass through.
  if (raw.cellsB64) {
    const cells = decodeBase64ToUint8Array(raw.cellsB64);
    const { cellsB64: _omit, ...rest } = raw;
    return { ...rest, cells };
  }
  return raw;
}

function decodeBase64ToUint8Array(b64) {
  if (!b64) return new Uint8Array(0);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Load the pre-computed beats sidecar for a media file (written by
 *  `videoflow.structural.auto_chapter` during chapter analysis). Read-
 *  only — no analysis, no shell-out. Returns null when the sidecar is
 *  absent.
 *
 *  Shape on success: { durationMs, bpm, beatsMs: number[],
 *                      downbeatsMs: number[], fromSidecar: true }.
 *  beatsMs / downbeatsMs are absolute project-time positions in ms. */
export function loadAudioBeats(mediaPath) {
  return call(
    'load_audio_beats',
    { mediaPath },
    () => Promise.resolve(mockAudioBeats()),
  );
}

/** Pre-warm the kernel page cache for a chapter's byte range of the
 *  media file. The video element's subsequent range requests for that
 *  region hit warm cache instead of cold disk, eliminating the
 *  silent-frame-drop stutter Chromium produces on long high-bitrate
 *  files via asset://. Background-only — call on chapter change and
 *  let it run; resolve when done.
 *
 *  totalMs is needed because we estimate byte offsets linearly from
 *  ms offsets (we don't parse the container). The kernel cache is
 *  byte-addressable so the estimate doesn't need to be exact. */
export function prewarmMediaRange(mediaPath, startMs, endMs, totalMs) {
  return call(
    'prewarm_media_range',
    {
      mediaPath,
      startMs: Math.max(0, Math.floor(startMs)),
      endMs: Math.max(0, Math.floor(endMs)),
      totalMs: Math.max(0, Math.floor(totalMs)),
    },
    () => Promise.resolve(0),
  );
}

// Module-level in-flight dedup for extract_chapter_clip. Multiple paths can
// race on the same (mediaPath, startMs, endMs):
//   1. React StrictMode / HMR re-mounts useChapterClip → effect fires twice.
//   2. ChaptersTab's split/join handler kicks off pre-extraction in
//      persistAndExtract WHILE the post-mutation re-render fires
//      useChapterClip for the new active chapter.
//   3. Background auto-chapter pipeline extracts a clip while the user
//      opens that same chapter in the viewer.
// Two parallel Rust calls write to the same cache target. On Windows the
// second rename fails with os error 32 ("file is being used by another
// process") AND the half-written content can survive long enough for the
// asset URL to load a corrupted file — observed 2026-05-25 as a
// PIPELINE_ERROR_DECODE on newly split/joined chapters while old chapters
// played fine.
//
// Dedup at the forge.js layer means every caller (useChapterClip handler,
// ChaptersTab pre-warm, future consumers) shares the same in-flight map —
// the entry-point IS extractChapterClip itself, not a separate wrapper.
// Map persists across HMR — `globalThis` survives Vite module replacement.
const __pendingChapterExtracts = (
  globalThis.__ffPendingChapterExtracts ||= new Map()
);

/** Extract a chapter slice of the source media to a temp file via
 *  ffmpeg stream-copy (no re-encode). The Chromium <video> element
 *  plays the temp file directly — a small standalone file with no
 *  range-request overhead — eliminating the long-file stutter.
 *
 *  Returns { tempPath, actualStartMs, actualEndMs, cached }. The
 *  actual bounds may differ slightly from the requested bounds because
 *  ffmpeg snaps to keyframes; callers should use the returned actual
 *  values for playhead math.
 *
 *  In-flight calls for the same (mediaPath, startMs, endMs) share a
 *  single Promise — see __pendingChapterExtracts above for why.
 *
 *  Browser mock returns null — clip extraction is a Tauri-only feature
 *  (ffmpeg binary, temp filesystem). Callers must fall back to the
 *  original media path when this returns null. */
export function extractChapterClip(mediaPath, startMs, endMs) {
  const sm = Math.max(0, Math.floor(startMs));
  const em = Math.max(0, Math.floor(endMs));
  const key = `${mediaPath}|${sm}|${em}`;
  const inFlight = __pendingChapterExtracts.get(key);
  if (inFlight) return inFlight;
  const p = call(
    'extract_chapter_clip',
    { mediaPath, startMs: sm, endMs: em },
    () => Promise.resolve(null),
  ).finally(() => {
    // Only clear if this is still the same promise — guards against a
    // race where the key was re-requested AFTER this one resolved, which
    // would have stored a new promise.
    if (__pendingChapterExtracts.get(key) === p) {
      __pendingChapterExtracts.delete(key);
    }
  });
  __pendingChapterExtracts.set(key, p);
  return p;
}

function mockAudioBeats() {
  // Synthesise a 120 BPM grid over 60s so the tick overlay shows
  // something in browser mode without a real librosa run. Downbeats
  // every 4th beat.
  const bpm = 120;
  const interval = 60_000 / bpm; // 500ms
  const beats = [];
  const downbeats = [];
  for (let t = 0, i = 0; t < 60_000; t += interval, i += 1) {
    beats.push(Math.round(t));
    if (i % 4 === 0) downbeats.push(Math.round(t));
  }
  return {
    durationMs: 60_000,
    bpm,
    beatsMs: beats,
    downbeatsMs: downbeats,
    fromSidecar: false,
  };
}

function mockAudioSpectrogram() {
  // 60s mock at ~23ms hop × 64 mel bins. Synthesises a swept-tone pattern
  // so the SpectrogramCanvas exercises its full colormap range in
  // browser mode — no real librosa needed for layout work.
  const hopMs = 23;
  const nMels = 64;
  const nFrames = Math.floor(60_000 / hopMs);
  const cells = new Uint8Array(nFrames * nMels);
  for (let t = 0; t < nFrames; t++) {
    const sweep = (t / nFrames) * nMels;
    for (let b = 0; b < nMels; b++) {
      const d = Math.abs(b - sweep);
      const v = Math.max(0, 200 - d * 18) + Math.sin(t * 0.4 + b * 0.3) * 20;
      cells[t * nMels + b] = Math.max(0, Math.min(255, Math.floor(v)));
    }
  }
  return {
    hopMs,
    nMels,
    nFrames,
    durationMs: nFrames * hopMs,
    fmax: 8000,
    dbFloor: -80,
    dbCeiling: 0,
    cells,
    fromSidecar: false,
  };
}

/** Attach a media file (video/audio) to an existing project. Real Tauri
 *  command stores the path on the project's metadata (and eventually
 *  the .ffmeta sidecar). Browser mock: echoes the path so the UI can
 *  exercise the flow. */
export function attachMedia(funscriptPath, mediaPath) {
  return call(
    'attach_media',
    { funscriptPath, mediaPath },
    () => Promise.resolve({ funscriptPath, mediaPath }),
  );
}

/** Classify a file by extension into the bucket the Project-tab picker
 *  cares about. Returns 'bundle' | 'funscript' | 'media' | 'meta' | 'unknown'. */
export function classifyProjectFile(path) {
  if (!path) return 'unknown';
  const lower = String(path).toLowerCase();
  if (lower.endsWith('.forge')) return 'bundle';
  if (lower.endsWith('.funscript')) return 'funscript';
  for (const ext of ['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac',
                     '.mp4', '.mkv', '.mov', '.avi', '.webm', '.m4v']) {
    if (lower.endsWith(ext)) return 'media';
  }
  if (lower.endsWith('.ffmeta') || lower.endsWith('.ffmeta.json') ||
      lower.endsWith('.chapters.json')) return 'meta';
  return 'unknown';
}

/** Open a funscript picker — FunscriptForge's primary input. A project
 *  starts with a .funscript; an associated media file (mp4/m4a/etc.) can be
 *  attached later via a separate flow. Returns absolute path on desktop or
 *  null if cancelled. */
export async function pickFunscriptFile() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: 'Funscript', extensions: ['funscript'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return selected ?? null;
  }
  // Browser mode: caller should render an <input type="file"> instead.
  return null;
}

/** Open an Edger events.yml picker (Events tab > Load Edger yml…). Returns the
 *  absolute path on desktop or null if cancelled. */
export async function pickEventsYmlFile(defaultPath) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
      filters: [
        { name: 'Edger events', extensions: ['yml', 'yaml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return selected ?? null;
  }
  return null;
}

/** Open a media file picker — used when *attaching* a media file to an
 *  existing project (Project tab > Replace files…). Not the primary input;
 *  pickFunscriptFile is. */
export async function pickMediaFile(defaultPath) {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      defaultPath: defaultPath || undefined,
      filters: [
        {
          name: 'Audio / Video',
          extensions: [
            'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac',
            'mp4', 'mkv', 'mov', 'avi', 'webm', 'm4v',
          ],
        },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    return selected ?? null;
  }
  return null;
}
