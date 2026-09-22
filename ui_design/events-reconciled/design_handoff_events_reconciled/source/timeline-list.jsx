// Events tab (reconciled) — Right Timeline list, grouped by Act (chapter).
// Each row: timestamp · recipe name + derived duration · device tags ·
// optional NSFW description · play (seek) + delete. Clicking selects (and
// loads the event into the capture cluster for editing).

const { useMemo: tlMemo } = React;

function RxTimelineList({ events, scopeId, selectedId, nsfw, onSelect, onSeek, onDelete }) {
  const byChapter = tlMemo(() => {
    const map = {};
    window.RX_CHAPTERS.forEach(c => { map[c.id] = []; });
    [...events].sort((a, b) => a.begin_ms - b.begin_ms).forEach(e => { (map[e.chapter] = map[e.chapter] || []).push(e); });
    return map;
  }, [events]);

  return (
    <div className="rx-panel rx-list">
      <div className="rx-list__head">
        <span className="rx-list__title">Timeline</span>
        <span className="rx-list__count">{events.length} events</span>
      </div>
      <div className="rx-list__scroll">
        {window.RX_CHAPTERS.map(ch => {
          const evs = byChapter[ch.id] || [];
          return (
            <div key={ch.id}>
              <div className="rx-act" style={ch.id === scopeId ? { background: "rgba(255,75,75,0.06)" } : null}>
                <span className="rx-act__dot" style={{ background: ch.color }} />
                <span className="rx-act__lbl" style={{ color: ch.color }}>{ch.short}</span>
                <span className="rx-act__count">{evs.length}</span>
              </div>
              {evs.map(ev => {
                const r = window.RX_recipeById(ev.recipe);
                const cat = window.RX_catById(r?.cat);
                const tags = window.RX_DEVICES.filter(d => ev.devices && ev.devices[d.id] != null).map(d => d.id);
                const desc = nsfw ? (r?.longNsfw || r?.nsfw) : null;
                return (
                  <div key={ev.id}
                       className={"rx-ev" + (ev.id === selectedId ? " rx-ev--sel" : "") + (ev.chapter !== scopeId ? " rx-ev--out" : "")}
                       onClick={() => onSelect(ev.id)}>
                    <span className="rx-ev__time">{window.RX_fmtTime(ev.begin_ms, true).slice(0, 8)}</span>
                    <div className="rx-ev__main">
                      <div className="rx-ev__namerow">
                        <span className="rx-ev__dot" style={{ background: r?.isBaseline ? "transparent" : cat?.accent, border: r?.isBaseline ? "1.5px dashed #6b7390" : "none" }} />
                        <span className="rx-ev__name">{r?.label}</span>
                        <span className="rx-ev__dur">{window.RX_durLabel(ev)}</span>
                      </div>
                      {tags.length > 0 && (
                        <div className="rx-ev__tags">{tags.map(t => <span key={t} className="rx-ev__tag">{t}</span>)}</div>
                      )}
                      {desc && <div className="rx-ev__nsfw">{desc}</div>}
                    </div>
                    <div className="rx-ev__actions">
                      <button className="rx-ev__btn" title="Seek to event" onClick={(e) => { e.stopPropagation(); onSeek(ev.begin_ms); }}>▷</button>
                      <button className="rx-ev__btn rx-ev__btn--del" title="Delete event" onClick={(e) => { e.stopPropagation(); onDelete(ev.id); }}>🗑</button>
                    </div>
                  </div>
                );
              })}
              {evs.length === 0 && <div style={{ padding: "8px 14px", fontSize: 11, color: "var(--text-dim)" }}>No events in this act.</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { RxTimelineList });
