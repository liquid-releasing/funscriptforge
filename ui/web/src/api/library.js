// api/library.js — Library JS adapter for the Tauri backend.
//
// Wraps the Rust commands in src-tauri/src/library.rs as an FsAdapter
// (the interface defined in forgemoment/src/library/types.js). Same
// scanRoot / loadConfig / saveConfig code runs in both unit tests
// (with InMemoryFs) and in FunscriptForge (with this tauriFs).
//
// Per-call IPC overhead is ~1ms — fine for v1's tens-to-hundreds of
// files. If folder sizes grow, swap to a single `library_scan_root`
// Rust command (see forgemoment plan doc, "scan execution path α").

import { invoke } from '@tauri-apps/api/core';
import {
  scanRoot as scanRootImpl,
  loadConfig as loadConfigImpl,
  saveConfig as saveConfigImpl,
  addRoot as addRootImpl,
  removeRoot as removeRootImpl,
  renameRoot as renameRootImpl,
} from 'forgemoment';

// ── Cross-platform path helpers ────────────────────────────────────────
// We can't import node:path in a Vite-bundled web app. Tiny helpers
// here cover what scan.js + config.js call. Format-detect by separator
// in the input path; if backslash present and no leading `/`, treat as
// Windows. Works for absolute paths from Tauri (always native form).

function isWindowsPath(p) {
  return /[a-zA-Z]:[\\/]/.test(p) || (p.includes('\\') && !p.startsWith('/'));
}
function sepFor(p) {
  return isWindowsPath(p) ? '\\' : '/';
}

function pathJoin(...parts) {
  const filtered = parts.filter((p) => p != null && p !== '');
  if (filtered.length === 0) return '';
  const sep = sepFor(filtered[0]);
  // Trim trailing separators from non-final parts; leading from non-first.
  const joined = filtered
    .map((p, i) => {
      let s = String(p);
      if (i > 0) s = s.replace(/^[\\/]+/, '');
      if (i < filtered.length - 1) s = s.replace(/[\\/]+$/, '');
      return s;
    })
    .join(sep);
  return joined;
}

function pathBasename(p) {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function pathDirname(p) {
  const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return idx > 0 ? p.slice(0, idx) : '';
}

function pathExtname(p) {
  const base = pathBasename(p);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

function pathStem(p) {
  const base = pathBasename(p);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? base : base.slice(0, dot);
}

// ── FsAdapter implementation ───────────────────────────────────────────

export const tauriFs = {
  async readdir(path) {
    return invoke('library_fs_readdir', { path });
  },
  async stat(path) {
    return invoke('library_fs_stat', { path });
  },
  async exists(path) {
    return invoke('library_fs_exists', { path });
  },
  async readJson(path) {
    return invoke('library_fs_read_json', { path });
  },
  async readText(path) {
    return invoke('library_fs_read_text', { path });
  },
  async writeText(path, text) {
    return invoke('library_fs_write_text', { path, text });
  },
  join: pathJoin,
  basename: pathBasename,
  extname: pathExtname,
  stem: pathStem,
};

// ── High-level wrappers ────────────────────────────────────────────────

/**
 * Get the OS-convention path for the shared LQR library config file.
 * Cached after first call — the path doesn't change at runtime.
 */
let _cachedConfigPath = null;
export async function getConfigPath() {
  if (_cachedConfigPath) return _cachedConfigPath;
  _cachedConfigPath = await invoke('library_config_path');
  return _cachedConfigPath;
}

/** Load the persisted library config. */
export async function loadConfig() {
  const path = await getConfigPath();
  return loadConfigImpl(tauriFs, path);
}

/** Save the library config. */
export async function saveConfig(config) {
  const path = await getConfigPath();
  return saveConfigImpl(config, tauriFs, path);
}

/**
 * Open the system folder picker. Returns the chosen path or null
 * if the user cancelled.
 */
export async function pickFolder() {
  return invoke('library_pick_folder');
}

/** Reveal a file or directory in the platform's native file explorer. */
export async function revealInExplorer(path) {
  return invoke('library_reveal_in_explorer', { path });
}

/**
 * Scan one library root. Returns a ScanResult with the full list of
 * projects + any per-file errors. Uses the JS scan logic from
 * forgemoment, calling back into Tauri per fs operation.
 */
export async function scanRoot(root) {
  return scanRootImpl(root, tauriFs);
}

// ── Config mutation helpers — pure JS, save handled at the call site ──
// These thin re-exports let LibraryScreen import config mutators from
// one place. Pure functions; the persistence step is `await saveConfig(next)`.

export const addRoot = addRootImpl;
export const removeRoot = removeRootImpl;
export const renameRoot = renameRootImpl;

// ── Per-project file inventory ─────────────────────────────────────────
// loadProjectFiles is the Project tab's narrow analogue to scanRoot:
// readdir the funscript's own folder, classify entries against the
// project's stem, and return only what actually exists. No recursion —
// one project's folder is small and we don't want to pull derivative
// audio from sibling project subfolders here.
//
// Returns null when readdir fails (browser mock or missing dir).

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.m4v']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a', '.aac']);
// Sidecar suffixes the Project tab can render today. Anything else gets
// classified as 'unknown' so unfamiliar files don't disappear silently.
const SIDECAR_KINDS = [
  { suffix: '.chapters.json',    kind: 'chapters' },
  { suffix: '.beats.json',       kind: 'beats' },
  { suffix: '.audio.json',       kind: 'audio-peaks' },
  { suffix: '.spectrogram.json', kind: 'spectrogram' },
  { suffix: '.phrases.json',     kind: 'phrases' },
  { suffix: '.events.yml',       kind: 'events' },
  { suffix: '.feel.yml',         kind: 'feel' },
  { suffix: '.ffmeta.json',      kind: 'ffmeta' },
  { suffix: '.ffmeta',           kind: 'ffmeta' },
];

