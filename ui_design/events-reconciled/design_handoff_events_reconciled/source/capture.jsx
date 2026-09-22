// Events tab (reconciled) — Capture bar (time selector) + Effect config + Media viewer.
//   RxCaptureBar  — horizontal Begin/End-from-playhead selector that lives in
//                   the strip beneath the chapter chart. Duration is derived.
//   RxEffectConfig— armed recipe + long description + intensity/params/devices
//                   + Add (lives in the next row, beside the library + list).
//   RxMediaViewer — compact reference monitor (image-1 sized), to the right of
//                   the chapter chart.

const { useState: cuState, useEffect: cuEffect, useRef: cuRef } = React;

function RxTimeField({ value, onChange, unset, small }) {
  const [editing, setEditing] = cuState(false);
  const [draft, setDraft] = cuState("");
  const ref = cuRef(null);
  cuEffect(() => { if (editing && ref.current) { ref.current.focus(); ref.current.select(); } }, [editing]);
  const parse = (txt) => {
    txt = String(txt || "").trim();
    let m = /^(\d{1,3}):(\d{2})(?:\.(\d{1,3}))?$/.exec(txt);
    if (m) { const s = +m[2]; if (s >= 60) return null; return +m[1]*60000 + s*1000 + (m[3] ? +m[3].padEnd(3,"0").slice(0,3) : 0); }
    m = /^(\d+(?:\.\d+)?)$/.exec(txt); if (m) return Math.round(parseFloat(m[1]) * 1000);
    return null;
  };
  if (editing) {
    return <input ref={ref} className={"rx-capread__input" + (small ? " rx-capread__input--sm" : "")} value={draft}
      onChange={e => setDraft(e.target.value)} onClick={e => e.stopPropagation()}
      onKeyDown={e => { e.stopPropagation(); if (e.key === "Enter") { const p = parse(draft); if (p != null) onChange(p); setEditing(false); } else if (e.key === "Escape") setEditing(false); }}
      onBlur={() => { const p = parse(draft); if (p != null) onChange(p); setEditing(false); }} />;
  }
  return <span className={"rx-capread" + (small ? " rx-capread--sm" : "") + (unset ? " rx-capread--unset" : "")}
    onClick={() => { if (unset) return; setDraft(window.RX_fmtTime(value, true)); setEditing(true); }}
    title={unset ? "" : "Click to type (MM:SS.mmm)"}>
    {unset ? "––:––.–––" : window.RX_fmtTime(value, true)}
  </span>;
}

function RxCheck({ on, onToggle, children }) {
  return <button className={"rx-chk" + (on ? " rx-chk--on" : "")} onClick={() => onToggle(!on)}>
    <span className="rx-chk__box">{on ? "✓" : ""}</span>{children}
  </button>;
}

// ─── Capture bar (time selector, beneath the chart) ─────────────────
function RxCaptureBar({
  beginMs, endMs, onSetBegin, onSetEnd, onBeginChange, onEndChange, onReset,
  chain, onChain, snap, onSnap,
  selectedEvent, onUpdateSel, onDeselect,
}) {
  const editing = !!selectedEvent;
  const bMs = editing ? selectedEvent.begin_ms : beginMs;
  const eMs = editing ? selectedEvent.end_ms : endMs;
  const duration = (bMs != null && eMs != null && eMs > bMs) ? eMs - bMs : null;

  return (
    <div className={"rx-capbar" + (editing ? " rx-capbar--edit" : "")}>
      <span className="rx-capbar__lead">{editing ? <>EDITING <code>{selectedEvent.id}</code></> : <><span className="rx-step">1</span>MARK BEGIN / END FROM PLAYHEAD</>}</span>

      <div className="rx-capbar__pair">
        <span className="rx-capbar__lbl">Begin</span>
        {editing
          ? <button className="rx-capbtn" onClick={() => onUpdateSel({ begin_ms: Math.min(selectedEvent.end_ms - 200, window.__rxPlayhead) })}><span className="rx-capbtn__ico" />To ▸</button>
          : <button className="rx-capbtn" onClick={onSetBegin}><span className="rx-capbtn__ico" />Capture</button>}
        <RxTimeField value={bMs} unset={bMs == null}
          onChange={v => editing ? onUpdateSel({ begin_ms: Math.min(selectedEvent.end_ms - 200, v) }) : onBeginChange(v)} />
      </div>

      <span className="rx-capbar__arrow">→</span>

      <div className="rx-capbar__pair">
        <span className="rx-capbar__lbl">End</span>
        {editing
          ? <button className="rx-capbtn" onClick={() => onUpdateSel({ end_ms: Math.max(selectedEvent.begin_ms + 200, window.__rxPlayhead) })}><span className="rx-capbtn__ico" />To ▸</button>
          : <button className="rx-capbtn" onClick={onSetEnd} disabled={bMs == null} style={bMs == null ? { opacity: 0.4, cursor: "not-allowed" } : null}><span className="rx-capbtn__ico" />Capture</button>}
        <RxTimeField value={eMs} unset={eMs == null}
          onChange={v => editing ? onUpdateSel({ end_ms: Math.max(selectedEvent.begin_ms + 200, v) }) : onEndChange(v)} />
      </div>

      <div className="rx-capbar__dur">
        <span className="rx-capbar__durlbl">DURATION · derived</span>
        <span className="rx-capbar__durval">{duration != null ? window.RX_fmtTime(duration, true) : "––:––.–––"}</span>
      </div>

      <div className="rx-capbar__spacer" />

      <div className="rx-capbar__toggles">
        <RxCheck on={chain} onToggle={onChain}>Chain</RxCheck>
        <RxCheck on={snap} onToggle={onSnap}>Snap to beat</RxCheck>
      </div>
      {editing
        ? <button className="rx-cap__reset" onClick={onDeselect}>✕ Done</button>
        : <button className="rx-cap__reset" onClick={onReset} disabled={bMs == null && eMs == null}>↻ Reset</button>}
    </div>
  );
}

