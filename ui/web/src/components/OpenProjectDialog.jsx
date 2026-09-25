// OpenProjectDialog — shown right after a project opens, but ONLY when there's
// something to decide: either the on-disk analysis is from an older analyzer
// version (offer to recalculate), or there's a saved place to resume to. If
// the analysis is current and there's nothing to resume, it never appears —
// we don't nag.
//
// Three modes, deliberately not mixed, in this priority order:
//   • stale analysis  → recalculate prompt (resume is suppressed because the
//     consumer tabs are gated until the re-analyze finishes anyway).
//   • stale OUTPUTS   → "update your device files" (see below).
//   • resume          → "continue where you left off" → jump to that tab.
//
// Analysis outranks outputs because re-analyzing changes what the outputs
// would be built FROM; updating outputs first would just be work thrown away.
//
// The outputs branch covers two backend states, which differ in cause but not
// in remedy -- both are fixed by the same re-render, so they share one button:
//   stale   built by an older pipeline than this build
//   behind  right pipeline, but rendered before the user's latest edit
// The distinction is carried in `reasons`, which is written Python-side in
// user-facing terms; this component never composes that text itself, so a
// pipeline bump needs no UI change.
//
// Session today = { tab } via lib/sessionStore (localStorage); the portable
// `<stem>.forge/session.json` is the immediate follow-up. Version staleness
// comes from forge.js analyzerVersionStale (chapters analyzer_version stamp).

import { Button, Icon } from 'forgemoment';
import { chooseOpenPrompt, PROMPT } from '../lib/openPrompt.js';

export default function OpenProjectDialog({
  open,
  title,
  versionStale = false,
  outputsState = null,          // 'stale' | 'behind' | null
  outputsReasons = null,        // string[] from project_status
  resumeTab = null,
  resumeTabLabel = null,
  onResume,
  onRecalculate,
  onRefreshOutputs,
  onDismiss,
}) {
  if (!open) return null;

  // One source of truth for which question gets asked; the ranking and
  // its rationale live in lib/openPrompt.js, where they are tested.
  const prompt = chooseOpenPrompt({ versionStale, outputsState, resumeTab });
  const close = () => onDismiss?.();

  return (
    <div
      onClick={close}
      role="dialog" aria-modal="true" aria-label="Open project"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.55)',
        display: 'grid', placeItems: 'center',
        zIndex: 100, padding: 24,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(460px, 100%)',
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 18px', borderBottom: '1px solid var(--border)',
        }}>
          <Icon name="folder-open" size={17} style={{ color: 'var(--accent)' }} />
          <span style={{ fontSize: 14.5, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title || 'Open project'}
          </span>
          <span style={{ flex: 1 }} />
          <button
            onClick={close} aria-label="Close"
            style={{
              background: 'transparent', border: 'none', color: 'var(--text-dim)',
              cursor: 'pointer', padding: 4, borderRadius: 4, display: 'grid', placeItems: 'center',
            }}
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <div style={{ padding: '18px 20px' }}>
          {prompt === PROMPT.ANALYSIS ? (
            <>
              <Row
                icon="alert-triangle" tint="#ffb547"
                head="Analysis is from an older version"
                body="This project was analyzed by an earlier version of FunscriptForge. Recalculate to bring its chapters, beats, and structure up to date — your edits and tones are kept."
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <Button kind="ghost" size="sm" onClick={close}>Later</Button>
                <Button kind="primary" size="sm" icon="refresh-ccw" onClick={() => onRecalculate?.()}>
                  Recalculate
                </Button>
              </div>
            </>
          ) : prompt === PROMPT.OUTPUTS ? (
            <>
              <Row
                icon="refresh-ccw" tint="#ffb547"
                head={outputsState === 'behind'
                  ? 'Your device files are older than your edits'
                  : 'Your device files are out of date'}
                body={(outputsReasons && outputsReasons[0])
                  || 'Update them to pick up the latest changes.'}
              />
              {outputsReasons && outputsReasons.length > 1 && (
                <ul style={{
                  margin: '10px 0 0 46px', padding: 0, listStyle: 'disc',
                  color: 'var(--text-dim)', fontSize: 12, lineHeight: 1.5,
                }}>
                  {outputsReasons.slice(1).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              )}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <Button kind="ghost" size="sm" onClick={close}>Later</Button>
                <Button kind="primary" size="sm" icon="refresh-ccw"
                        onClick={() => onRefreshOutputs?.()}>
                  Update outputs
                </Button>
              </div>
            </>
          ) : (
            <>
              <Row
                icon="rotate-ccw" tint="var(--accent)"
                head="Continue where you left off?"
                body={resumeTabLabel ? `You were last working in ${resumeTabLabel}.` : 'Pick up your last session.'}
              />
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
                <Button kind="ghost" size="sm" onClick={close}>Start fresh</Button>
                <Button kind="primary" size="sm" icon="arrow-right" onClick={() => onResume?.(resumeTab)}>
                  Resume
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, tint, head, body }) {
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
      <div style={{
        flexShrink: 0, width: 34, height: 34, borderRadius: 8,
        display: 'grid', placeItems: 'center',
        background: 'var(--surface-2)', border: '1px solid var(--border)',
      }}>
        <Icon name={icon} size={17} style={{ color: tint }} />
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4 }}>{head}</div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>{body}</div>
      </div>
    </div>
  );
}
