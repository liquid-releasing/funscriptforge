// What each tab actually writes — the file named in the footer's
// "writes <file> · downstream tabs read this file" line.
//
// ★ The bug this replaces: the footer built the name from the TAB ID.
//
//     `${project.title}.${tab}.json`
//
// so every tab claimed to write `<title>.<tabid>.json`. That is right by
// coincidence for Chapters and Phrases and wrong everywhere else — the Events
// tab advertised `<title>.events.json`, a file nothing in the codebase writes
// or reads. Reported during dogfooding 2026-09-25 while chasing a stuck
// banner, where the footer's confident filename sent the search after a file
// that has never existed.
//
// A UI that names a file must name the real one. Anything else is a claim the
// user can act on and be wrong about — and here it actively misdirected
// debugging. Tabs whose output is not a single sidecar return null, and the
// footer then omits the line rather than inventing one.
//
// Artifacts live in `.<stem>.forge/` as `<stem>.<suffix>`; `stem` is the
// FUNSCRIPT stem, which is what these names are built from.

/** tab id → the sidecar suffix it writes, or null when there is no single one. */
export const TAB_ARTIFACT = Object.freeze({
  project:  'project.json',
  generate: 'generated.funscript',
  analysis: 'chapters.json',     // the gate artifact downstream tabs read
  chapters: 'chapters.json',
  phrases:  'phrases.json',
  stanzas:  'chapters.json',     // stanzas live INSIDE chapters.json (v3.0)
  events:   'feel.yml',          // NOT events.json — events.yml is the
                                 // play-only sibling written at export
  stim:     'characters.json',
  polish:   'polish.yml',
  export:   null,                // a .forge bundle, not a sidecar
  viewer:   null,                // read-only
  library:  null,
  catalog:  null,
});

/**
 * The file a tab writes, or null when it writes no single sidecar.
 *
 * @param tab   tab id
 * @param stem  the project's funscript stem
 */
export function chainArtifactFor(tab, stem) {
  const suffix = TAB_ARTIFACT[tab];
  if (!suffix || !stem) return null;
  return `${stem}.${suffix}`;
}

/** The funscript stem for a project path — the basename without extension. */
export function stemFromPath(path) {
  if (!path) return null;
  const base = String(path).split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base || null;
}
