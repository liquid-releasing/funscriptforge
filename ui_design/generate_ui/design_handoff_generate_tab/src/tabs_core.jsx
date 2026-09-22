// FunscriptForge prototype — core tabs: Library, Project, Generate.
// Loaded as text/babel.

const { useState: useStateT, useEffect: useEffectT, useMemo: useMemoT, useRef: useRefT, useCallback: useCbT } = React;

// ── synth a funscript whose stroke depth/tempo tracks the drawn arc ───────
function arcValAt(arc, t) {
  if (!arc.length) return 0.5;
  if (t <= arc[0].t) return arc[0].v;
  for (let i = 1; i < arc.length; i += 1) {
    if (t <= arc[i].t) {
      const f = (t - arc[i - 1].t) / Math.max(1, arc[i].t - arc[i - 1].t);
      return arc[i - 1].v + (arc[i].v - arc[i - 1].v) * f;
    }
  }
  return arc[arc.length - 1].v;
}
// ── lane-based generator: DEPTH drives stroke amplitude, DENSITY drives tempo
function buildFromLanes(depth, density, duration) {
  const actions = []; let t = 0; let up = true; let seed = 24681;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (t < duration) {
    const td = t / duration;
    const dp = window.sampleCurve(depth, td);      // 0..1 how deep
    const dn = window.sampleCurve(density, td);     // 0..1 how busy
    const bpm = 30 + dn * 168;                      // 30 → ~198
    const half = 60000 / bpm / 2;
    const amp = 14 + dp * 84;                        // shallow tease → full rail-to-rail
    const center = 50 + (rnd() - 0.5) * 5 * (1 - dp);
    actions.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(up ? center + amp / 2 : center - amp / 2))) });
    t += half * (1 + (rnd() - 0.5) * 0.14);
    up = !up;
  }
  return actions;
}

function buildFromArc(sections, duration, opts = {}) {
  const railsFill = opts.railsFill ? 1 : 0; // 0..1 — snap strokes to full depth
  const arc = window.sampleArc(sections, duration, 700);
  const actions = []; let t = 0; let up = true; let seed = 12345;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  while (t < duration) {
    const e = arcValAt(arc, t);
    const bpm = 36 + e * 150;
    const half = 60000 / bpm / 2;
    // base amplitude tracks the arc; rails fill expands toward full-depth (≈96)
    const baseAmp = 26 + e * 66;
    const amp = baseAmp + (96 - baseAmp) * railsFill * (0.55 + 0.45 * e);
    const center = 50 + (rnd() - 0.5) * 6 * (1 - railsFill);
    actions.push({ at: Math.round(t), pos: Math.max(0, Math.min(100, Math.round(up ? center + amp / 2 : center - amp / 2))) });
    t += half * (1 + (rnd() - 0.5) * 0.16);
    up = !up;
  }
  return actions;
}

// ── diagnosis: position distribution (deciles) + dynamics score ───────────
function diagnose(actions) {
  const deciles = new Array(10).fill(0);
  let lo = 100, hi = 0, sumDepth = 0, n = 0;
  for (let i = 0; i < actions.length; i += 1) {
    const p = actions[i].pos;
    deciles[Math.max(0, Math.min(9, Math.floor(p / 10)))] += 1;
    if (p < lo) lo = p; if (p > hi) hi = p;
    if (i > 0) { sumDepth += Math.abs(p - actions[i - 1].pos); n += 1; }
  }
  const max = Math.max(1, ...deciles);
  const norm = deciles.map((d) => d / max);
  // rail usage: how much mass lives in the bottom + top deciles
  const total = actions.length || 1;
  const rails = (deciles[0] + deciles[9]) / total;
  const avgDepth = n ? sumDepth / n : 0;          // 0..100
  const coverage = (hi - lo) / 100;
  const dynamics = Math.max(0, Math.min(1, 0.45 * coverage + 0.30 * (avgDepth / 70) + 0.25 * rails * 2.2));
  return { deciles: norm, dynamics, rails, coverage, avgDepth };
}

