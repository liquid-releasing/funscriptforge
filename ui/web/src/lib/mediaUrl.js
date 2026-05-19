// mediaUrl — convert a filesystem path to a URL the Tauri WebView can load.
//
// Uses `convertFileSrc` from Tauri's asset protocol. The webview blocks
// plain `file:///` URLs for media; `convertFileSrc` produces an
// `asset://` URL that Tauri's asset handler serves. Requires
// `app.security.assetProtocol.enable = true` in tauri.conf.json (with a
// scope that covers the path) — already set.
//
// Falls back to a manual file:// formatter when Tauri's API is absent
// (browser-mock under `npm run dev` without `tauri dev`).

import { convertFileSrc } from '@tauri-apps/api/core';

export function toMediaUrl(path) {
  if (!path) return undefined;
  try {
    return convertFileSrc(path);
  } catch {
    const fwd = String(path).replace(/\\/g, '/');
    return fwd.startsWith('/') ? `file://${fwd}` : `file:///${fwd}`;
  }
}
