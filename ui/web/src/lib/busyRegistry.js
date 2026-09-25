// In-flight operations, as a set rather than a single slot.
//
// ★ Why this replaces the owned-banner model.
//
// The footer banner was ONE slot with ONE owner, while the reality is N
// concurrent operations and a user who navigates freely between them. Every
// stuck-banner bug on 2026-09-25 came from that mismatch:
//
//   * a tab unmounted mid-operation, so nothing was left to clear its banner;
//   * two owners interleaved and the loser's clear was refused, stranding a
//     banner nobody could remove;
//   * stage labels from the GLOBAL progress channel painted into whatever
//     banner happened to be open, so the banner described the wrong
//     operation — "Analyzing…" was shown for a stuck `refresh`;
//   * "clear the banner" required guessing which operation owned it.
//
// Ownership arbitration, the stall watchdog and the abandoned-banner release
// were all compensation for a single slot pretending to be a set.
//
// Here each operation only ever touches its OWN entry. There is nothing to
// arbitrate, unmounting is irrelevant because registration is not tied to a
// component, and one operation that never settles cannot block anyone else's
// completion. The banner is visible iff something is registered.

/** A fresh, empty registry. */
export function emptyOps() {
  return {};
}

/**
 * Register an operation as in flight. Re-registering the same key updates it
 * in place and keeps its original start time, so a producer that relabels
 * mid-run (e.g. "Analyzing chapters…" then "Detecting phrases…") stays one
 * entry rather than becoming two.
 */
export function registerOp(ops, key, entry = {}) {
  if (!key) return ops;
  const prev = ops[key];
  return {
    ...ops,
    [key]: {
      ...prev,
      ...entry,
      key,
      startedAt: prev?.startedAt ?? entry.startedAt ?? Date.now(),
      progressAt: entry.progressAt ?? prev?.progressAt ?? null,
    },
  };
}

/** Remove an operation. Returns the same reference when it was not there —
 *  a late or duplicate deregister is a no-op, never an error. */
export function deregisterOp(ops, key) {
  if (!key || !(key in ops)) return ops;
  const next = { ...ops };
  delete next[key];
  return next;
}

/** Patch one entry, if present. Same reference when absent, so a stage event
 *  for an operation nobody registered cannot resurrect it. */
export function updateOp(ops, key, patch) {
  if (!key || !(key in ops)) return ops;
  return { ...ops, [key]: { ...ops[key], ...patch } };
}

/**
 * Drop every entry that was waiting on `op`, plus `op`'s own entry.
 *
 * A tab that wraps a backend call registers its own friendly label ("Analyzing
 * chapters…") while the backend separately registers the operation and its
 * stages. When the operation ends, BOTH should go: otherwise the tab's entry
 * survives with a stale label and the banner keeps describing work that is
 * over — the same churn, one layer up. A tab declares the link by passing
 * `waitingFor` when it registers.
 *
 * This matters because the tab's own clear runs in a `finally`, and a `finally`
 * is exactly what a lost invoke reply prevents. The completion EVENT is
 * reliable; the reply is not, so the event gets to remove both.
 */
export function completeOp(ops, op) {
  const keys = Object.keys(ops || {}).filter(
    (k) => k === `op:${op}` || ops[k]?.waitingFor === op,
  );
  if (!keys.length) return ops;
  const next = { ...ops };
  for (const k of keys) delete next[k];
  return next;
}

/** Everything in flight, oldest first. */
export function activeOps(ops) {
  return Object.values(ops || {}).sort(
    (a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0),
  );
}

/**
 * The entry the banner should describe: the MOST RECENTLY started.
 *
 * The newest is what the user just did, so it is what they are waiting on.
 * A long background operation started earlier keeps running and keeps the
 * banner alive, but does not get to speak over the thing in front of them.
 */
export function primaryOp(ops) {
  const all = activeOps(ops);
  return all.length ? all[all.length - 1] : null;
}

/**
 * Drop operations that have gone silent past `stallMs`.
 *
 * Still needed, but far narrower than before: it expires ONE entry rather
 * than releasing a shared banner, so a lost reply can no longer hide the
 * progress of everything else. Silence is measured from the last progress
 * event for that operation, falling back to when it started.
 */
export function expireStaleOps(ops, { now, stallMs }) {
  if (!now || !stallMs) return ops;
  let changed = false;
  const next = {};
  for (const [k, v] of Object.entries(ops || {})) {
    const since = v.progressAt ?? v.startedAt;
    if (since != null && now - since >= stallMs) { changed = true; continue; }
    next[k] = v;
  }
  return changed ? next : ops;
}

/**
 * Render shape for the footer, or null when nothing is running.
 *
 * Deliberately the same shape the old single `busy` object had, so the shell
 * and every tab keep working while the model underneath changes.
 */
export function toBusy(ops) {
  const primary = primaryOp(ops);
  if (!primary) return null;
  const count = activeOps(ops).length;
  return {
    message: primary.message ?? '',
    steps: primary.steps ?? [],
    onCancel: primary.onCancel,
    key: primary.key,
    count,
  };
}
