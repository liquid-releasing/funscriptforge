// FunscriptForge prototype — remaining tabs (faithful + navigable).
// Analysis, Chapters, Phrases, Stanzas, Events, Channels, Polish, Export, Catalog.
// Loaded as text/babel.

const { useState: useStateR, useMemo: useMemoR } = React;

// shared: derive chapter-ish rows from the authored sections
function sectionRows(sections) {
  return sections.map((s, i) => ({
    ...s, index: i + 1,
    char: window.FF.CHAR_BY_ID[s.characterId] || {},
    durMs: s.endMs - s.beginMs,
  }));
}

function TabHeader({ eyebrow, title, sub, right }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
      <div style={{ flex: 1, minWidth: 200 }}>
        <div className="eyebrow" style={{ marginBottom: 5 }}>{eyebrow}</div>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h1>
        {sub && <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>{sub}</p>}
      </div>
      {right}
    </div>
  );
}
const PAGE = { padding: '20px 26px', maxWidth: 1180, margin: '0 auto', width: '100%' };

// ── ANALYSIS — read-only overview ─────────────────────────────────────────
function AnalysisTab({ project, sections, actions }) {
  const energy = window.FF.ENERGY;
  const rows = sectionRows(sections);
  const kpis = [
    { label: 'Duration', value: project.duration },
    { label: 'Actions', value: actions.length.toLocaleString() },
    { label: 'Sections', value: sections.length },
    { label: 'Avg BPM', value: 96 },
    { label: 'Peak', value: window.FF.fmtTime(0.9 * project.durationMs) },
  ];
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Analysis · read-only overview" title="Script overview"
        sub="A structural read of the script — energy, beats, and where the scene builds." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 12, marginBottom: 20 }}>
        {kpis.map((k) => (
          <div key={k.label} className="card" style={{ padding: '12px 14px' }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{k.label}</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{k.value}</div>
          </div>
        ))}
      </div>
      <SectionLabel>Energy heatmap</SectionLabel>
      <div style={{ marginBottom: 8 }}><Heatmap energy={energy} height={28} label="energy" /></div>
      <FunscriptChart actions={actions} totalMs={project.durationMs} height={210} sections={sections} monochrome />
      <SectionLabel style={{ marginTop: 22 }}>Beat strength</SectionLabel>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 60 }}>
        {energy.filter((_, i) => i % 4 === 0).map((e, i) => (
          <div key={i} style={{ flex: 1, height: `${Math.max(8, e * 100)}%`, background: window.velColor(e),
            opacity: 0.5 + e * 0.5, borderRadius: '2px 2px 0 0' }} />
        ))}
      </div>
    </div>
  );
}

