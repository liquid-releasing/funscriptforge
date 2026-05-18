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

/** Recent projects for the Library screen. Real Tauri command reads from the
 *  user's `<config>/funscriptforge/recents.json`. Browser mock returns four
 *  fixture rows so the UI can be exercised without the desktop runtime.
 *
 *  Each project carries a `color` used to tint the MiniWave preview, plus a
 *  `mediaKind` (video|audio) and `chapters` count consumed by the Project
 *  tab. When the real backend lands these come from the .ffmeta sidecar. */
export function listRecents() {
  return call('list_recents', undefined, () => [
    { id: 'r1', title: "Aftermath — Director's Cut", duration: '9:32',  edited: 'just now',   phrases: 23, chapters: 4, mediaKind: 'video', status: 'in-progress', color: '#e74c3c' },
    { id: 'r2', title: 'Slow Burn',                  duration: '8:12',  edited: 'yesterday',  phrases: 18, chapters: 3, mediaKind: 'audio', status: 'exported',    color: '#f39c12' },
    { id: 'r3', title: 'Quiet Rain (collab)',        duration: '21:05', edited: '3 days ago', phrases: 47, chapters: 6, mediaKind: 'audio', status: 'in-progress', color: '#4a90d9' },
    { id: 'r4', title: 'Untitled draft',             duration: '4:30',  edited: 'last week',  phrases:  9, chapters: 2, mediaKind: 'video', status: 'draft',       color: '#9b59b6' },
  ]);
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
 *  analysis, then clusters). Caller should show a progress indicator. */
export function analyzeChaptersWithVideoflow(funscriptPath, targetMinutes, mediaPath) {
  return call(
    'analyze_chapters_with_videoflow',
    { funscriptPath, targetMinutes, mediaPath },
    () => Promise.resolve(synthMockChapters(754000, 6)),
  );
}

/** Run `cli.py assess` against the funscript and return the parsed phrase
 *  records. Used by the Phrases tab to hydrate its per-phrase edit table.
 *  Each record: { id, at_ms, end_ms, number, bpm, tag, all_tags,
 *  pattern_label }. Cost: full FunscriptAnalyzer pipeline (a few seconds
 *  on real-length funscripts) — caller should drive the footer busy
 *  indicator while it's in flight. Browser-mode mock returns empty so
 *  the empty state renders. */
export function analyzePhrases(funscriptPath) {
  return call(
    'analyze_phrases',
    { funscriptPath },
    () => Promise.resolve([]),
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
 *  - audio/video  → attach as the project's media file
 *  - .chapters.json → import a chapter sidecar (future)
 *  - .ffmeta / .ffmeta.json → import the combined manifest (future)
 *
 *  Returns absolute path on desktop, null if cancelled, browser-mode null.
 *  Caller is responsible for routing by extension. */
export async function pickProjectFile() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
      filters: [
        { name: 'Funscript',     extensions: ['funscript'] },
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
 *  cares about. Returns 'funscript' | 'media' | 'meta' | 'unknown'. */
export function classifyProjectFile(path) {
  if (!path) return 'unknown';
  const lower = String(path).toLowerCase();
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

/** Open a media file picker — used when *attaching* a media file to an
 *  existing project (Project tab > Replace files…). Not the primary input;
 *  pickFunscriptFile is. */
export async function pickMediaFile() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({
      multiple: false,
      directory: false,
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
