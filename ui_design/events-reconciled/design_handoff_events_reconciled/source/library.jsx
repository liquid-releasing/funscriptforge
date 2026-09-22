// Events tab (reconciled) — Left Effect Library: the cascading selector.
// Cascade:  Device class (Estim/Vibrator/bHaptics/Shaker)
//             → Category groups (Buzz/Stroke/Control/Shape)
//               → Recipe cards (with preview chart)
// Clicking a recipe arms it for capture. Search filters within the device.

const { useState: libState, useMemo: libMemo } = React;

// Shared recipe preview chart (reused by the capture cluster + list).
function RxChart({ recipe, w = 56, h = 22, color = "#fafafa" }) {
  if (!recipe) return null;
  const data = recipe.preview || [];
  if (data.length === 0) {
    return (
      <svg width={w} height={h} aria-hidden="true">
        <line x1={2} x2={w - 2} y1={h / 2} y2={h / 2} stroke={color} strokeWidth="1.2" strokeDasharray="3 2" opacity="0.5" />
      </svg>
    );
  }
  const pad = 2, uh = h - pad * 2;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (w - pad * 2) + pad, h - pad - v * uh]);
  const line = "M " + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ");
  const area = `M ${pad},${h - pad} L ` + pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" L ") + ` L ${w - pad},${h - pad} Z`;
  return (
    <svg width={w} height={h} aria-hidden="true">
      <path d={area} fill={color} fillOpacity="0.16" />
      <path d={line} stroke={color} strokeWidth="1.3" fill="none" />
    </svg>
  );
}

function RxEffectLibrary({ device, onDevice, armedId, onArm, query, onQuery }) {
  const cats = window.RX_CATS;
  const [collapsed, setCollapsed] = libState({}); // { [catId]: true }
  const toggle = (id) => setCollapsed(c => ({ ...c, [id]: !c[id] }));

  const grouped = libMemo(() => {
    const q = query.trim().toLowerCase();
    const match = r => !q || r.label.toLowerCase().includes(q) || r.desc.toLowerCase().includes(q);
    const out = [];
    Object.values(cats).forEach(cat => {
      const items = window.RX_RECIPES.filter(r => r.cat === cat.id && r.devices.includes(device) && match(r));
      if (items.length) out.push({ cat, items });
    });
    return out;
  }, [device, query]);

  const shown = grouped.reduce((n, g) => n + g.items.length, 0);
  const devLabel = window.RX_DEVICES.find(d => d.id === device)?.label;

  return (
    <div className="rx-panel rx-lib">
      <div className="rx-lib__head">
        <span className="rx-lib__title"><span className="rx-step">2</span>EFFECT LIBRARY</span>
        <span className="rx-lib__count">{shown}</span>
      </div>

      {/* cascade breadcrumb */}
      <div className="rx-lib__breadcrumb">
        <span className="rx-lib__crumb rx-lib__crumb--active">{devLabel}</span>
        <span className="rx-lib__crumbsep">›</span>
        <span className="rx-lib__crumb">{query ? `"${query}"` : "all categories"}</span>
      </div>

      {/* device tabs — first cascade level */}
      <div className="rx-lib__devs">
        {window.RX_DEVICES.map(d => (
          <button key={d.id} className={"rx-lib__dev" + (d.id === device ? " rx-lib__dev--on" : "")}
                  onClick={() => onDevice(d.id)}>{d.label}</button>
        ))}
      </div>

      <div className="rx-lib__search">
        <span className="rx-lib__searchicon">⌕</span>
        <input className="rx-lib__searchinput" placeholder="Search effects…"
               value={query} onChange={e => onQuery(e.target.value)} />
      </div>

      <div className="rx-lib__scroll">
        {grouped.map(({ cat, items }) => {
          const isCollapsed = !!collapsed[cat.id] && !query;
          return (
          <div key={cat.id} className="rx-lib__group">
            <button className="rx-lib__grouphead" onClick={() => toggle(cat.id)}>
              <span className={"rx-lib__groupchev" + (isCollapsed ? " rx-lib__groupchev--c" : "")}>▾</span>
              <span className="rx-lib__groupdot" style={{ background: cat.accent }} />
              <span className="rx-lib__grouplbl" style={{ color: cat.accent }}>{cat.label}</span>
              <span className="rx-lib__groupcount">{items.length}</span>
            </button>
            {!isCollapsed && items.map(r => (
              <button key={r.id}
                      className={"rx-recipe" + (r.id === armedId ? " rx-recipe--armed" : "") + (r.isBaseline ? " rx-recipe__baseline" : "")}
                      onClick={() => onArm(r.id)}>
                <span className="rx-recipe__dot" style={{ background: cat.accent }} />
                <span className="rx-recipe__main">
                  <span className="rx-recipe__name">{r.label}</span>
                  <span className="rx-recipe__desc">{r.desc}</span>
                </span>
                <span className="rx-recipe__chart">
                  <RxChart recipe={r} w={52} h={20} color={cat.accent} />
                </span>
              </button>
            ))}
          </div>
          );
        })}
        {shown === 0 && (
          <div style={{ padding: "24px 14px", color: "var(--text-dim)", fontSize: 12, textAlign: "center" }}>
            No effects on {devLabel}{query ? ` matching "${query}"` : ""}.
          </div>
        )}
      </div>
    </div>
  );
}

Object.assign(window, { RxEffectLibrary, RxChart });