// ── CHAPTERS — list, derived from sections authored in Generate ───────────
function ChaptersTab({ project, sections, actions }) {
  const rows = sectionRows(sections);
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Chapters · structural substrate" title="Chapters"
        sub="Chapters are the sections you drew on Generate. Boundaries flow through from the arc."
        right={<Button kind="secondary" size="sm" icon="git-compare-arrows">Re-detect</Button>} />
      <FunscriptChart actions={actions} totalMs={project.durationMs} height={170} sections={sections} />
      <div style={{ marginTop: 16, background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: 8, overflow: 'hidden' }}>
        {rows.map((r) => (
          <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px',
            borderBottom: '1px solid var(--border)' }}>
            <span className="mono" style={{ width: 24, color: 'var(--text-dim)', fontSize: 12 }}>{String(r.index).padStart(2, '0')}</span>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: r.char.color || 'var(--accent)' }} />
            <span style={{ flex: 1, fontSize: 13.5, fontWeight: 600 }}>{r.label}</span>
            <Pill tone="neutral">{r.char.label || '—'}</Pill>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', width: 130, textAlign: 'right' }}>
              {window.FF.fmtTime(r.beginMs)} – {window.FF.fmtTime(r.endMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── PHRASES / STANZAS — lens views over the same script ───────────────────
function LensTab({ project, sections, actions, unit, eyebrow, vocab }) {
  const [sel, setSel] = useStateR(0);
  const rows = sectionRows(sections);
  const phrases = useMemoR(() => {
    const out = [];
    rows.forEach((r) => {
      const n = Math.max(2, Math.round(r.durMs / 26000));
      for (let i = 0; i < n; i += 1) {
        out.push({ id: `${r.id}_${i}`, label: vocab[(out.length) % vocab.length],
          beginMs: r.beginMs + (r.durMs * i) / n, endMs: r.beginMs + (r.durMs * (i + 1)) / n,
          char: r.char, section: r.label });
      }
    });
    return out;
  }, [sections]);
  const cur = phrases[sel] || phrases[0];
  const slice = actions.filter((a) => a.at >= cur.beginMs && a.at <= cur.endMs);
  return (
    <div style={{ display: 'flex', minHeight: 0, flex: 1 }} className="fade-in">
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid var(--border)', background: 'var(--surface)', overflow: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="eyebrow">{unit} · {phrases.length}</div>
        </div>
        {phrases.map((p, i) => (
          <button key={p.id} onClick={() => setSel(i)} style={{ display: 'block', width: '100%', textAlign: 'left',
            padding: '10px 16px', border: 0, borderLeft: `3px solid ${i === sel ? 'var(--accent)' : 'transparent'}`,
            borderBottom: '1px solid var(--border)', background: i === sel ? 'var(--surface-2)' : 'transparent',
            color: 'var(--text)', cursor: 'pointer', fontFamily: 'inherit' }}>
            <div style={{ fontSize: 12.5, fontWeight: 600 }}>{p.label}</div>
            <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
              {window.FF.fmtTime(p.beginMs)} · {p.section}
            </div>
          </button>
        ))}
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: '20px 26px' }}>
        <TabHeader eyebrow={eyebrow} title={`${unit} editor`}
          sub={`Same script, grouped by ${unit.toLowerCase()}. Click any ${unit.toLowerCase().replace(/s$/, '')} to inspect and transform it.`} />
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <Pill tone="accent" dot>{cur.label}</Pill>
          <Pill tone="neutral">{cur.section}</Pill>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)', alignSelf: 'center' }}>
            {window.FF.fmtTime(cur.beginMs)} – {window.FF.fmtTime(cur.endMs)} · {slice.length} actions
          </span>
        </div>
        <FunscriptChart actions={slice} totalMs={project.durationMs} height={220} />
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          {['Smooth', 'Halve tempo', 'Double tempo', 'Invert', 'Clamp depth', 'Ease in/out'].map((t) => (
            <Button key={t} kind="secondary" size="sm">{t}</Button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── EVENTS — point-in-time effects layered on the curve ───────────────────
function EventsTab({ project, sections, actions }) {
  const events = useMemoR(() => sections.slice(1).map((s, i) => ({
    id: s.id, kind: ['edge', 'zap', 'tease', 'pulse'][i % 4], atMs: s.beginMs,
  })), [sections]);
  const KIND = { edge: '#ff5470', zap: '#ffb547', tease: '#4dabf7', pulse: '#c77dff' };
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Events · point-in-time effects" title="Events"
        sub="Drop edges, zaps and teases at exact moments — layered on top of the funscript."
        right={<Button kind="secondary" size="sm" icon="plus">Add event</Button>} />
      <div style={{ position: 'relative' }}>
        <FunscriptChart actions={actions} totalMs={project.durationMs} height={200} monochrome />
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
          {events.map((e) => (
            <div key={e.id} style={{ position: 'absolute', top: 0, bottom: 22,
              left: `${(e.atMs / project.durationMs) * 100}%`, width: 2, background: KIND[e.kind] }}>
              <span style={{ position: 'absolute', top: -2, left: -3, width: 8, height: 8, borderRadius: '50%', background: KIND[e.kind] }} />
            </div>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {events.map((e) => (
          <div key={e.id} className="card" style={{ padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', background: KIND[e.kind] }} />
            <span style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize', flex: 1 }}>{e.kind}</span>
            <span className="mono" style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{window.FF.fmtTime(e.atMs)}</span>
            <Button kind="ghost" size="iconsm" icon="trash-2" />
          </div>
        ))}
      </div>
    </div>
  );
}

// ── CHANNELS — character grid + e-stim channels ───────────────────────────
function ChannelsTab({ project, sections }) {
  const [mode, setMode] = useStateR('character');
  const rows = sectionRows(sections);
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Channels · device-agnostic output" title="Channels"
        sub="Shape the sensation per section, then Polish targets it to specific devices."
        right={<Segmented size="sm" value={mode} onChange={setMode}
          options={[{ value: 'character', label: 'Character' }, { value: 'mechanical', label: 'Mechanical' }, { value: 'body', label: 'Body' }]} />} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px,1fr))', gap: 12, marginBottom: 22 }}>
        {window.FF.CHARACTERS.map((c) => (
          <div key={c.id} className="card" style={{ padding: 14, borderColor: window.hexA(c.color, 0.4) }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color }} />
              <span style={{ fontSize: 13.5, fontWeight: 700 }}>{c.label}</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{c.tagline}</div>
          </div>
        ))}
      </div>
      <SectionLabel>Per-section assignment</SectionLabel>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {rows.map((r) => (
          <div key={r.id} style={{ padding: '8px 12px', borderRadius: 'var(--r-2)', background: 'var(--surface)',
            border: `1px solid ${window.hexA(r.char.color || '#888', 0.5)}` }}>
            <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>{r.label}</div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: r.char.color }}>{r.char.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── POLISH — per-device forge passes ──────────────────────────────────────
function PolishTab({ project }) {
  const devices = [
    { id: 'handy', label: 'Handy', icon: 'gamepad-2', note: 'clamp 0–100 · smoothing 0.3' },
    { id: 'osr2', label: 'OSR2 / multi-axis', icon: 'move-3d', note: 'roll/pitch/twist mapped' },
    { id: 'estim', label: 'E-Stim (FOC)', icon: 'zap', note: '9-channel · volume arc baked' },
    { id: 'generic', label: 'Generic / Intiface', icon: 'bluetooth', note: 'vibration amplitude curve' },
  ];
  const [on, setOn] = useStateR(['handy', 'estim']);
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Polish · device targeting" title="Polish per device"
        sub="The last shaping pass before Export — clamp, smooth and lag-correct per target station." />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(240px,1fr))', gap: 12 }}>
        {devices.map((d) => {
          const active = on.includes(d.id);
          return (
            <button key={d.id} onClick={() => setOn(active ? on.filter((x) => x !== d.id) : [...on, d.id])}
              style={{ textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: 16, borderRadius: 'var(--r-4)',
                background: active ? window.hexA('#ff4b4b', 0.06) : 'var(--surface)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`, color: 'var(--text)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <Icon name={d.icon} size={18} style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }} />
                <span style={{ fontSize: 14, fontWeight: 700, flex: 1 }}>{d.label}</span>
                {active && <Icon name="check" size={15} style={{ color: 'var(--accent)' }} />}
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{d.note}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── EXPORT — terminus ─────────────────────────────────────────────────────
function ExportTab({ project, sections }) {
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Export · write outputs" title="Export"
        sub="Bundle the funscript, every channel and chapter markers into a .forge pack." />
      <div className="card" style={{ marginBottom: 16 }}>
        <SectionLabel>Outputs</SectionLabel>
        {[`${project.title}.funscript`, `${project.title}.estim.funscript`, `${project.title}.shaker.funscript`,
          `${project.title}.chapters.json`, `${project.title}.forge`].map((f, i) => (
          <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 0',
            borderBottom: i < 4 ? '1px solid var(--border)' : 0 }}>
            <Icon name="file-down" size={15} style={{ color: 'var(--text-dim)' }} />
            <span className="mono" style={{ fontSize: 12.5, flex: 1 }}>{f}</span>
            <Pill tone="success" dot>ready</Pill>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <Button kind="secondary" size="md" icon="folder">Choose folder…</Button>
        <Button kind="warm" size="md" icon="package">Write .forge pack</Button>
      </div>
    </div>
  );
}

// ── CATALOG — reference (no project required) ─────────────────────────────
function CatalogTab() {
  const groups = [
    { name: 'Tones', items: ['Tender', 'Build', 'Tease', 'Edge', 'Climax', 'Dominant'] },
    { name: 'Shapes', items: window.FFShapes.PASSAGE_SHAPES.map((s) => `${s.glyph}  ${s.label}`) },
    { name: 'Structural transforms', items: ['Smooth', 'Halve tempo', 'Double tempo', 'Invert', 'Clamp depth', 'Fill the rails'] },
  ];
  return (
    <div style={PAGE} className="fade-in">
      <TabHeader eyebrow="Catalog · reference" title="Transform catalog"
        sub="Every tone, shape and structural transform — the source of truth. No project required." />
      {groups.map((g) => (
        <div key={g.name} style={{ marginBottom: 22 }}>
          <SectionLabel>{g.name}</SectionLabel>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {g.items.map((it) => (
              <span key={it} className="mono" style={{ padding: '7px 12px', borderRadius: 'var(--r-2)',
                background: 'var(--surface)', border: '1px solid var(--border)', fontSize: 12.5 }}>{it}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

Object.assign(window, { AnalysisTab, ChaptersTab, LensTab, EventsTab, ChannelsTab, PolishTab, ExportTab, CatalogTab });
