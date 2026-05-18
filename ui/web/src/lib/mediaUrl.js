// mediaUrl — convert a filesystem path to a URL the Tauri WebView can load.
//
// Today this is a manual `file://` formatter. When the Tauri asset
// protocol allowlist is wired in `tauri.conf.json` we can swap this for
// `convertFileSrc` from `@tauri-apps/api/core`. Keeping it in one place
// so the swap is a one-file change.

export function toMediaUrl(path) {
  if (!path) return undefined;
  // Backslashes → forward slashes for cross-platform; prefix file://
  // (or file:/// on Windows since the path is absolute with a drive
  // letter — three slashes for the empty authority).
  const fwd = String(path).replace(/\\/g, '/');
  return fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`;
}