// =========================================================================
// LIBRARY
// =========================================================================
function LibraryScreen({ onOpen }) {
  return (
    <div style={{ padding: '26px 30px', maxWidth: 1100, margin: '0 auto', width: '100%' }} className="fade-in">
      <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 4px' }}>Library</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 22px', fontSize: 13.5 }}>
        Pick or drop a source. A funscript, a video, or audio — Forge pairs media with its script automatically.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        <DropCard onOpen={onOpen} />
        {window.FF.LIBRARY.map((e) => <LibraryCard key={e.id} entry={e} onOpen={onOpen} />)}
      </div>
    </div>
  );
}
function LibraryCard({ entry, onOpen }) {
  const [hover, setHover] = useStateT(false);
  return (
    <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      onClick={() => onOpen(entry)}
      style={{ textAlign: 'left', cursor: 'pointer', padding: 0, overflow: 'hidden',
        background: 'var(--surface)', border: `1px solid ${hover ? 'var(--border-strong)' : 'var(--border)'}`,
        borderRadius: 'var(--r-4)', boxShadow: hover ? 'var(--elev-1)' : 'none',
        transition: 'all .15s var(--ease-standard)', fontFamily: 'inherit', color: 'var(--text)' }}>
      <div style={{ height: 116, position: 'relative',
        backgroundColor: 'var(--surface-2)',
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.035) 0 8px, transparent 8px 16px)',
        display: 'grid', placeItems: 'center', borderBottom: '1px solid var(--border)' }}>
        <Icon name={entry.mediaKind === 'video' ? 'film' : 'music'} size={30}
              style={{ color: entry.color, opacity: 0.9 }} stroke={1.5} />
        <span style={{ position: 'absolute', bottom: 8, right: 8, fontSize: 10.5,
          fontFamily: 'var(--font-mono)', color: 'var(--text-soft)', background: 'rgba(0,0,0,0.5)',
          padding: '2px 6px', borderRadius: 4 }}>{entry.duration}</span>
        {!entry.hasFunscript && (
          <span style={{ position: 'absolute', top: 8, left: 8 }}>
            <Pill tone="warn" dot>no script yet</Pill>
          </span>
        )}
      </div>
      <div style={{ padding: '12px 14px' }}>
        <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 4,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          {entry.hasFunscript ? `${entry.sections} sections · ${entry.edited}` : (entry.note || entry.edited)}
        </div>
      </div>
    </button>
  );
}
function DropCard({ onOpen }) {
  return (
    <button onClick={() => onOpen(window.FF.LIBRARY[0])}
      style={{ cursor: 'pointer', minHeight: 192, display: 'grid', placeItems: 'center',
        background: 'transparent', border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--r-4)',
        color: 'var(--text-muted)', fontFamily: 'inherit', textAlign: 'center', padding: 20 }}>
      <div>
        <Icon name="upload-cloud" size={30} stroke={1.5} style={{ margin: '0 auto 10px' }} />
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>Drop a file</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 4 }}>.funscript · video · audio</div>
      </div>
    </button>
  );
}

