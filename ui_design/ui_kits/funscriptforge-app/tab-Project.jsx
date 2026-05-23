// ProjectTab — file / project picker.
//
// User opens the app to a list of recent projects (each project = a video or
// audio file + its source funscript + our edit metadata). They pick one or
// drop a new file in. Bottom: device picker — one or more devices selected
// before moving to the Device tab.
//
// Replaces the old "Tone templates" picker on the library screen. Tone is now
// part of the Device tab's funscript-level reset.

const { useState: prState, useMemo: prMemo } = React;

function ProjectTab({ onOpen, selectedDevices, onToggleDevice, onContinue }) {
  const [search, setSearch] = prState("");
  const [activeProjectId, setActiveProject] = prState("rec1");

  const projects = prMemo(() => {
    const all = (FF_DATA.RECENT || []).map(r => ({
      ...r,
      lastOpened: r.edited,
      // Synthetic metadata
      mediaKind: r.id.charCodeAt(0) % 2 === 0 ? "video" : "audio",
      tags: r.id.charCodeAt(1) % 2 === 0 ? ["edited"] : ["source"],
      sourceFunscript: `${r.title}.funscript`,
      mediaFile: r.id.charCodeAt(0) % 2 === 0 ? `${r.title}.mp4` : `${r.title}.m4a`,
    }));
    if (!search) return all;
    const q = search.toLowerCase();
    return all.filter(p => p.title.toLowerCase().includes(q));
  }, [search]);

  const active = projects.find(p => p.id === activeProjectId) ?? projects[0];

  return (
    <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
      {/* Left rail — recent projects */}
      <div style={{
        width: 320, flexShrink: 0, display: "flex", flexDirection: "column",
        background: "var(--surface)", borderRight: "1px solid var(--border)",
      }}>
        <div style={{ padding: "16px 18px 12px",
                      borderBottom: "1px solid var(--border)" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                        textTransform: "uppercase", letterSpacing: "0.08em",
                        marginBottom: 8 }}>Recent projects</div>
          <TextInput value={search} onChange={setSearch}
                     placeholder="Search by name…" />
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>
          {projects.map(p => {
            const sel = p.id === activeProjectId;
            return (
              <button key={p.id} onClick={() => setActiveProject(p.id)} style={{
                display: "flex", gap: 12, width: "100%",
                padding: "12px 16px", border: "none",
                borderLeft: `3px solid ${sel ? "var(--accent)" : "transparent"}`,
                borderBottom: "1px solid var(--border)",
                background: sel ? "var(--surface-2)" : "transparent",
                color: "var(--text)", cursor: "pointer", textAlign: "left",
                fontFamily: "inherit",
              }}>
                <div style={{
                  width: 44, height: 44, borderRadius: 6, flexShrink: 0,
                  background: "var(--bg)", border: "1px solid var(--border)",
                  display: "grid", placeItems: "center", color: "var(--text-dim)",
                }}>
                  <Icon name={p.mediaKind === "video" ? "film" : "music"} size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: sel ? 700 : 600,
                                overflow: "hidden", textOverflow: "ellipsis",
                                whiteSpace: "nowrap" }}>
                    {p.title}
                  </div>
                  <div className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)",
                                                 marginTop: 2 }}>
                    {p.duration} · {p.chapters} ch · {p.edited}
                  </div>
                </div>
              </button>
            );
          })}
          <button onClick={onOpen} style={{
            display: "flex", gap: 12, width: "100%",
            padding: "14px 16px", border: "none",
            borderLeft: "3px solid transparent",
            background: "transparent",
            color: "var(--accent-light, #ff7b7b)", cursor: "pointer",
            textAlign: "left", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600,
          }}>
            <Icon name="plus" size={16} />
            <span>Drop a new file…</span>
          </button>
        </div>
      </div>

      {/* Center — active project detail */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px", background: "var(--bg)" }}>
        {!active ? (
          <EmptyProject onOpen={onOpen} />
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 18, marginBottom: 22 }}>
              <div style={{
                width: 96, height: 96, borderRadius: 10, flexShrink: 0,
                background: "var(--surface)", border: "1px solid var(--border)",
                display: "grid", placeItems: "center", color: "var(--text-dim)",
              }}>
                <Icon name={active.mediaKind === "video" ? "film" : "music"} size={32} stroke={1.5} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "var(--text-dim)",
                              textTransform: "uppercase", letterSpacing: "0.08em",
                              marginBottom: 6 }}>Project</div>
                <h2 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700,
                             letterSpacing: "-0.01em" }}>{active.title}</h2>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <Pill tone="neutral">
                    <Icon name="clock" size={11} style={{ marginRight: 4 }} />
                    {active.duration}
                  </Pill>
                  <Pill tone="neutral">
                    <Icon name="bookmark" size={11} style={{ marginRight: 4 }} />
                    {active.chapters} chapters
                  </Pill>
                  <Pill tone="neutral">
                    <Icon name="hash" size={11} style={{ marginRight: 4 }} />
                    {1200 + active.id.charCodeAt(2) * 7} actions
                  </Pill>
                  <Pill tone="info" dot>last opened {active.lastOpened}</Pill>
                </div>
              </div>
              <Button kind="ghost" size="sm" icon="more-horizontal">More</Button>
            </div>

            {/* Files in project */}
            <SectionLabel>Files in this project</SectionLabel>
            <div style={{ background: "var(--surface)", border: "1px solid var(--border)",
                          borderRadius: 8, marginBottom: 24, overflow: "hidden" }}>
              <FileRow icon={active.mediaKind === "video" ? "film" : "music"}
                       name={active.mediaFile}
                       sub={`${active.mediaKind} · ${active.duration}`}
                       tag="media" />
              <FileRow icon="file-cog" name={active.sourceFunscript}
                       sub="source funscript · imported as-is" tag="source" />
              <FileRow icon="settings-2" name="project.ffmeta.json"
                       sub="our edit metadata · phrase tags, transforms, accept history"
                       tag="meta" />
              <FileRow icon="git-branch" name="_funscript_device.json"
                       sub="device-aware reset · written when Device tab is accepted"
                       tag="chain" disabled />
              <FileRow icon="git-branch" name="_funscript_phrases.json"
                       sub="phrase-level edits · written when Phrases tab is accepted"
                       tag="chain" disabled />
            </div>

            {/* Device picker — one or more devices */}
            <SectionLabel right={<span style={{ fontSize: 11, color: "var(--text-dim)",
                                                fontWeight: 500, textTransform: "none",
                                                letterSpacing: 0 }}>Pick one or more</span>}>
              Target devices
            </SectionLabel>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                          gap: 10, marginBottom: 18 }}>
              {(FF_DATA.DEVICES || []).map(d => {
                const sel = selectedDevices.includes(d.id);
                return (
                  <button key={d.id} onClick={() => onToggleDevice(d.id)} style={{
                    display: "flex", flexDirection: "column", alignItems: "flex-start",
                    gap: 8, padding: 14, borderRadius: 8,
                    background: sel ? "rgba(255,75,75,0.08)" : "var(--surface)",
                    border: `1.5px solid ${sel ? "var(--accent)" : "var(--border)"}`,
                    color: "var(--text)", cursor: "pointer", fontFamily: "inherit",
                    textAlign: "left",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, width: "100%" }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: 6,
                        background: sel ? "var(--accent)" : "var(--surface-2)",
                        color: sel ? "#fff" : "var(--text-muted)",
                        display: "grid", placeItems: "center",
                      }}>
                        <Icon name={d.icon || "cpu"} size={14} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{d.label}</span>
                      <div style={{ flex: 1 }} />
                      {sel && <Icon name="check" size={14} style={{ color: "var(--accent)" }} />}
                    </div>
                    <div style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>
                      {d.summary || `${d.maxBpm || 200} BPM max · ${d.axes || "linear"}`}
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedDevices.length === 0 && (
              <div style={{ padding: 12, fontSize: 12, color: "var(--warning)",
                            background: "rgba(255,181,71,0.08)",
                            border: "1px solid rgba(255,181,71,0.3)",
                            borderRadius: 6, marginBottom: 18 }}>
                <Icon name="alert-triangle" size={12} style={{ marginRight: 6, verticalAlign: "-2px" }} />
                Pick at least one target device to continue.
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <Button kind="ghost" size="md" icon="folder-open" onClick={onOpen}>
                Replace files…
              </Button>
              <Button kind="primary" size="md" iconRight="chevron-right"
                      disabled={selectedDevices.length === 0}
                      onClick={onContinue}>
                Continue to Device reset
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileRow({ icon, name, sub, tag, disabled }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "12px 16px", borderBottom: "1px solid var(--border)",
      opacity: disabled ? 0.5 : 1,
    }}>
      <Icon name={icon} size={16} style={{ color: "var(--text-dim)" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="mono" style={{ fontSize: 12.5, fontWeight: 600,
                                       color: "var(--text)" }}>{name}</div>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 1 }}>{sub}</div>
      </div>
      <Pill tone={tag === "source" ? "info" : tag === "chain" ? "warn" : "neutral"}>
        {tag}
      </Pill>
    </div>
  );
}

function EmptyProject({ onOpen }) {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center" }}>
      <button onClick={onOpen} style={{
        background: "var(--surface)", border: "1.5px dashed var(--border-strong)",
        borderRadius: 12, padding: "40px 56px", cursor: "pointer", fontFamily: "inherit",
        color: "var(--text-muted)", textAlign: "center",
      }}>
        <Icon name="upload-cloud" size={36} stroke={1.5} />
        <div style={{ fontSize: 14, fontWeight: 600, marginTop: 10 }}>
          Drop a media file + funscript
        </div>
        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 4 }}>
          .mp4, .m4a, .funscript
        </div>
      </button>
    </div>
  );
}

window.ProjectTab = ProjectTab;
