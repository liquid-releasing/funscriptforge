// AppShell — TopBar + ChapterScopeBar + TabStrip + StatusBar.
// Replaces the old NavRail/StageStrip with the real product structure:
// 10 tabs (Project · Chapters · Device · Tone · Phrases · Patterns ·
// Stim · Multi-axis · Export · Next Steps), each with its own Accept-
// and-chain button writing a chain file the next tab consumes.

const { useState: shState } = React;

// ─── TopBar ───────────────────────────────────────────────────────
function TopBar({ file, scope, onScopeChange, chapters, isPlaying, onPlayPause, currentMs, totalMs }) {
  return (
    <header style={{
      height: "var(--header-h)", padding: "0 18px", flexShrink: 0,
      background: "var(--surface)", borderBottom: "1px solid var(--border)",
      display: "flex", alignItems: "center", gap: 14,
    }}>
      <div style={{
        width: 28, height: 28, background: "var(--accent)", borderRadius: 6,
        display: "grid", placeItems: "center", color: "#fff", fontWeight: 800,
        fontFamily: "var(--font-display)", fontSize: 14, letterSpacing: "-0.04em",
      }}>F</div>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{file.title}</span>
        <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {fmtTimeShort(file.durationMs)} · {file.phraseCount} phrases · {file.actionCount} actions · imported {file.imported}
        </span>
      </div>
      <Pill tone="accent" dot>Alpha 0.5</Pill>

      <div style={{ flex: 1 }} />

      {/* Chapter scope picker — what is the user currently working on? */}
      <ChapterScopePicker chapters={chapters} value={scope} onChange={onScopeChange} />

      <div style={{ flex: 1 }} />

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <Button kind="ghost" size="icon"><Icon name="undo-2" size={14} /></Button>
        <Button kind="ghost" size="icon"><Icon name="redo-2" size={14} /></Button>
        <div style={{ width: 1, height: 22, background: "var(--border)", margin: "0 6px" }} />
        <Button kind="secondary" size="sm" icon="folder-open">Project…</Button>
        <Button kind="primary" size="sm" icon="download">Export</Button>
      </div>
    </header>
  );
}

