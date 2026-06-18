// useChapterClip — resolve the active chapter's player-ready video URL.
//
// Two paths, chosen by a one-time probe of the source:
//
//   1. SINGLE-FILE STREAMING (fast path) — when the source streams cleanly
//      into WebView2 (probe `direct_playable`: H.264 / yuv420p / ≤1080p / CFR
//      / SDR), we DON'T re-encode anything. The player points at the WHOLE
//      source via asset:// (offset 0 — the source timeline IS absolute) and we
//      pre-warm the chapter's byte range so seeking is smooth. No temp clip,
//      no blob, instant chapter switches.
//
//   2. PER-CHAPTER CLIP (fallback) — for sources that would stutter / OOM
//      played whole (4K / VFR / HDR / exotic profile), extract a normalized
//      re-encoded clip per chapter. The clip's URL is a blob: when below the
//      BLOB_FETCH_CAP (smooth seeks) or the asset URL when it exceeds the cap
//      (WebView2 OOMs ~400 MB+ blobs alongside the live decoder — see
//      feedback-chapter-clip-blob-cap).
//
// Returns a stable { clip, loading } shape so consuming tabs can stay simple.
// The clip carries { url, offsetMs, chapterId, direct? }; offsetMs is 0 for
// the direct path and the clip's keyframe-snapped start for the clip path.
//
// Input chapter accepts either casing (`at_ms`/`atMs`, `end_ms`/`endMs`) —
// ChaptersTab uses camelCase, every other tab snake_case.

import { useEffect, useState } from 'react';
import { extractChapterClip, probeMedia, prewarmMediaRange } from '../api/forge.js';
import { toMediaUrl } from '../lib/mediaUrl.js';

const BLOB_FETCH_CAP_BYTES = 150 * 1024 * 1024;

// One probe per media path, shared across chapter changes + HMR. The
// `direct_playable` verdict decides streaming-vs-clips and never changes for a
// given file, so probe once and reuse. Map survives Vite module replacement.
const __mediaProbe = (globalThis.__ffMediaProbe ||= new Map());
export function probeMediaCached(mediaPath) {
  let p = __mediaProbe.get(mediaPath);
  if (!p) {
    p = probeMedia(mediaPath).catch(() => null);
    __mediaProbe.set(mediaPath, p);
  }
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
    // immediately rather than rendering it under the loading overlay.
    setClip(null);

    (async () => {
      // Single-file streaming fast path — skip extraction entirely.
      const probe = await probeMediaCached(mediaPath);
      if (cancelled) return;
      if (probe?.direct_playable) {
        // Warm the chapter's byte range so the <video>'s range requests hit
        // cache, not cold disk — eliminates the long-file seek stutter.
        // Best-effort; never blocks playback.
        prewarmMediaRange(mediaPath, startMs, endMs, probe.duration_ms || 0).catch(() => {});
        if (cancelled) return;
        setClip({ url: toMediaUrl(mediaPath), offsetMs: 0, chapterId: id, direct: true });
        setLoading(false);
        return;
      }

      // Fallback: per-chapter re-encoded clip.
      try {
        const result = await extractChapterClip(mediaPath, startMs, endMs);
        if (cancelled) return;
        if (!result) {
          console.warn('useChapterClip: extractChapterClip returned null');
          setLoading(false);
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
        setClip({ url, offsetMs: result.actualStartMs, chapterId: id });
      } catch (err) {
        console.warn('useChapterClip: extractChapterClip failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [mediaPath, id, startMs, endMs]);

  // Revoke the previous chapter's blob URL when clip changes. Direct-stream
  // clips carry an asset:// URL (no blob), so this is a no-op for them.
  useEffect(() => {
    if (!clip || !clip.url?.startsWith('blob:')) return undefined;
    return () => {
      URL.revokeObjectURL(clip.url);
    };
  }, [clip]);

  return { clip, loading };
}
