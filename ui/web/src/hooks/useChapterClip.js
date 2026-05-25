// useChapterClip — extract the active chapter's clip into a player-ready
// URL with the blob smoothing + size-cap fallback. Returns a stable
// { clip, loading } shape so consuming tabs can drop a ~60-line block.
//
// The clip's URL is either:
//   - a blob: URL (clip fetched into JS memory, smooth seeks) when the
//     clip is below the BLOB_FETCH_CAP, or
//   - the asset URL (WebView's range-request streamer) when the clip
//     exceeds the cap — WebView2 OOMs (0xE0000008) on ~400 MB+ blobs
//     materialized alongside the live video decoder. See
//     feedback-chapter-clip-blob-cap.
//
// The previous clip's blob URL is revoked after the next clip lands,
// so memory doesn't pile up across chapter visits. Aborting a swap
// in flight is safe — the cancellation flag suppresses both the
// setState calls and the URL.createObjectURL.
//
// Input chapter accepts either casing (`at_ms` / `atMs`, `end_ms` /
// `endMs`) — ChaptersTab uses camelCase, every other tab uses
// snake_case. Plucking from both keeps the hook callable from any tab
// without forcing a normalization step at the call site.

import { useEffect, useState } from 'react';
import { extractChapterClip } from '../api/forge.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

const BLOB_FETCH_CAP_BYTES = 150 * 1024 * 1024;

// Module-level in-flight dedup for extractChapterClip. Two paths can race
// on the same (mediaPath, startMs, endMs):
//   1. React StrictMode / HMR re-mounts the hook → effect fires twice.
//   2. Background auto-chapter pipeline's chapter_clips stage extracts
//      a clip while the user opens that same chapter in the viewer.
// Both turn into two parallel Rust extract_chapter_clip calls writing
// to the same cache target. On Windows the second rename fails with
// os error 32 ("file is being used by another process") because the
// first rename hasn't released its file handle yet.
//
// Dedup: keyed Map<cacheKey, Promise<result>>. Anyone asking for an
// in-flight key gets the existing promise. The entry is cleared after
// the promise settles so a later legitimate re-extract (post-Re-analyze
// wipe) is not blocked. Map persists across HMR — `globalThis` survives
// Vite module replacement, which is the whole point.
const __pendingExtracts = (
  globalThis.__ffPendingChapterExtracts ||= new Map()
);

function dedupedExtract(mediaPath, startMs, endMs) {
  const key = `${mediaPath}|${startMs}|${endMs}`;
  const inFlight = __pendingExtracts.get(key);
  if (inFlight) return inFlight;
  const p = extractChapterClip(mediaPath, startMs, endMs)
    .finally(() => {
      // Only clear if this is still the same promise — guards against
      // a race where the same key was re-requested AFTER this one
      // resolved, which would have stored a new promise.
      if (__pendingExtracts.get(key) === p) {
        __pendingExtracts.delete(key);
      }
    });
  __pendingExtracts.set(key, p);
  return p;
}

export function useChapterClip(mediaPath, chapter) {
  const id = chapter?.id ?? null;
  const startMs = chapter?.at_ms ?? chapter?.atMs ?? null;
  const endMs = chapter?.end_ms ?? chapter?.endMs ?? null;

  const [clip, setClip] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!mediaPath || id == null || startMs == null || endMs == null) {
      setClip(null);
      setLoading(false);
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    // Clear the previous clip so the player unmounts the prior chapter
    // immediately rather than rendering it underneath the loading
    // overlay while ffmpeg works.
    setClip(null);
    dedupedExtract(mediaPath, startMs, endMs)
      .then(async (result) => {
        if (cancelled) return;
        if (!result) {
          console.warn('useChapterClip: extractChapterClip returned null');
          return;
        }
        const assetUrl = toMediaUrl(result.tempPath);
        let url = assetUrl;
        try {
          const resp = await fetch(assetUrl);
          if (cancelled) return;
          if (!resp.ok) throw new Error(`fetch ${assetUrl} ${resp.status}`);
          const len = Number(resp.headers.get('content-length') || 0);
          if (len > BLOB_FETCH_CAP_BYTES) {
            console.log('useChapterClip: clip exceeds blob cap, using asset URL', { bytes: len, cap: BLOB_FETCH_CAP_BYTES });
          } else {
            const blob = await resp.blob();
            if (cancelled) return;
            url = URL.createObjectURL(blob);
          }
        } catch (err) {
          console.warn('useChapterClip: blob fetch failed, falling back to asset URL', err);
        }
        if (cancelled) return;
        setClip({
          url,
          offsetMs: result.actualStartMs,
          chapterId: id,
        });
      })
      .catch((err) => {
        console.warn('useChapterClip: extractChapterClip failed', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mediaPath, id, startMs, endMs]);

  // Revoke the previous chapter's blob URL when clip changes. Cleanup
  // fires AFTER the next clip has been set, so the video element has
  // already swapped to the new URL before the old one is revoked.
  useEffect(() => {
    if (!clip || !clip.url?.startsWith('blob:')) return undefined;
    return () => {
      URL.revokeObjectURL(clip.url);
    };
  }, [clip]);

  return { clip, loading };
}