// =========================================================================
// PROJECT — enriched source hub
// =========================================================================
function ProjectTab({ project, onGenerate, onGoLibrary, onLoadSample }) {
  const [mediaView, setMediaView] = useStateT('frames');
  if (!project) {
    return <Empty icon="upload-cloud" title="No project open">
      Open a funscript or video from the <b>Library</b> tab, or load the bundled sample to explore.
      <div style={{ marginTop: 16, display: 'flex', gap: 8, justifyContent: 'center' }}>
        <Button kind="primary" size="sm" icon="star" onClick={onLoadSample}>Load sample project</Button>
        <Button kind="secondary" size="sm" icon="library" onClick={onGoLibrary}>Browse library</Button>
      </div>
    </Empty>;
  }
  const energy = window.FF.ENERGY;
  const hasScript = project.hasFunscript;
  return (
    <div style={{ display: 'flex', minHeight: 0, flex: 1 }} className="fade-in">
      {/* left rail */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid var(--border)',
                    background: 'var(--surface)', overflow: 'auto' }}>
        <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Start a project</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Button kind="primary" size="sm" icon="star" style={{ justifyContent: 'center' }} onClick={onLoadSample}>Load sample project</Button>
            <Button kind="secondary" size="sm" icon="folder-open" style={{ justifyContent: 'center' }}>Open a funscript…</Button>
            <Button kind="secondary" size="sm" icon="box" style={{ justifyContent: 'center' }}>Import a .forge bundle…</Button>
            <Button kind="ghost" size="sm" icon="library" style={{ justifyContent: 'center' }} onClick={onGoLibrary}>Browse library</Button>
          </div>
        </div>
        <div style={{ padding: '14px 16px 8px' }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Recent projects</div>
        </div>
        {window.FF.LIBRARY.map((e) => (
          <div key={e.id} style={{ display: 'flex', gap: 11, padding: '11px 16px',
            borderLeft: `3px solid ${e.id === project.id ? 'var(--accent)' : 'transparent'}`,
            background: e.id === project.id ? 'var(--surface-2)' : 'transparent',
            borderBottom: '1px solid var(--border)' }}>
            <div style={{ width: 40, height: 40, borderRadius: 6, flexShrink: 0, background: 'var(--bg)',
              border: `1px solid ${e.color}`, color: e.color, display: 'grid', placeItems: 'center' }}>
              <Icon name={e.mediaKind === 'video' ? 'film' : 'music'} size={16} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</div>
              <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
                {e.duration} · {e.hasFunscript ? e.sections + ' sec' : 'no script'}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* center */}
      <div style={{ flex: 1, overflow: 'auto', padding: '22px 28px' }}>
        {/* title block */}
        <div style={{ display: 'flex', gap: 18, marginBottom: 22 }}>
          <div style={{ width: 84, height: 84, borderRadius: 10, flexShrink: 0, background: 'var(--surface)',
            border: `1px solid ${project.color || 'var(--border)'}`, color: project.color || 'var(--text-dim)',
            display: 'grid', placeItems: 'center' }}>
            <Icon name={project.mediaKind === 'video' ? 'film' : 'music'} size={30} stroke={1.5} />
          </div>
          <div style={{ flex: 1 }}>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Project · source hub</div>
            <h2 style={{ margin: '0 0 8px', fontSize: 23, fontWeight: 700, letterSpacing: '-0.01em',
              fontFamily: 'var(--font-mono)' }}>{project.title}</h2>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <Pill tone="neutral" dot>{project.duration}</Pill>
              {hasScript
                ? <Pill tone="neutral" dot>{project.actionCount.toLocaleString()} actions</Pill>
                : <Pill tone="warn" dot>no funscript yet</Pill>}
              <Pill tone="neutral" dot>{(project.sections?.length ?? project.sections ?? 0)} sections</Pill>
              <Pill tone="info" dot>last opened {project.edited || 'just now'}</Pill>
            </div>
          </div>
        </div>

        {/* SOURCE — media views */}
        <SectionLabel right={<Segmented size="sm" value={mediaView} onChange={setMediaView}
          options={[{ value: 'frames', label: 'Frames', icon: 'film' },
                    { value: 'wave', label: 'Waveform', icon: 'audio-lines' },
                    { value: 'spec', label: 'Spectrogram', icon: 'layers' }]} />}>
          Source media
        </SectionLabel>
        <div style={{ marginBottom: 26 }}>
          {mediaView === 'frames' && <ThumbStrip count={10} height={72} />}
          {mediaView === 'wave' && <Waveform energy={energy} height={72} />}
          {mediaView === 'spec' && <Spectrogram energy={energy} height={72} />}
        </div>

        {/* FUNSCRIPT — heatmap + curve, or empty state */}
        <SectionLabel right={hasScript
          ? <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>drag to pan · scroll to zoom</span>
          : null}>Funscript</SectionLabel>
        {hasScript ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ marginBottom: 6 }}>
              <Heatmap energy={energy} height={22} label="intensity" />
            </div>
            <FunscriptChart actions={project.actions} totalMs={project.durationMs} height={240}
                            sections={project.sections} />
          </div>
        ) : (
          <div style={{ border: '1.5px dashed var(--border-strong)', borderRadius: 'var(--r-3)',
            padding: '30px 24px', textAlign: 'center', marginBottom: 14 }}>
            <Icon name="wand-2" size={26} stroke={1.5} style={{ color: 'var(--accent-warm)', margin: '0 auto 10px' }} />
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>No funscript yet — this is a video-only source</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-dim)', maxWidth: 420, margin: '0 auto 14px' }}>
              Head to <b style={{ color: 'var(--accent-warm)' }}>Generate</b> to author one: split the
              timeline into sections and shape the intensity arc.
            </div>
            <Button kind="warm" size="sm" icon="wand-2" onClick={onGenerate}>Generate a funscript</Button>
          </div>
        )}

        {/* files-in-project */}
        <SectionLabel>Files in this project</SectionLabel>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          <FileRow icon="film" name={`${project.title}.mov`} sub="video · same folder · auto-detected" tag="media" />
          {hasScript
            ? <FileRow icon="file-cog" name={`${project.title}.funscript`} sub="source funscript · imported as-is" tag="source" />
            : <FileRow icon="file-cog" name={`${project.title}.funscript`} sub="not created yet · Generate writes this" tag="source" disabled />}
          <FileRow icon="git-branch" name={`${project.title}.generate.json`} sub="section + arc state · written when Generate is accepted" tag="chain" disabled />
          <FileRow icon="settings-2" name={`${project.title}.ffmeta.json`} sub="edit metadata · created on first Accept" tag="meta" disabled />
        </div>
      </div>
    </div>
  );
}
function FileRow({ icon, name, sub, tag, disabled }) {
  const tone = tag === 'source' ? 'info' : tag === 'chain' ? 'warn' : tag === 'media' ? 'neutral' : 'neutral';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
      borderBottom: '1px solid var(--border)', opacity: disabled ? 0.5 : 1 }}>
      <Icon name={icon} size={16} style={{ color: 'var(--text-dim)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 1 }}>{sub}</div>
      </div>
      <Pill tone={tone}>{tag}</Pill>
    </div>
  );
}

