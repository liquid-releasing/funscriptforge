// useTransformPreview — debounced backend before/after preview.
//
// Replaces the old client-side `previewActions` JS that only implemented
// 2 of 31 transforms (and got recenter wrong). Calls the Python
// implementation through transform_preview for EVERY transform, so the
// before/after charts show what Apply will actually do.
//
// Returns a Map keyed by span start_ms → transformed actions in ABSOLUTE
// time. Each row looks up its phrase/stanza by at_ms and re-bases to 0 for
// its own 0-based chart. Structural transforms (halve_tempo, …) can change
// the action count/timing within a span; returning actions (not a position
// map) carries that faithfully.
//
// Debounced so dragging a slider doesn't spawn a python process per frame;
// a request counter drops stale responses so the latest params win.

import { useEffect, useRef, useState } from 'react';
import { transformPreview } from './forge.js';

const EMPTY = new Map();

export function useTransformPreview({
  funscriptPath,
  transformId,
  params,
  spans,
  debounceMs = 250,
}) {
  const [bySpanStart, setBySpanStart] = useState(EMPTY);
  const [loading, setLoading] = useState(false);
  const timer = useRef(null);
  const reqId = useRef(0);

  // Object/array identities churn every render; key the effect on stable
  // serialisations instead so it only re-fires on real input changes.
  const spansKey = (spans ?? []).map((s) => `${s.start_ms}:${s.end_ms}`).join(',');
  const paramsKey = JSON.stringify(params ?? {});

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);

    if (!funscriptPath || !transformId || !spans || spans.length === 0) {
      setBySpanStart(EMPTY);
      setLoading(false);
      return undefined;
    }

    const myReq = ++reqId.current;
    setLoading(true);
    timer.current = setTimeout(async () => {
      try {
        const res = await transformPreview(funscriptPath, transformId, params ?? {}, spans);
        if (myReq !== reqId.current) return; // a newer request superseded us
        const m = new Map();
        if (res && Array.isArray(res.spans)) {
          for (const sp of res.spans) m.set(sp.start_ms, sp.actions);
        }
        setBySpanStart(m.size ? m : EMPTY);
      } catch {
        if (myReq === reqId.current) setBySpanStart(EMPTY);
      } finally {
        if (myReq === reqId.current) setLoading(false);
      }
    }, debounceMs);

    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [funscriptPath, transformId, paramsKey, spansKey, debounceMs]);

  return { previewBySpanStart: bySpanStart, previewLoading: loading };
}