// ─── Effect config (next row, beside library + list) ────────────────
function RxEffectConfig({
  armedId, nsfw, canAdd, onAdd,
  intensity, onIntensity, params, onParams, devices, onDevices,
  selectedEvent, onUpdateSel, onDeleteSel, onDeselect,
}) {
  const editing = !!selectedEvent;
  const recipe = window.RX_recipeById(editing ? selectedEvent.recipe : armedId);
  const cat = window.RX_catById(recipe?.cat);
  const isBaseline = !!recipe?.isBaseline;
  const longDesc = (nsfw ? recipe?.longNsfw : recipe?.long) || recipe?.desc;

  const inten = editing ? selectedEvent.intensity : intensity;
  const par = editing ? (selectedEvent.params || {}) : params;
  const dev = editing ? (selectedEvent.devices || {}) : devices;
  const setIntensity = v => editing ? onUpdateSel({ intensity: v }) : onIntensity(v);
  const setParams = p => editing ? onUpdateSel({ params: p }) : onParams(p);
  const setDevices = d => editing ? onUpdateSel({ devices: d }) : onDevices(d);

  return (
    <div className={"rx-panel rx-cfg" + ((editing || canAdd) ? " rx-cfg--armed" : "")}>
      <div className="rx-cfg__head">
        {!editing && <span className="rx-step">3</span>}
        <span className="rx-cfg__dot" style={{ background: isBaseline ? "transparent" : cat?.accent, border: isBaseline ? "1.5px dashed #6b7390" : "none" }} />
        <span className="rx-cfg__name">{recipe?.label}</span>
        <span className="rx-cfg__cat" style={{ background: (cat?.accent || "#6b7390") + "22", color: cat?.accent }}>{cat?.label}</span>
        <span className="rx-cfg__role">{editing ? `editing ${selectedEvent.id}` : "armed"}</span>
      </div>
      <p className="rx-cfg__desc">{longDesc}</p>

      <div className="rx-cfg__sliders">
        <div className={"rx-slider" + (isBaseline ? " rx-slider--disabled" : "")}>
          <span className="rx-slider__lbl">Intensity</span>
          <input className="rx-slider__range" type="range" min={0} max={1} step={0.01}
                 value={inten} disabled={isBaseline} onChange={e => setIntensity(parseFloat(e.target.value))} />
          <span className="rx-slider__val">{Math.round(inten * 100)}</span>
        </div>

        {recipe?.tunables?.length > 0 && !isBaseline && (
          <div className="rx-params">
            {recipe.tunables.map(t => {
              const v = par[t.key] != null ? par[t.key] : t.default;
              const disp = t.step < 1 ? v.toFixed(t.step < 0.1 ? 2 : 1) : Math.round(v);
              return (
                <div key={t.key} className="rx-param">
                  <span className="rx-param__name">{t.label}</span>
                  <input className="rx-param__range" type="range" min={t.min} max={t.max} step={t.step}
                         value={v} onChange={e => setParams({ ...par, [t.key]: parseFloat(e.target.value) })} />
                  <span className="rx-param__val">{disp}<span className="rx-slider__unit">{t.unit}</span></span>
                </div>
              );
            })}
          </div>
        )}

        <div className="rx-devs">
          <div className="rx-devs__head">
            <span className="rx-devs__lbl">Devices</span>
            <span className="rx-devs__legend">○ broadcast · ● override</span>
          </div>
          {window.RX_DEVICES.map(d => {
            const avail = recipe?.devices?.includes(d.id);
            const v = dev[d.id];
            const overridden = v != null;
            return (
              <div key={d.id} className="rx-devrow">
                <button className={"rx-devrow__toggle" + (overridden ? " rx-devrow__toggle--on" : "") + (!avail ? " rx-devrow__toggle--na" : "")}
                        disabled={!avail}
                        onClick={() => setDevices({ ...dev, [d.id]: overridden ? undefined : 1.0 })}>{overridden ? "●" : "○"}</button>
                <span className={"rx-devrow__name" + (!avail ? " rx-devrow__name--na" : "")}>{d.label}</span>
                {!avail ? <span className="rx-devrow__state rx-devrow__state--na">not on this effect</span>
                  : overridden ? <input className="rx-devrow__range" type="range" min={0} max={1} step={0.05} value={v} onChange={e => setDevices({ ...dev, [d.id]: parseFloat(e.target.value) })} />
                  : <span className="rx-devrow__state">broadcast</span>}
                <span className="rx-devrow__read">{!avail ? <span className="rx-devrow__read--dim">n/a</span> : overridden ? Math.round(v * 100) : <span className="rx-devrow__read--dim">100</span>}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rx-cfg__actions">
        {editing ? (
          <>
            <button className="rx-cap__delete" onClick={onDeleteSel}>🗑 Delete</button>
            <button className="rx-cap__add rx-cap__add--ready" onClick={onDeselect}>✓ Done</button>
          </>
        ) : (
          <>
            {!canAdd && <span className="rx-cfg__hint">Set begin &amp; end in the bar above ↑</span>}
            <button className={"rx-cap__add" + (canAdd ? " rx-cap__add--ready" : "")} onClick={onAdd} disabled={!canAdd}>+ Add event</button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Media viewer (compact reference monitor) ───────────────────────
function RxMediaViewer({ currentMs, isPlaying, onPlayPause, onSeek, onFrameStep, mode, onMode, speed, onSpeed, recipeAtPlayhead }) {
  return (
    <div className="rx-panel rx-mv">
      <div className="rx-mv__modes">
        {["Video","Audio","Spectro","Funscript"].map(m => (
          <button key={m} className={"rx-mv__mode" + (mode === m.toLowerCase() ? " rx-mv__mode--on" : "")} onClick={() => onMode(m.toLowerCase())}>{m}</button>
        ))}
      </div>
      <div className="rx-mv__stage">
        <RxStageArt mode={mode} currentMs={currentMs} />
        {recipeAtPlayhead && (
          <div className="rx-mv__np">
            <span className="rx-mv__npdot" style={{ background: recipeAtPlayhead.isBaseline ? "transparent" : window.RX_catById(recipeAtPlayhead.cat)?.accent, border: recipeAtPlayhead.isBaseline ? "1px dashed #6b7390" : "none" }} />
            <span className="rx-mv__nplbl">{recipeAtPlayhead.label}</span>
          </div>
        )}
      </div>
      <div className="rx-mv__time">
        <span className="rx-mv__timeval">{window.RX_fmtTime(currentMs, true)}</span>
        <span className="rx-mv__timedur">/ {window.RX_fmtTime(window.RX_PROJECT.duration_ms)}</span>
      </div>
      <div className="rx-mv__transport">
        <button className="rx-tbtn" title="Prev chapter" onClick={() => onSeek(window.RX_chapterAt(currentMs).start - 1)}>⏮</button>
        <button className="rx-tbtn" title="Frame back" onClick={() => onFrameStep(-1)}>◁I</button>
        <button className="rx-tbtn" title="−1s" onClick={() => onSeek(currentMs - 1000)}>«</button>
        <button className="rx-tbtn rx-tbtn--play" onClick={onPlayPause}>{isPlaying ? "❚❚" : "▶"}</button>
        <button className="rx-tbtn" title="+1s" onClick={() => onSeek(currentMs + 1000)}>»</button>
        <button className="rx-tbtn" title="Frame fwd" onClick={() => onFrameStep(1)}>I▷</button>
        <button className="rx-tbtn" title="Next chapter" onClick={() => onSeek(window.RX_chapterAt(currentMs).end + 1)}>⏭</button>
      </div>
      <div className="rx-mv__speed">
        <span className="rx-mv__speedlbl">Speed</span>
        {[0.25, 0.5, 1, 2].map(s => (
          <button key={s} className={"rx-speedbtn" + (s === speed ? " rx-speedbtn--on" : "")} onClick={() => onSpeed(s)}>{s}×</button>
        ))}
      </div>
      <div className="rx-mv__tip">Slow-mo helps land precise begin / end frames without scrubbing.</div>
    </div>
  );
}

function RxStageArt({ mode, currentMs }) {
  if (mode === "video") {
    const t = (currentMs % 60000) / 60000;
    const pals = [["#2a1f1a","#7a4a32","#c9784a"],["#1f2031","#5b3954","#a563a8"],["#1b2c2e","#3c6a72","#6abec9"],["#1a2235","#3b4a6e","#8095c2"]];
    const pal = pals[Math.floor(((currentMs/1000)/8) % pals.length)];
    return (
      <svg width="100%" height="100%" viewBox="0 0 400 230" preserveAspectRatio="xMidYMid slice">
        <defs><radialGradient id="rxvf" cx="50%" cy="55%" r="65%">
          <stop offset="0%" stopColor={pal[2]} stopOpacity="0.7" /><stop offset="50%" stopColor={pal[1]} stopOpacity="0.85" /><stop offset="100%" stopColor={pal[0]} />
        </radialGradient></defs>
        <rect width="400" height="230" fill="url(#rxvf)" />
        <ellipse cx={200 + Math.sin(t*6.28)*22} cy={108} rx="48" ry="40" fill={pal[1]} opacity="0.55" />
        <ellipse cx={200 + Math.sin(t*6.28)*22} cy={168} rx="74" ry="58" fill={pal[1]} opacity="0.55" />
        <text x="12" y="20" fill="#fafafa" opacity="0.4" fontSize="10" style={{ fontFamily: "var(--font-mono)" }}>[video @ {window.RX_fmtTime(currentMs, true)}]</text>
      </svg>
    );
  }
  return <svg width="100%" height="100%" viewBox="0 0 400 230" preserveAspectRatio="none">
    <RxStageSignal mode={mode} currentMs={currentMs} />
    <line x1="200" x2="200" y1="0" y2="230" stroke={mode === "spectro" ? "#fafafa" : "#ff4b4b"} strokeWidth="2" opacity="0.9" />
  </svg>;
}

function RxStageSignal({ mode, currentMs }) {
  let s = (Math.floor(currentMs / 800) + 3) % 2147483647; if (s <= 0) s += 2147483646;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  if (mode === "audio") {
    const N = 160, pts = [];
    for (let i = 0; i < N; i++) { const env = 0.4 + 0.6 * Math.abs(Math.sin((i/N)*Math.PI*3)); pts.push([i*2.5, 115 + (rand()-0.5)*env*90]); }
    return <g>{pts.map((p,i) => i>0 && <line key={i} x1={pts[i-1][0]} y1={pts[i-1][1]} x2={p[0]} y2={p[1]} stroke="#ff8c42" strokeWidth="1" opacity="0.7" />)}</g>;
  }
  if (mode === "spectro") {
    const cols = 80, rows = 24, cw = 400/cols, ch = 230/rows, out = [], cs = ["#0a1430","#1b3a6b","#2563eb","#06b6d4","#eab308","#f97316","#ef4444"];
    for (let c=0;c<cols;c++) for (let r=0;r<rows;r++){ const inten = Math.min(1,(1-r/rows)*0.6+rand()*0.5); out.push(<rect key={c+"-"+r} x={c*cw} y={r*ch} width={cw} height={ch} fill={cs[Math.min(6,Math.floor(inten*7))]} opacity={inten*0.7} />); }
    return <g>{out}</g>;
  }
  const N = 90, pts = [], grad = ["#1f3a8a","#2563eb","#06b6d4","#22c55e","#eab308","#f97316","#ef4444"];
  for (let i=0;i<N;i++){ const env = 0.5+0.5*Math.sin((i/N)*Math.PI*4); pts.push([i*4.4, 115 + (env+(rand()-0.5)*0.3)*95*(i%2?1:-1)]); }
  return <g>{pts.map((p,i) => <circle key={i} cx={p[0]} cy={p[1]} r="2" fill={grad[Math.min(6, Math.floor((Math.abs(p[1]-115)/115)*7))]} />)}</g>;
}

Object.assign(window, { RxCaptureBar, RxEffectConfig, RxMediaViewer });