// =========================================================================
// GENERATE — the new tab
// =========================================================================
const SHAPE_OPTS = window.FFShapes.PASSAGE_SHAPES.map((s) => ({ value: s.id, label: s.label }));

// global build→climax→comedown arc value at normalized t
function climaxArc(x) {
  const peak = 0.82;
  const v = x <= peak ? 0.22 + 0.68 * (x / peak) : 0.90 - 0.74 * ((x - peak) / (1 - peak));
  return Math.max(0.12, Math.min(1, v));
}

function GenerateTab({ sections, onSections, depth, setDepth, density, setDensity,
                       playheadMs, setPlayheadMs, playing, setPlaying,
                       duration, source, setSource, shaker, setShaker }) {
  const [selectedId, setSelectedId] = useStateT(sections[2]?.id);
  const liveActions = useMemoT(() => buildFromLanes(depth, density, duration), [depth, density, duration]);
  const energy = useMemoT(() => {
    const out = []; for (let i = 0; i < 256; i += 1) {
      const t = i / 255; out.push(0.5 * window.sampleCurve(depth, t) + 0.5 * window.sampleCurve(density, t));
    } return out;
  }, [depth, density]);
  const dx = useMemoT(() => diagnose(liveActions), [liveActions]);
  const selected = sections.find((s) => s.id === selectedId) || sections[0];
  const patchSelected = (patch) => onSections(sections.map((s) => s.id === selected.id ? { ...s, ...patch } : s));

  const railsFull = depth.every((p) => p.v >= 0.78);
  const hasArc = (() => { // density rises then falls = build→climax→comedown
    const peak = Math.max(...density.map((p) => p.v));
    return peak >= 0.85 && density[density.length - 1].v < peak - 0.2;
  })();

  // ── the three fixes, now mapped onto the lanes ──
  const fillRails = () => setDepth([{ t: 0, v: 0.82 }, { t: 0.5, v: 0.9 }, { t: 1, v: 0.96 }]);
  const addArc = () => setDensity([{ t: 0, v: 0.25 }, { t: 0.5, v: 0.5 }, { t: 0.85, v: 0.96 }, { t: 1, v: 0.4 }]);
  const regenerate = () => {
    setDepth(window.FF.DEFAULT_DEPTH.map((p) => ({ ...p })));
    setDensity(window.FF.DEFAULT_DENSITY.map((p) => ({ ...p })));
    setShaker(false);
  };

  return (
    <div style={{ padding: '18px 22px', width: '100%' }} className="fade-in">
      {/* header / regenerate controls */}
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="eyebrow" style={{ marginBottom: 5 }}>Generate · make / regenerate the script</div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>Author the funscript</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4, fontSize: 10 }}>Source</div>
            <Segmented size="sm" value={source} onChange={setSource}
              options={[{ value: 'audio', label: 'Audio synth', icon: 'audio-lines' },
                        { value: 'video', label: 'Video motion', icon: 'film' },
                        { value: 'import', label: 'Imported', icon: 'file-down' }]} />
          </div>
          <Button kind="warm" size="md" icon="wand-2" onClick={regenerate} style={{ alignSelf: 'flex-end' }}>Regenerate</Button>
        </div>
      </div>

      {/* two columns: source + diagnosis (left) · editors (right) */}
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
        <div style={{ width: 312, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
          <SourceCard source={source} />
          <DiagnosisPanel dx={dx} railsFull={railsFull} hasArc={hasArc} shaker={shaker}
            onFillRails={fillRails} onAddArc={addArc} onAddShaker={() => setShaker(!shaker)} />
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {/* (1) Rich funscript editor — the live result */}
          <SectionLabel right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>live result · {liveActions.length.toLocaleString()} actions</span>}>
            Funscript {railsFull && <span style={{ color: 'var(--success)' }}>· full depth</span>}
          </SectionLabel>
          <div style={{ marginBottom: 8 }}>
            <Heatmap energy={energy} height={20} label="intensity" />
          </div>
          <FunscriptChart actions={liveActions} totalMs={duration} height={200} sections={sections}
                          playheadMs={playheadMs} onSeek={setPlayheadMs} />
          {shaker && <ShakerLane energy={energy} duration={duration} playheadMs={playheadMs} />}
          <Transport playheadMs={playheadMs} setPlayheadMs={setPlayheadMs} playing={playing}
                     setPlaying={setPlaying} duration={duration} />

          {/* (2) THE AXIS-CHANGER — two lanes sharing the timeline */}
          <SectionLabel style={{ marginTop: 22 }}
            right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>grab a handle &amp; drag · double-click to add · script regenerates live</span>}>
            Axis-changer · depth &amp; density
          </SectionLabel>
          <AxisChanger depth={depth} setDepth={setDepth} density={density} setDensity={setDensity}
                       sections={sections} duration={duration} playheadMs={playheadMs} />

          {/* (3) Sections / passages — the chapter substrate */}
          <SectionLabel style={{ marginTop: 22 }}
            right={<span style={{ fontSize: 11, color: 'var(--text-dim)' }}>chapter ticks above line up with these</span>}>
            Sections &amp; passages
          </SectionLabel>
          <SectionStrip sections={sections} onSections={onSections} duration={duration}
                        selectedId={selectedId} onSelect={setSelectedId} />

          {/* selected-section controls */}
          <div className="card" style={{ padding: 14, marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>Selected section</span>
              <Pill tone="warm">{selected.label}</Pill>
              <span className="mono" style={{ fontSize: 11, color: 'var(--text-dim)' }}>
                {window.FF.fmtTime(selected.beginMs)} → {window.FF.fmtTime(selected.endMs)}
              </span>
              <span style={{ marginLeft: 'auto' }}>
                <Button kind="ghost" size="sm" icon="plus" onClick={() => {
                  const last = sections[sections.length - 1];
                  const mid = Math.round((last.beginMs + last.endMs) / 2);
                  const a = { ...last, endMs: mid };
                  const b = { ...last, id: 's' + Date.now(), beginMs: mid, label: 'New', startVal: last.endVal };
                  onSections([...sections.slice(0, -1), a, b]);
                }}>Add section</Button>
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 18, alignItems: 'start' }}>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>Begin / end</div>
                <LevelRow label="Begin" value={selected.beginMs / duration}
                  onChange={(v) => patchSelected({ beginMs: Math.round(v * duration) })} mono={window.FF.fmtTime(selected.beginMs)} />
                <LevelRow label="End" value={selected.endMs / duration}
                  onChange={(v) => patchSelected({ endMs: Math.round(v * duration) })} mono={window.FF.fmtTime(selected.endMs)} />
              </div>
              <div>
                <div className="eyebrow" style={{ marginBottom: 6, fontSize: 10 }}>Character / feel</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {window.FF.CHARACTERS.map((c) => {
                    const on = c.id === selected.characterId;
                    return (
                      <button key={c.id} onClick={() => patchSelected({ characterId: c.id })} title={c.tagline}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 9px',
                          borderRadius: 'var(--r-pill)', cursor: 'pointer', fontFamily: 'inherit',
                          fontSize: 11.5, fontWeight: 600,
                          background: on ? window.hexA(c.color, 0.18) : 'var(--surface-2)',
                          color: on ? c.color : 'var(--text-muted)',
                          border: `1px solid ${on ? c.color : 'var(--border)'}` }}>
                        <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color }} />
                        {c.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Source / video state card (left rail of Generate) ─────────────────────
function SourceCard({ source }) {
  return (
    <div className="card" style={{ padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 12 }}>
        <Pill tone="info">Source</Pill>
        <span style={{ fontSize: 13, fontWeight: 700 }}>{source === 'video' ? 'Video motion' : source === 'import' ? 'Imported' : 'Audio'}</span>
      </div>
      <div style={{ borderRadius: 'var(--r-2)', overflow: 'hidden', border: '1px solid var(--border)',
        aspectRatio: '16 / 9', backgroundColor: 'var(--surface-2)',
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.04) 0 8px, transparent 8px 16px)',
        display: 'grid', placeItems: 'center', marginBottom: 10 }}>
        <Icon name={source === 'audio' ? 'music' : 'film'} size={26} stroke={1.5} style={{ color: 'var(--text-dim)' }} />
      </div>
      <Waveform energy={window.FF.ENERGY} height={40} color="#4dabf7" />
      <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.5 }}>
        The lanes are seeded from this source. Drag a handle to override; <b style={{ color: 'var(--text-soft)' }}>Regenerate</b> reseeds.
      </div>
    </div>
  );
}