// Chapter scope = what slice all tabs operate on. "All chapters" or one chapter.
function ChapterScopePicker({ chapters, value, onChange }) {
  const [open, setOpen] = shState(false);
  const current = value === "all"
    ? { id: "all", title: "All chapters", color: "#94a3b8" }
    : chapters.find(c => c.id === value) ?? chapters[0];

  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 10,
        padding: "6px 12px", borderRadius: 8,
        background: "var(--surface-2)", border: "1px solid var(--border)",
        color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
      }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: current.color }} />
        <span style={{ fontSize: 11, color: "var(--text-dim)", fontWeight: 600,
                       textTransform: "uppercase", letterSpacing: "0.06em" }}>Scope</span>
        <span style={{ fontSize: 13, fontWeight: 600 }}>{current.title}</span>
        <Icon name="chevron-down" size={12} style={{ color: "var(--text-dim)" }} />
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 6px)", left: 0,
          minWidth: 240, padding: 4, zIndex: 20,
          background: "var(--surface)", border: "1px solid var(--border)",
          borderRadius: 8, boxShadow: "var(--elev-2)",
        }} onMouseLeave={() => setOpen(false)}>
          {[{ id: "all", title: "All chapters", color: "#94a3b8" }, ...chapters].map(c => (
            <button key={c.id}
                    onClick={() => { onChange(c.id); setOpen(false); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "8px 10px", borderRadius: 5, border: "none",
                      background: c.id === current.id ? "var(--surface-2)" : "transparent",
                      color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
                      fontSize: 13, textAlign: "left",
                    }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: c.color }} />
              <span>{c.title}</span>
              {c.id !== "all" && (
                <span className="mono" style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
                  {fmtTimeShort(c.start)}–{fmtTimeShort(c.end)}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Tab strip ────────────────────────────────────────────────────
// Pipeline tabs (the linear workflow) on the left, utility tabs (Catalog,
// Help) pushed to the right.
const FF_TABS = [
  { id: "project",    label: "Project",     icon: "folder",         pipeline: "project"    },
  { id: "device",     label: "Device",      icon: "cpu",            pipeline: "device"     },
  { id: "chapters",   label: "Chapters",    icon: "bookmark",       pipeline: "chapters"   },
  { id: "edit",       label: "Edit",        icon: "scan-line",      pipeline: "edit"       },
  { id: "stim",       label: "Stim",        icon: "zap",            pipeline: "stim"       },
  { id: "multiaxis",  label: "Multi-axis",  icon: "axis-3d",        pipeline: "multiaxis"  },
  { id: "exportTab",  label: "Export",      icon: "download",       pipeline: "exportTab"  },
];
const FF_UTILITY_TABS = [
  { id: "catalog",    label: "Catalog",     icon: "library",        pipeline: null         },
];

function renderTabButton(t, i, list, active, pipeline, onChange) {
  const isActive = t.id === active;
  const upstream = i === 0 ? null : list[i - 1];
  const accepted = t.pipeline ? pipeline[t.pipeline]?.accepted : false;
  const upAccepted = !upstream || (!upstream.pipeline) || pipeline[upstream.pipeline]?.accepted;
  const notReady = !upAccepted && !isActive;
  return (
    <button key={t.id} onClick={() => onChange(t.id)} style={{
      display: "flex", alignItems: "center", gap: 8,
      padding: "12px 14px", border: "none",
      background: "transparent", cursor: "pointer",
      color: isActive ? "var(--text)" : (notReady ? "var(--text-dim)" : "var(--text-muted)"),
      fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
      borderBottom: `2px solid ${isActive ? "var(--accent)" : "transparent"}`,
      opacity: notReady ? 0.7 : 1, position: "relative",
    }}>
      <Icon name={t.icon} size={14} />
      <span>{t.label}</span>
      {accepted && <span style={{
        width: 6, height: 6, borderRadius: "50%", background: "var(--success)",
        boxShadow: "0 0 6px rgba(62,213,152,0.6)",
      }} />}
    </button>
  );
}

function HelpMenu() {
  const [open, setOpen] = shState(false);
  const items = [
    { icon: "book-open",     label: "User guide",        sub: "docs.funscriptforge.com" },
    { icon: "graduation-cap",label: "Getting started",   sub: "Forge your first funscript" },
    { icon: "keyboard",      label: "Keyboard shortcuts",sub: "⌘K to search" },
    { icon: "life-buoy",     label: "Troubleshooting",   sub: "Common issues + fixes" },
    { divider: true },
    { icon: "github",        label: "GitHub",            sub: "liquid-releasing/funscriptforge" },
    { icon: "message-circle",label: "Community",         sub: "Discord · feedback · ideas" },
    { divider: true },
    { icon: "info",          label: "About FunscriptForge", sub: "v0.5.0-alpha · MIT license" },
  ];
  return (
    <div style={{ position: "relative" }}>
      <button onClick={() => setOpen(o => !o)} style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "12px 14px", border: "none", background: "transparent",
        cursor: "pointer", color: "var(--text-muted)",
        fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
        borderBottom: `2px solid ${open ? "var(--accent)" : "transparent"}`,
      }}>
        <Icon name="circle-help" size={14} />
        <span>Help</span>
        <Icon name="chevron-down" size={11} style={{ color: "var(--text-dim)" }} />
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{
            position: "fixed", inset: 0, zIndex: 19,
          }} />
          <div style={{
            position: "absolute", top: "calc(100% - 1px)", right: 0,
            minWidth: 280, padding: 6, zIndex: 20,
            background: "var(--surface)", border: "1px solid var(--border)",
            borderRadius: 8, boxShadow: "var(--elev-2)",
          }}>
            {items.map((it, i) => it.divider ? (
              <div key={i} style={{ height: 1, background: "var(--border)", margin: "4px 6px" }} />
            ) : (
              <button key={i} onClick={() => setOpen(false)} style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%",
                padding: "9px 10px", borderRadius: 5, border: "none",
                background: "transparent", cursor: "pointer",
                color: "var(--text)", fontFamily: "inherit", textAlign: "left",
              }}>
                <Icon name={it.icon} size={14} style={{ color: "var(--text-dim)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>{it.sub}</div>
                </div>
                <Icon name="external-link" size={11} style={{ color: "var(--text-dim)" }} />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function TabStrip({ active, onChange, pipeline }) {
  return (
    <nav style={{
      display: "flex", alignItems: "stretch",
      background: "var(--surface)", borderBottom: "1px solid var(--border)",
      padding: "0 18px", gap: 2, flexShrink: 0, overflowX: "auto",
    }}>
      {FF_TABS.map((t, i) => renderTabButton(t, i, FF_TABS, active, pipeline, onChange))}
      <div style={{ flex: 1 }} />
      <div style={{ width: 1, background: "var(--border)", margin: "8px 8px" }} />
      {FF_UTILITY_TABS.map((t, i) => renderTabButton(t, i, FF_UTILITY_TABS, active, pipeline, onChange))}
      <HelpMenu />
    </nav>
  );
}

// ─── StatusBar ─────────────────────────────────────────────────────
function StatusBar({ scope, chainFile }) {
  return (
    <footer style={{
      height: "var(--status-h)", padding: "0 14px", flexShrink: 0,
      background: "var(--surface)", borderTop: "1px solid var(--border)",
      display: "flex", alignItems: "center", gap: 14, fontSize: 11, color: "var(--text-dim)",
    }}>
      <span><Icon name="circle-check" size={11} style={{ verticalAlign: "-1px", color: "var(--success)", marginRight: 4 }} />Synced</span>
      <span className="mono">scope: {scope}</span>
      {chainFile && <span className="mono">→ {chainFile}</span>}
      <div style={{ flex: 1 }} />
      <span>FunscriptForge v0.5.0-alpha</span>
    </footer>
  );
}

// ─── AcceptBar ─────────────────────────────────────────────────────
// The bottom bar of every tab: "Accept and chain" writes the chain file.
function AcceptBar({ summary, chainFile, accepted, onAccept, onReset, primaryLabel = "Accept and chain" }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14,
      padding: "12px 22px", background: "var(--surface)",
      borderTop: "1px solid var(--border)", flexShrink: 0,
    }}>
      <Icon name={accepted ? "check-circle-2" : "info"} size={16}
            style={{ color: accepted ? "var(--success)" : "var(--text-dim)" }} />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", lineHeight: 1.3 }}>
        <span style={{ fontSize: 12, color: "var(--text)" }}>{summary}</span>
        {chainFile && (
          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            writes <span style={{ color: "var(--accent-light, #ff7b7b)" }}>{chainFile}</span> · downstream tabs read this file
          </span>
        )}
      </div>
      {accepted && <Pill tone="success" dot>Accepted</Pill>}
      <Button kind="ghost" size="sm" onClick={onReset}>Reset</Button>
      <Button kind={accepted ? "secondary" : "primary"} icon={accepted ? "rotate-cw" : "check"}
              onClick={onAccept}>
        {accepted ? "Re-accept" : primaryLabel}
      </Button>
    </div>
  );
}

// ─── Layout helpers ────────────────────────────────────────────────
function TabBody({ children, padded = true }) {
  return (
    <div style={{
      flex: 1, minHeight: 0, overflow: "auto",
      padding: padded ? "24px 28px" : 0, background: "var(--bg)",
    }}>
      {children}
    </div>
  );
}
function TabHeader({ title, subtitle, eyebrow, right }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end",
                  justifyContent: "space-between", gap: 16, marginBottom: 22 }}>
      <div>
        {eyebrow && <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                                  textTransform: "uppercase", letterSpacing: "0.08em",
                                  marginBottom: 6 }}>{eyebrow}</div>}
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.01em" }}>{title}</h2>
        {subtitle && <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 6,
                                   maxWidth: 720, lineHeight: 1.5 }}>{subtitle}</div>}
      </div>
      {right}
    </div>
  );
}

function SectionLabel({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                  fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                  textTransform: "uppercase", letterSpacing: "0.08em",
                  marginBottom: 12 }}>
      <span>{children}</span>
      {right}
    </div>
  );
}

Object.assign(window, {
  TopBar, TabStrip, StatusBar, AcceptBar, TabBody, TabHeader, SectionLabel,
  FF_TABS, FF_UTILITY_TABS,
});
