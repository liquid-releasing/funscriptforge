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