// ── Section strip — compact chapter editor under the lanes ────────────────
function SectionStrip({ sections, onSections, duration, selectedId, onSelect }) {
  return (
    <div style={{ display: 'flex', gap: 4, height: 38, borderRadius: 'var(--r-2)', overflow: 'hidden',
      border: '1px solid var(--border)', background: 'var(--surface-2)' }}>
      {sections.map((s) => {
        const c = (window.FF.CHAR_BY_ID[s.characterId] || {}).color || 'var(--accent)';
        const sel = s.id === selectedId;
        const pct = ((s.endMs - s.beginMs) / duration) * 100;
        return (
          <button key={s.id} onClick={() => onSelect(s.id)} title={`${s.label} · ${window.FF.fmtTime(s.beginMs)}–${window.FF.fmtTime(s.endMs)}`}
            style={{ flex: `0 0 ${pct}%`, minWidth: 0, border: 0, borderRight: '1px solid var(--bg)', cursor: 'pointer',
              fontFamily: 'inherit', fontSize: 11, fontWeight: 700, color: sel ? '#fff' : c,
              background: sel ? c : window.hexA(c, 0.14), overflow: 'hidden', whiteSpace: 'nowrap',
              textOverflow: 'ellipsis', padding: '0 6px' }}>
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Diagnosis "What to fix" panel (left column of Generate) ───────────────
function DiagnosisPanel({ dx, railsFull, hasArc, shaker, onFillRails, onAddArc, onAddShaker }) {
  const low = dx.dynamics < 0.45;
  const mid = dx.dynamics >= 0.45 && dx.dynamics < 0.7;
  const headline = low
    ? { tone: 'warn', icon: 'alert-triangle', text: 'Centered bell — sits mid-range, rarely reaches the rails. The #1 amateur failure.' }
    : mid
      ? { tone: 'info', icon: 'info', text: 'Decent range — strokes use most of the depth, but could push the rails harder.' }
      : { tone: 'success', icon: 'check-circle', text: 'Full-depth, dynamic strokes — reaches both rails with a clear arc.' };
  const dynColor = low ? 'var(--warn)' : mid ? 'var(--info)' : 'var(--success)';
  return (
    <div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 16 }}>
          <Pill tone="accent">Diagnosis</Pill>
          <span style={{ fontSize: 16, fontWeight: 700 }}>What to fix</span>
        </div>

        {/* deciles histogram */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 14, marginBottom: 10 }}>
          <span className="eyebrow" style={{ width: 64, fontSize: 10, paddingBottom: 4 }}>Deciles</span>
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }}>
            {dx.deciles.map((h, i) => (
              <div key={i} style={{ flex: 1, height: `${Math.max(6, h * 100)}%`, borderRadius: '2px 2px 0 0',
                background: 'var(--accent)', opacity: 0.45 + h * 0.55 }} />
            ))}
          </div>
        </div>

        {/* dynamics */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 16 }}>
          <span className="eyebrow" style={{ width: 64, fontSize: 10 }}>Dynamics</span>
          <div style={{ flex: 1, height: 7, borderRadius: 999, background: 'var(--surface-3)', overflow: 'hidden' }}>
            <div style={{ width: `${dx.dynamics * 100}%`, height: '100%', background: dynColor, borderRadius: 999,
              transition: 'width .25s var(--ease-standard)' }} />
          </div>
          <span className="mono" style={{ width: 34, textAlign: 'right', fontSize: 13, color: dynColor }}>{dx.dynamics.toFixed(2)}</span>
        </div>

        {/* headline */}
        <div style={{ display: 'flex', gap: 10, padding: '12px 13px', marginBottom: 16, borderRadius: 'var(--r-3)',
          background: window.hexA(headline.tone === 'warn' ? '#ffb547' : headline.tone === 'info' ? '#4dabf7' : '#3ed598', 0.10),
          border: `1px solid ${window.hexA(headline.tone === 'warn' ? '#ffb547' : headline.tone === 'info' ? '#4dabf7' : '#3ed598', 0.4)}` }}>
          <Icon name={headline.icon} size={16} style={{ color: dynColor, marginTop: 1, flexShrink: 0 }} />
          <span style={{ fontSize: 12.5, color: 'var(--text-soft)', lineHeight: 1.45 }}>{headline.text}</span>
        </div>

        {/* fixes */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <FixCard icon="move-diagonal" title="Fill the rails" sub="Push the DEPTH lane to full strokes"
                   applied={railsFull} onClick={onFillRails} />
          <FixCard icon="trending-up" title="Add an arc" sub="Shape DENSITY: build → climax → comedown"
                   applied={hasArc} onClick={onAddArc} />
          <FixCard icon="activity" title="Add a shaker track" sub="Bass-driven, from the same source"
                   applied={shaker} onClick={onAddShaker} />
        </div>
      </div>
    </div>
  );
}

function FixCard({ icon, title, sub, applied, onClick }) {
  const [hover, setHover] = useStateT(false);
  return (
    <button onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)} onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', cursor: 'pointer',
        padding: '11px 12px', borderRadius: 'var(--r-3)', fontFamily: 'inherit',
        background: applied ? window.hexA('#3ed598', 0.08) : (hover ? 'var(--surface-2)' : 'var(--surface-2)'),
        border: `1px solid ${applied ? window.hexA('#3ed598', 0.5) : (hover ? 'var(--border-strong)' : 'var(--border)')}`,
        color: 'var(--text)', transition: 'all .15s var(--ease-standard)' }}>
      <span style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
        background: applied ? window.hexA('#3ed598', 0.16) : window.hexA('#ff4b4b', 0.12),
        color: applied ? 'var(--success)' : 'var(--accent)' }}>
        <Icon name={applied ? 'check' : icon} size={17} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 1 }}>{applied ? 'Applied ✓' : sub}</div>
      </div>
      <Icon name="arrow-right" size={16} style={{ color: 'var(--text-dim)' }} />
    </button>
  );
}

