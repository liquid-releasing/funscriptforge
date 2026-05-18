// CatalogTab — utility tab to the right of Export. Source-of-truth
// reference for every transform the pipeline can apply: tones, behaviors,
// structurals. Read-only browser today; "New transform…" affordance is
// stubbed (plugin / user-authored transforms land via the existing
// `cli.py validate-plugins` gate — see project_funscriptforge_pending.md).
//
// Layout (top → bottom):
//   1. Category cards (All / Tones / Behaviors / Structurals) with counts
//   2. Two-pane body:
//        Left  — search + grouped transform list
//        Right — selected transform's documentation
//                (label · category · description · best-for tags · params table)
//
// Sandbox preview (canned-signal application of the transform) is skipped
// in the skeleton — wiring lands with the per-transform CLI runner.

import { useMemo, useState } from 'react';
import { Pill, Icon, Button, TextInput } from 'forgemoment';
import { TRANSFORMS, BEHAVIOR_TAGS } from '../data/transforms.js';

const CATEGORY_META = {
  tone:       { label: 'Tones',                color: '#ff5470', icon: 'zap',
                desc: 'Set chapter mood. Six presets: Tender / Build / Tease / Edge / Climax / Dominant.' },
  behavior:   { label: 'Behaviors',            color: '#4dabf7', icon: 'sliders',
                desc: 'Non-destructive shape edits. Beat-preserving — safe to chain.' },
  structural: { label: 'Structurals',          color: '#ffb547', icon: 'shapes',
                desc: 'Destructive structure rewrites. Replace the beat. Use sparingly.' },
};
const ALL_CARD = {
  id: 'all', label: 'All entries', color: '#94a3b8', icon: 'library',
  desc: 'Browse the entire catalog.',
};
const CATEGORY_ORDER = ['tone', 'behavior', 'structural'];