// Stem normalizer for the "Link nearby funscript" affordance. Collapses
// the differences that come from naming variation (LongandCut_hdr vs
// LongandCut-hdr vs longandcut.hdr) so we can recommend a candidate the
// strict scan rule won't auto-link.
function normalizeStem(s) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Prefix-with-boundary check — `prefix` is a valid prefix of `target`
// if target starts with prefix followed by `.`, `_`, or `-`. Keeps
// `Movie.funscript` from claiming `MovieExtended.mp4` while still
// pairing `IPZZ-125.omfg.funscript` with `IPZZ-125.omfg_iris3.mp4`.
// Same rule scan.js applies — keep them in sync.
function isPrefixWithBoundary(prefix, target) {
  if (prefix.length >= target.length) return false;
  if (!target.startsWith(prefix)) return false;
  const boundary = target.charAt(prefix.length);
  return boundary === '.' || boundary === '_' || boundary === '-';
}

export async function loadProjectFiles(funscriptPath) {
  if (!funscriptPath) return null;
  // Skip non-fs URIs (the synthetic `sample://` sentinel is the only
  // one today). They don't correspond to real directories — readdir
  // would error out with a Tauri-level path-syntax warning.
  if (/^[a-z]+:\/\//i.test(String(funscriptPath))) return null;
  const dirPath = pathDirname(funscriptPath);
  const stem = pathStem(funscriptPath);
  let entries;
  try {
    entries = await tauriFs.readdir(dirPath);
  } catch (err) {
    console.warn('loadProjectFiles: readdir failed', dirPath, err);
    return null;
  }

  const stemLower = stem.toLowerCase();
  const stemNorm = normalizeStem(stemLower);

  let funscript = null;
  const media = [];
  const companionFunscripts = [];
  const sidecars = [];
  let forgeDir = null;

  for (const e of entries || []) {
    const fullPath = pathJoin(dirPath, e.name);
    if (e.isDirectory) {
      if (e.name.toLowerCase() === `.${stemLower}.forge`) forgeDir = fullPath;
      continue;
    }
    const ext = pathExtname(e.name);
    const entryStem = pathStem(e.name);
    const entryStemLower = entryStem.toLowerCase();
    const lowerName = e.name.toLowerCase();

    if (ext === '.funscript') {
      if (entryStemLower === stemLower) {
        funscript = { path: fullPath, name: e.name };
      } else if (isPrefixWithBoundary(entryStemLower, stemLower)) {
        // Funscript stem is a punctuation-bounded prefix of this
        // project's stem — same rule the scan uses for pairing.
        // Treat as the project's funscript if we haven't picked one
        // yet (longer-prefix wins via the loop's ordering).
        if (!funscript
            || (funscript._matchLen ?? 0) < entryStemLower.length) {
          funscript = { path: fullPath, name: e.name, _matchLen: entryStemLower.length };
        }
      } else if (normalizeStem(entryStemLower) === stemNorm) {
        // Stem differs by punctuation/case only and ISN'T a clean prefix
        // — surface as a "nearby" suggestion the user can act on.
        companionFunscripts.push({ path: fullPath, name: e.name, match: 'normalized-stem' });
      }
      continue;
    }

    if (VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
      if (entryStemLower === stemLower) {
        media.push({
          path: fullPath,
          name: e.name,
          kind: VIDEO_EXTS.has(ext) ? 'video' : 'audio',
        });
      }
      continue;
    }

    // Sidecars match against the project's stem prefix.
    let sidecarKind = null;
    for (const { suffix, kind } of SIDECAR_KINDS) {
      if (lowerName === `${stemLower}${suffix}`) {
        sidecarKind = kind;
        break;
      }
    }
    if (sidecarKind) {
      sidecars.push({ path: fullPath, name: e.name, kind: sidecarKind });
    }
  }

  return {
    dirPath,
    stem,
    funscript,
    media,
    companionFunscripts,
    sidecars,
    forgeDir,
  };
}