// ── Shaker lane — a second, bass-driven axis under the main funscript ─────
function ShakerLane({ energy, duration, playheadMs }) {
  // bass-driven track: low-frequency amplitude bursts derived from energy
  const bass = useMemoT(() => energy.map((e, i) => {
    const burst = 0.5 + 0.5 * Math.sin(i * 0.55);
    return Math.max(0, Math.min(1, e * (0.45 + 0.55 * burst)));
  }), [energy]);
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <Pill tone="info" dot>shaker</Pill>
        <span style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>second axis · bass-driven from the same source</span>
      </div>
      <Heatmap energy={bass} height={30} />
    </div>
  );
}

function LevelRow({ label, value, onChange, mono }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <span style={{ width: 40, fontSize: 11, color: 'var(--text-muted)' }}>{label}</span>
      <div style={{ flex: 1 }}><Slider value={value} onChange={onChange} accent="var(--accent-warm)" /></div>
      <span className="mono" style={{ width: 42, textAlign: 'right', fontSize: 11, color: 'var(--text-soft)' }}>
        {mono != null ? mono : Math.round(value * 100) + '%'}
      </span>
    </div>
  );
}

function Transport({ playheadMs, setPlayheadMs, playing, setPlaying, duration }) {
  const step = (d) => setPlayheadMs(Math.max(0, Math.min(duration, (playheadMs || 0) + d)));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
      <Button kind="ghost" size="iconsm" icon="skip-back" title="−5s" onClick={() => step(-5000)} />
      <Button kind="secondary" size="iconsm" icon={playing ? 'pause' : 'play'} onClick={() => setPlaying(!playing)} />
      <Button kind="ghost" size="iconsm" icon="square" title="Stop" onClick={() => { setPlaying(false); setPlayheadMs(0); }} />
      <Button kind="ghost" size="iconsm" icon="skip-forward" title="+5s" onClick={() => step(5000)} />
      <span className="mono" style={{ fontSize: 12, color: 'var(--text-soft)', marginLeft: 4 }}>
        {window.FF.fmtTime(playheadMs || 0)} <span style={{ color: 'var(--text-dim)' }}>/ {window.FF.fmtTime(duration)}</span>
      </span>
    </div>
  );
}

Object.assign(window, { LibraryScreen, ProjectTab, GenerateTab, buildFromArc });