export default function CatalogTab() {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(TRANSFORMS[0]?.id ?? null);

  const counts = useMemo(() => {
    const c = { all: TRANSFORMS.length };
    CATEGORY_ORDER.forEach((k) => {
      c[k] = TRANSFORMS.filter((t) => t.category === k).length;
    });
    return c;
  }, []);

  // Filter + group for the left pane.
  const groups = useMemo(() => {
    const byCat = {};
    const q = search.trim().toLowerCase();
    TRANSFORMS.forEach((t) => {
      if (category !== 'all' && t.category !== category) return;
      if (q && !t.label.toLowerCase().includes(q) && !(t.summary || '').toLowerCase().includes(q)) return;
      (byCat[t.category] = byCat[t.category] || []).push(t);
    });
    return CATEGORY_ORDER
      .map((id) => ({ id, label: CATEGORY_META[id].label, items: byCat[id] || [] }))
      .filter((g) => g.items.length > 0);
  }, [category, search]);

  const selected = TRANSFORMS.find((t) => t.id === selectedId) || null;

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <CategoryCards
        counts={counts}
        active={category}
        onChange={setCategory}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <LeftPane
          search={search}
          onSearchChange={setSearch}
          groups={groups}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <RightPane transform={selected} />
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Category cards — top strip
// ──────────────────────────────────────────────────────────────
function CategoryCards({ counts, active, onChange }) {
  const cards = [
    ALL_CARD,
    ...CATEGORY_ORDER.map((id) => ({ id, ...CATEGORY_META[id] })),
  ];
  return (
    <div style={{
      padding: '18px 24px 14px',
      background: 'var(--bg)',
      borderBottom: '1px solid var(--border)',
    }}>
      <div style={{
        fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
        textTransform: 'uppercase', letterSpacing: '0.08em',
        marginBottom: 10,
      }}>
        Catalog · {counts.all} entries · reference
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        {cards.map((c) => {
          const sel = c.id === active;
          const n = counts[c.id];
          return (
            <button
              key={c.id}
              onClick={() => onChange(c.id)}
              style={{
                display: 'flex', flexDirection: 'column', gap: 6,
                padding: '12px 14px', borderRadius: 8,
                background: sel ? c.color + '1c' : 'var(--surface)',
                border: `1.5px solid ${sel ? c.color : 'var(--border)'}`,
                color: 'var(--text)', cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Icon name={c.icon} size={14} style={{ color: c.color }} />
                <span style={{
                  fontSize: 13, fontWeight: 700,
                  color: sel ? c.color : 'var(--text)',
                }}>
                  {c.label}
                </span>
                <span style={{ flex: 1 }} />
                <span className="mono" style={{
                  fontSize: 11, fontWeight: 600, color: 'var(--text-dim)',
                }}>
                  {n}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.45 }}>
                {c.desc}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// Left pane — search + grouped transform list
// ──────────────────────────────────────────────────────────────
function LeftPane({ search, onSearchChange, groups, selectedId, onSelect }) {
  return (
    <div style={{
      width: 320, flexShrink: 0,
      display: 'flex', flexDirection: 'column',
      background: 'var(--surface)',
      borderRight: '1px solid var(--border)',
    }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
        <TextInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search transforms…"
        />
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        {groups.map((g) => (
          <div key={g.id}>
            <div style={{
              padding: '12px 16px 6px',
              fontSize: 10, fontWeight: 700, color: 'var(--text-dim)',
              textTransform: 'uppercase', letterSpacing: '0.08em',
              background: 'var(--bg)',
            }}>
              {g.label} <span style={{ color: 'var(--text-dim)' }}>· {g.items.length}</span>
            </div>
            {g.items.map((t) => (
              <ListRow
                key={t.id}
                transform={t}
                selected={t.id === selectedId}
                onClick={() => onSelect(t.id)}
              />
            ))}
          </div>
        ))}
        {groups.length === 0 && (
          <div style={{
            padding: 24, textAlign: 'center', fontSize: 12, color: 'var(--text-dim)',
          }}>
            No matches.
          </div>
        )}
      </div>
      <div style={{ padding: 14, borderTop: '1px solid var(--border)' }}>
        <Button kind="ghost" size="sm" icon="plus" disabled>
          New transform…
        </Button>
      </div>
    </div>
  );
}

function ListRow({ transform, selected, onClick }) {
  const meta = CATEGORY_META[transform.category];
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', flexDirection: 'column', gap: 2,
        width: '100%', padding: '9px 16px',
        border: 'none',
        borderLeft: `3px solid ${selected ? (meta?.color || 'var(--accent)') : 'transparent'}`,
        background: selected ? 'var(--surface-2)' : 'transparent',
        color: 'var(--text)', cursor: 'pointer', textAlign: 'left',
        fontFamily: 'inherit',
      }}
    >
      <div style={{
        fontSize: 12.5, fontWeight: 600,
        color: selected ? 'var(--text)' : 'var(--text-soft)',
      }}>
        {transform.label}
      </div>
      <div style={{
        fontSize: 11, color: 'var(--text-dim)',
        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
      }}>
        {transform.summary}
      </div>
    </button>
  );
}

// ──────────────────────────────────────────────────────────────
// Right pane — selected transform documentation
// ──────────────────────────────────────────────────────────────
function RightPane({ transform }) {
  if (!transform) {
    return (
      <div style={{
        flex: 1, display: 'grid', placeItems: 'center',
        fontSize: 12, color: 'var(--text-dim)',
        background: 'var(--bg)',
      }}>
        Pick a transform from the list.
      </div>
    );
  }
  const meta = CATEGORY_META[transform.category];
  return (
    <div style={{
      flex: 1, overflow: 'auto', padding: '26px 32px',
      background: 'var(--bg)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Pill tone="info" style={{
          background: (meta?.color || '#4dabf7') + '22',
          color: meta?.color || '#4dabf7',
        }}>
          {meta?.label || transform.category}
        </Pill>
        <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {transform.id}
        </span>
      </div>

      <h1 style={{
        margin: '0 0 8px', fontSize: 26, fontWeight: 700,
        letterSpacing: '-0.01em',
      }}>
        {transform.label}
      </h1>

      <p style={{
        margin: '0 0 22px', fontSize: 13.5, color: 'var(--text-muted)',
        lineHeight: 1.55, maxWidth: 720,
      }}>
        {transform.description || transform.summary}
      </p>

      {transform.bestFor && transform.bestFor.length > 0 && (
        <>
          <SectionLabel>Best for</SectionLabel>
          <div style={{
            display: 'flex', flexWrap: 'wrap', gap: 6,
            marginTop: 8, marginBottom: 22,
          }}>
            {transform.bestFor.map((tagId) => {
              const tg = (BEHAVIOR_TAGS || []).find((t) => t.id === tagId);
              return (
                <Pill key={tagId} tone="neutral">
                  {tg?.color && (
                    <span style={{
                      width: 8, height: 8, borderRadius: 2,
                      background: tg.color, marginRight: 6,
                      display: 'inline-block',
                    }} />
                  )}
                  {tg?.label || tagId}
                </Pill>
              );
            })}
          </div>
        </>
      )}

      {transform.params && transform.params.length > 0 && (
        <>
          <SectionLabel>Parameters</SectionLabel>
          <div style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 8, overflow: 'hidden', marginTop: 8, marginBottom: 22,
          }}>
            {transform.params.map((p, i) => (
              <div key={p.id} style={{
                display: 'grid',
                gridTemplateColumns: '180px 90px 110px 1fr',
                gap: 14, padding: '10px 16px', alignItems: 'baseline',
                borderBottom: i === transform.params.length - 1
                  ? 'none' : '1px solid var(--border)',
                fontSize: 12,
              }}>
                <span className="mono" style={{ fontWeight: 600 }}>{p.label || p.id}</span>
                <span className="mono" style={{ color: 'var(--text-dim)' }}>
                  {p.min}–{p.max}
                </span>
                <span className="mono" style={{ color: 'var(--text-dim)' }}>
                  default {p.default}{p.unit || ''}
                </span>
                <span style={{ color: 'var(--text-muted)' }}>{p.hint || '—'}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionLabel right={<span style={{ fontSize: 10, color: 'var(--text-dim)' }}>wiring-later</span>}>
        Sandbox
      </SectionLabel>
      <div style={{
        marginTop: 8, padding: 14, borderRadius: 8,
        background: 'var(--surface)',
        border: '1px dashed var(--border)',
        fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.55,
      }}>
        <Icon name="play" size={12} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        Sandbox preview — apply this transform to a canned phrase and see
        the result chart — lands with the per-transform CLI runner
        (<span className="mono">cli.py transform --preview</span>).
      </div>
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--text-muted)',
    }}>
      <span>{children}</span>
      {right}
    </div>
  );
}
