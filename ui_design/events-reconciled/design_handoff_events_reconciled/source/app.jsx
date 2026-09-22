// Events tab (reconciled) — orchestrator.
// Owns the master clock, scope (chapter), capture staging, the armed recipe,
// and the working event set. Chapter selection scopes the whole work area.

const { useState: aState, useEffect: aEffect, useMemo: aMemo } = React;

function RxApp() {
  const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
    "chainDefault": true,
    "snapDefault": true,
    "nsfwDefault": false,
    "defaultDevice": "estim",
    "funscriptTrack": true,
    "thumbsTrack": false
  }/*EDITMODE-END*/;
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  // Clock + transport.
  const [currentMs, setCurrentMs] = aState(250000);
  const [isPlaying, setPlaying] = aState(false);
  const [speed, setSpeed] = aState(1);
  aEffect(() => { window.__rxPlayhead = currentMs; }, [currentMs]);
  aEffect(() => {
    if (!isPlaying) return;
    let raf, last = performance.now();
    const tick = now => { const dt = now - last; last = now; setCurrentMs(ms => Math.min(window.RX_PROJECT.duration_ms - 1, ms + dt * speed)); raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, speed]);

  // Scope.
  const [scopeId, setScopeId] = aState("ch2");
  const scope = window.RX_chapterById(scopeId);
  const [selStanza, setSelStanza] = aState(null);
  aEffect(() => { setSelStanza(null); }, [scopeId]);

  // Events working set + selection.
  const [events, setEvents] = aState(window.RX_EVENTS);
  const [selectedId, setSelectedId] = aState(null);
  const selectedEvent = events.find(e => e.id === selectedId) || null;

  // Library cascade + arming.
  const [device, setDevice] = aState(TWEAK_DEFAULTS.defaultDevice);
  aEffect(() => setDevice(t.defaultDevice), [t.defaultDevice]);
  const [query, setQuery] = aState("");
  const [armedId, setArmedId] = aState("edge");

  // Capture staging.
  const [beginMs, setBeginMs] = aState(null);
  const [endMs, setEndMs] = aState(null);
  const [intensity, setIntensity] = aState(0.7);
  const [params, setParams] = aState({});
  const [devices, setDevices] = aState({});
  const [chain, setChain] = aState(TWEAK_DEFAULTS.chainDefault);
  const [snap, setSnap] = aState(TWEAK_DEFAULTS.snapDefault);
  aEffect(() => setChain(t.chainDefault), [t.chainDefault]);
  aEffect(() => setSnap(t.snapDefault), [t.snapDefault]);

  // Arm a recipe → reset its tunables/intensity to defaults; leave edit mode.
  const arm = (id) => {
    setSelectedId(null);
    setArmedId(id);
    const r = window.RX_recipeById(id);
    const d = {}; (r?.tunables || []).forEach(tt => d[tt.key] = tt.default);
    setParams(d);
    setIntensity(r?.isBaseline ? 0 : (r?.intensity ?? 0.6));
    // If armed recipe isn't available on the active device, switch device.
    if (r && !r.devices.includes(device)) setDevice(r.devices[0]);
  };

  // NSFW + viewer + tracks.
  const [nsfw, setNsfw] = aState(TWEAK_DEFAULTS.nsfwDefault);
  aEffect(() => setNsfw(t.nsfwDefault), [t.nsfwDefault]);
  const [collapsed, setCollapsed] = aState(false);
  const [viewerMode, setViewerMode] = aState("video");
  const [tracks, setTracks] = aState({ funscript: TWEAK_DEFAULTS.funscriptTrack, audio: false, spectro: false, thumbs: TWEAK_DEFAULTS.thumbsTrack });
  aEffect(() => setTracks(tr => ({ ...tr, funscript: t.funscriptTrack, thumbs: t.thumbsTrack })), [t.funscriptTrack, t.thumbsTrack]);

  // Beat snap.
  const snapMs = (ms) => { if (!snap) return ms; const b = (60 / window.RX_PROJECT.bpm) * 1000; return Math.round(ms / b) * b; };

  // Capture actions.
  const onSetBegin = () => { const ms = snapMs(currentMs); setBeginMs(ms); if (endMs != null && endMs <= ms) setEndMs(null); };
  const onSetEnd = () => { if (beginMs == null) return; setEndMs(Math.max(beginMs + 250, snapMs(currentMs))); };
  const onReset = () => { setBeginMs(null); setEndMs(null); };
  const onAdd = () => {
    if (beginMs == null || endMs == null || endMs <= beginMs) return;
    const r = window.RX_recipeById(armedId);
    const ev = {
      id: "e" + Date.now().toString(36).slice(-4),
      chapter: window.RX_chapterAt(beginMs).id,
      begin_ms: beginMs, end_ms: endMs, recipe: armedId,
      intensity: r?.isBaseline ? 0 : intensity, params: { ...params }, devices: { ...devices },
    };
    setEvents(prev => [...prev, ev]);
    if (chain) { setBeginMs(endMs); setEndMs(null); } else { setBeginMs(null); setEndMs(null); }
  };

  const updateSel = (patch) => { if (!selectedEvent) return; setEvents(prev => prev.map(e => e.id === selectedEvent.id ? { ...e, ...patch } : e)); };
  const deleteSel = () => { if (!selectedEvent) return; setEvents(prev => prev.filter(e => e.id !== selectedEvent.id)); setSelectedId(null); };
  const deleteById = (id) => { setEvents(prev => prev.filter(e => e.id !== id)); if (id === selectedId) setSelectedId(null); };

  const seek = (ms) => setCurrentMs(Math.max(0, Math.min(window.RX_PROJECT.duration_ms, ms)));
  const frameStep = (dir) => setCurrentMs(ms => Math.max(0, ms + dir * 33));

  // Selecting an event also scopes to its act + seeks to it.
  const selectEvent = (id) => {
    setSelectedId(id === selectedId ? null : id);
    const ev = events.find(e => e.id === id);
    if (ev && id !== selectedId) { setScopeId(ev.chapter); seek(ev.begin_ms); }
  };

  const recipeAtPlayhead = aMemo(() => {
    const active = events.find(e => currentMs >= e.begin_ms && currentMs < e.end_ms);
    return active ? window.RX_recipeById(active.recipe) : null;
  }, [currentMs, events]);

  const scopedCount = events.filter(e => e.chapter === scopeId).length;
  const canAdd = beginMs != null && endMs != null && endMs > beginMs;

  return (
    <div className="rx-app">
      <RxTabStrip />
      <RxChaptersWave scopeId={scopeId} currentMs={currentMs} onScope={setScopeId} onSeek={seek} />
      <RxTitleRow scope={scope} scopedCount={scopedCount} total={events.length} nsfw={nsfw} onNsfw={setNsfw} collapsed={collapsed} onCollapse={setCollapsed} />

      {/* ROW A — chapter-aware chart + compact video monitor */}
      {!collapsed && (
      <div className="rx-viewerrow">
        <RxScriptStack
          scope={scope} events={events} currentMs={currentMs}
          beginMs={beginMs} endMs={endMs} selectedId={selectedId}
          tracks={tracks} onTracks={setTracks}
          onSeek={seek} onSelect={selectEvent}
          selStanza={selStanza} onSelStanza={setSelStanza}
        />
        <RxMediaViewer
          currentMs={currentMs} isPlaying={isPlaying} onPlayPause={() => setPlaying(p => !p)}
          onSeek={seek} onFrameStep={frameStep} mode={viewerMode} onMode={setViewerMode}
          speed={speed} onSpeed={setSpeed} recipeAtPlayhead={recipeAtPlayhead}
        />
      </div>
      )}

      {/* Time selector — in the strip beneath the chart */}
      <RxCaptureBar
        beginMs={beginMs} endMs={endMs}
        onSetBegin={onSetBegin} onSetEnd={onSetEnd}
        onBeginChange={(v) => setBeginMs(Math.max(0, Math.min(window.RX_PROJECT.duration_ms, v)))}
        onEndChange={(v) => setEndMs(Math.max((beginMs || 0) + 200, Math.min(window.RX_PROJECT.duration_ms, v)))}
        onReset={onReset}
        chain={chain} onChain={setChain} snap={snap} onSnap={setSnap}
        selectedEvent={selectedEvent} onUpdateSel={updateSel} onDeselect={() => setSelectedId(null)}
      />

      {/* ROW B — effect library · effect config · timeline list */}
      <div className="rx-rowb">
        <RxEffectLibrary device={device} onDevice={setDevice} armedId={armedId} onArm={arm} query={query} onQuery={setQuery} />
        <RxEffectConfig
          armedId={armedId} nsfw={nsfw} canAdd={canAdd} onAdd={onAdd}
          intensity={intensity} onIntensity={setIntensity}
          params={params} onParams={setParams}
          devices={devices} onDevices={setDevices}
          selectedEvent={selectedEvent} onUpdateSel={updateSel} onDeleteSel={deleteSel}
          onDeselect={() => setSelectedId(null)}
        />
        <RxTimelineList events={events} scopeId={scopeId} selectedId={selectedId} nsfw={nsfw}
                        onSelect={selectEvent} onSeek={seek} onDelete={deleteById} />
      </div>

      <RxFunTimeline events={events} currentMs={currentMs} scopeId={scopeId} selectedId={selectedId}
                     onScope={setScopeId} onSeek={seek} onSelect={selectEvent} />
      <RxIOBar events={events} scopeId={scopeId} />

      <TweaksPanel title="Events tab — Tweaks">
        <TweakSection title="Capture flow">
          <TweakToggle t={t} setTweak={setTweak} k="chainDefault" label="Chain mode on"
            help="After Add, next begin auto-jumps to the just-committed end." />
          <TweakToggle t={t} setTweak={setTweak} k="snapDefault" label="Snap to beat on" />
        </TweakSection>
        <TweakSection title="Library + descriptions">
          <TweakRadio t={t} setTweak={setTweak} k="defaultDevice" label="Default device"
            options={[{ value: "estim", label: "Estim" }, { value: "vibrator", label: "Vibrator" }, { value: "shaker", label: "Shaker" }]} />
          <TweakToggle t={t} setTweak={setTweak} k="nsfwDefault" label="NSFW descriptions on" />
        </TweakSection>
        <TweakSection title="Script tracks">
          <TweakToggle t={t} setTweak={setTweak} k="funscriptTrack" label="Funscript track (muted)" />
          <TweakToggle t={t} setTweak={setTweak} k="thumbsTrack" label="Video thumbnail track" />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<RxApp />);
