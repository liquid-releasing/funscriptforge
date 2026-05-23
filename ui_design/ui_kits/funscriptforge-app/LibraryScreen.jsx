// Library screen — what users see when they first open the app.
const { useState } = React;

function LibraryScreen({ onOpen }) {
  return (
    <div style={{ flex: 1, overflow: "auto", padding: "32px 40px", background: "var(--bg)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        {/* Hero */}
        <div style={{
          background: "linear-gradient(135deg, rgba(255,75,75,0.12), rgba(199,125,255,0.06))",
          border: "1px solid var(--border)", borderRadius: 16, padding: "32px 36px",
          marginBottom: 32, position: "relative", overflow: "hidden",
        }}>
          <div style={{
            position: "absolute", inset: 0, opacity: 0.08, pointerEvents: "none",
            backgroundImage: "radial-gradient(circle at 20% 30%, var(--accent), transparent 40%), radial-gradient(circle at 80% 70%, #c77dff, transparent 40%)",
          }} />
          <Pill tone="accent" dot style={{ marginBottom: 12 }}>Alpha — your feedback shapes this</Pill>
          <h1 style={{ fontSize: 32, fontWeight: 700, margin: "0 0 8px", letterSpacing: "-0.02em" }}>
            Forge a stronger script.
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-muted)", margin: "0 0 20px", maxWidth: 540, lineHeight: 1.5 }}>
            Drop in a funscript, refine its tone, rewrite chapters, and shape patterns to match exactly what you want — without rebuilding from zero.
          </p>
          <div style={{ display: "flex", gap: 10 }}>
            <Button kind="primary" icon="upload-cloud" onClick={onOpen}>Open script</Button>
            <Button kind="secondary" icon="file-plus">New project</Button>
          </div>
        </div>

        {/* Recent */}
        <SectionHeading title="Recent" subtitle="Pick up where you left off."
          right={<Button kind="ghost" size="sm" iconRight="chevron-right">All projects</Button>} />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14, marginBottom: 36 }}>
          <NewCard onClick={onOpen} />
          {FF_DATA.RECENT.map(f => <FileCard key={f.id} file={f} onOpen={onOpen} />)}
        </div>

        {/* Templates */}
        <SectionHeading title="Tone templates" subtitle="Start from a forged baseline." />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 12 }}>
          {FF_DATA.TONES.map(t => (
            <Card key={t.id} hoverable padding={16} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <ToneIcon id={t.id} size={42} selected />
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>{t.label}</div>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Curve, pacing, phrase set</div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

function FileCard({ file, onOpen }) {
  return (
    <Card hoverable onClick={onOpen} padding={0}>
      <div style={{
        height: 84, background: "var(--surface-2)", borderTopLeftRadius: 10, borderTopRightRadius: 10,
        position: "relative", overflow: "hidden",
      }}>
        <MiniWave seed={file.id} />
      </div>
      <div style={{ padding: "12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.title}</div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{file.duration} · {file.chapters} ch.</span>
          <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{file.edited}</span>
        </div>
      </div>
    </Card>
  );
}

function NewCard({ onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? "rgba(255,75,75,0.08)" : "var(--surface)",
        border: `1.5px dashed ${hover ? "var(--accent)" : "var(--border-strong)"}`,
        borderRadius: 10, padding: "20px 14px", cursor: "pointer", fontFamily: "inherit",
        color: hover ? "#ff7b7b" : "var(--text-muted)",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
        minHeight: 142, transition: "all 150ms",
    }}>
      <Icon name="upload-cloud" size={28} stroke={1.5} />
      <span style={{ fontSize: 13, fontWeight: 600 }}>Drop a .funscript</span>
      <span style={{ fontSize: 11, color: "var(--text-dim)" }}>or click to browse</span>
    </button>
  );
}

function MiniWave({ seed }) {
  // Cheap procedural mini-curve based on string seed
  let s = 0; for (let i = 0; i < seed.length; i++) s = (s * 31 + seed.charCodeAt(i)) >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s & 0xffff) / 65535; };
  const pts = [];
  const N = 36;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const v = 50 + 35 * Math.sin(t * 8 + rand() * 2) + (rand() - 0.5) * 25;
    pts.push([t * 100, Math.max(8, Math.min(92, v))]);
  }
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0]} ${p[1]}`).join(" ");
  const fill = `${d} L 100 100 L 0 100 Z`;
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: "100%", height: "100%" }}>
      <defs>
        <linearGradient id={`mw-${seed}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ff4b4b" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#ff4b4b" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fill} fill={`url(#mw-${seed})`} />
      <path d={d} fill="none" stroke="#ff7b7b" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

window.LibraryScreen = LibraryScreen;
