// useTransformCatalog — source the TransformPanel's catalog from the
// authoritative Python pattern_catalog (via cli.py list-transforms),
// NOT the static hand-port in transforms.js.
//
// Why: the hand-port drifted from the backend at both the id and param
// level (normalize_range/normalize, every_n/every_nth, center/
// target_center, …). Because PhraseTransform.apply silently drops unknown
// param keys, those mismatches made the sliders no-op invisibly. Sourcing
// the catalog from the backend means the param keys the UI emits always
// match what the transform expects.
//
// The static TRANSFORMS stays as the browser-dev fallback (listTransforms'
// mock returns {} with no desktop runtime), so `npm run dev` still renders
// a populated picker.

import { useEffect, useState } from 'react';
import { listTransforms } from '../api/forge.js';
import { TRANSFORMS as STATIC_TRANSFORMS } from './transforms.js';

// Backend entry → TransformPanel record shape.
//   backend: {key: {name, description, category, structural,
//                   params: {pid: {label, type, default, min, max, step, help}}}}
//   panel:   {id, label, category, summary, description, bestFor, params: [...]}
export function adaptCatalog(json) {
  return Object.entries(json).map(([id, e]) => ({
    id,
    label: e.name ?? id,
    category: e.category ?? (e.structural ? 'structural' : 'behavior'),
    summary: e.description ?? '',
    description: e.description ?? '',
    bestFor: [],
    params: Object.entries(e.params ?? {}).map(([pid, p]) => ({
      id: pid,
      label: p.label ?? pid,
      type: p.type,
      min: p.min,
      max: p.max,
      step: p.step,
      default: p.default,
      help: p.help,
    })),
  }));
}

export function useTransformCatalog() {
  // Start on the static catalog so the picker is never empty mid-load;
  // swap to the authoritative one once the backend answers.
  const [catalog, setCatalog] = useState(STATIC_TRANSFORMS);

  useEffect(() => {
    let cancelled = false;
    listTransforms()
      .then((json) => {
        if (cancelled) return;
        const keys = json && typeof json === 'object' ? Object.keys(json) : [];
        if (keys.length) setCatalog(adaptCatalog(json));
        // else: browser-dev mock returned {} — keep the static fallback.
      })
      .catch(() => { /* backend unavailable — keep static fallback */ });
    return () => { cancelled = true; };
  }, []);

  return catalog;
}
