// Events tab (reconciled) — Shell: tab strip, CHAPTERS waveform, title row.
// The CHAPTERS waveform is the single scope control: clicking a chapter
// scopes the entire work area below it.

const { useMemo: shMemo } = React;

const RX_TABS = ["Library","Project","Device","Chapters","Shapes","Phrases","Stanzas","Events","Characters","Export","Catalog"];

function RxTabStrip() {
  return (
    <div className="rx-tabstrip">
      <div className="rx-tabstrip__brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fafafa" strokeWidth="1.6">
          <path d="M3 9h14a3 3 0 0 1 3 3v0H4z" /><path d="M7 15h8M9 18h4" /><path d="M10 12v3M14 12v3" />
        </svg>
        <span className="rx-tabstrip__title">FunscriptForge</span>
        <span className="rx-tabstrip__sep">/</span>
        <span className="rx-tabstrip__file">{window.RX_PROJECT.title}</span>
      </div>
      <div className="rx-tabstrip__tabs">
        {RX_TABS.map(t => (
          <div key={t} className={"rx-tab" + (t === "Events" ? " rx-tab--active" : "")}>{t}</div>
        ))}
      </div>
    </div>
  );
}

// Energy → velocity-gradient color (same palette as the funscript chart).
const RX_GRAD = ["#1f3a8a","#2563eb","#06b6d4","#22c55e","#eab308","#f97316","#ef4444"];
function rxEnergyColor(e) {
  const idx = Math.min(RX_GRAD.length - 1, Math.max(0, Math.floor(e * RX_GRAD.length)));
  return RX_GRAD[idx];
}

// ─── CHAPTERS waveform row ──────────────────────────────────────────
function RxChaptersWave({ scopeId, currentMs, onScope, onSeek }) {
  const total = window.RX_PROJECT.duration_ms;
  const stanzas = window.RX_STANZAS;
  const ref = React.useRef(null);

  const onClick = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const ms = ((e.clientX - rect.left) / rect.width) * total;
    onSeek(ms);
    const ch = window.RX_chapterAt(ms);
    if (ch) onScope(ch.id);
  };

  return (
    <div className="rx-chapters">
      <div className="rx-chapters__lbl">CHAPTERS</div>
      <div className="rx-chapters__wave" ref={ref} onClick={onClick}>
        <svg width="100%" height="100%" viewBox="0 0 1000 66" preserveAspectRatio="none">
          {/* spectrum bars from stanza energy */}
          {stanzas.map((s, i) => {
            const x = (s.start / total) * 1000;
            const w = ((s.end - s.start) / total) * 1000;
            const h = 6 + s.energy * 54;
            return (
              <rect key={s.id} x={x} y={(66 - h) / 2} width={Math.max(0.8, w - 0.6)} height={h}
                    fill={s.quiet ? "#3a4a64" : rxEnergyColor(s.energy)}
                    opacity={s.quiet ? 0.5 : 0.9} rx={0.5} />
            );
          })}
          {/* chapter dividers */}
          {window.RX_CHAPTERS.slice(1).map(c => {
            const x = (c.start / total) * 1000;
            return <line key={c.id} x1={x} x2={x} y1={0} y2={66} stroke="#0e1117" strokeWidth="2" />;
          })}
        </svg>
        {/* chapter overlays — active outline + label */}
        {window.RX_CHAPTERS.map(c => {
          const left = (c.start / total) * 100;
          const width = ((c.end - c.start) / total) * 100;
          return (
            <div key={c.id}
                 className={"rx-chapters__seg" + (c.id === scopeId ? " rx-chapters__seg--active" : "")}
                 style={{ left: `${left}%`, width: `${width}%` }}>
              <span className="rx-chapters__seglbl" style={{ color: c.id === scopeId ? "#fff" : c.color }}>{c.id}</span>
            </div>
          );
        })}
        <div className="rx-chapters__playhead" style={{ left: `${(currentMs / total) * 100}%` }} />
      </div>
    </div>
  );
}

// ─── Title row + NSFW toggle + counts ──────────────────────────────
function RxTitleRow({ scope, scopedCount, total, nsfw, onNsfw, collapsed, onCollapse }) {
  const stanzaCount = window.RX_STANZAS.filter(s => s.chapter === scope.id).length;
  return (
    <div className="rx-titlerow">
      <div className="rx-titlerow__dot" style={{ background: scope.color }} />
      <h2 className="rx-titlerow__name">{scope.label}</h2>
      <span className="rx-titlerow__meta">
        {window.RX_fmtTime(scope.start)}–{window.RX_fmtTime(scope.end)}
        <span className="rx-titlerow__sep">·</span>
        <b>{stanzaCount}</b> stanzas
        <span className="rx-titlerow__sep">·</span>
        beat {window.RX_PROJECT.bpm} bpm
      </span>
      <div className="rx-titlerow__spacer" />
      <button className={"rx-nsfw" + (nsfw ? " rx-nsfw--on" : "")} onClick={() => onNsfw(!nsfw)}>
        <span className="rx-nsfw__box">{nsfw ? "✓" : ""}</span>
        NSFW descriptions
      </button>
      <span className="rx-count"><span className="rx-count__dot" /><b>{total}</b> total</span>
      <span className="rx-count"><b>{scopedCount}</b> in scope</span>
      <button className="rx-titlerow__collapse" onClick={() => onCollapse(!collapsed)}
              title={collapsed ? "Show the chart + monitor" : "Hide the chart + monitor for more editing room"}>
        {collapsed ? "▸ Expand chart" : "▾ Collapse chart"}
      </button>
    </div>
  );
}

Object.assign(window, { RxTabStrip, RxChaptersWave, RxTitleRow, rxEnergyColor, RX_GRAD });
