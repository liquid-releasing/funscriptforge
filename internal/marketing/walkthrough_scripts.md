# FunscriptForge — Walkthrough Video Scripts

Two script variants for the Cloudflare landing page video. Both use
`demo/examples/big_buck_bunny.raw.funscript` (9:55 duration, 2,211 actions)
so viewers can reproduce exactly what they see on-screen.

Target length: **~3 minutes each**. Record with voice-over, not on-screen
text. The UI speaks for itself; narration explains why.

**Important on-screen cue** used in both: after clicking **Accept** on
every tab, a green guidance bar appears at the top. Streamlit does not
auto-scroll, so the user has to **scroll back to the top** to see the
next tab. Call this out explicitly — it's the #1 UX gotcha.

---

## Script 1 — Mechanical walkthrough (The Handy)

**Audience**: Anyone with a stroker (Handy, OSR2, SR6, Intiface device).
**Promise**: Take a raw script, fix everything that's wrong with it, and
export a device-safe file in four tabs.

### Scene 1 — Open (0:00 – 0:15)

> *Visual: FunscriptForge desktop window opens. Project tab is selected.*

**Voiceover**: "This is FunscriptForge. It takes a funscript you already
have — downloaded, hand-scripted, or auto-generated — and turns it into
something that actually feels good on your device. I'll walk you through
the full workflow in about three minutes, end to end."

### Scene 2 — Load the demo (0:15 – 0:35)

> *Visual: Click Browse. Native Windows file picker opens. Navigate to
> `demo/examples/big_buck_bunny.raw.funscript`. Click Open. Back in
> the app: click Load.*

**Voiceover**: "I'll use the demo funscript that ships with the app.
It's the length of Big Buck Bunny and it's deliberately broken in every
way a raw script can be broken — so you can see what FunscriptForge fixes."

> *Visual: Waveform appears. Stats row: 9:55, 2,211 actions, avg speed 308.*

**Voiceover**: "You can see the full motion structure immediately. Nine
minutes fifty-five seconds, 2,211 actions. The export location auto-fills
next to the source file — that's where your output lands."

### Scene 3 — Project Accept (0:35 – 0:50)

> *Visual: Scroll past Media and Author (don't expand). Click Accept.
> Status panel ticks through: Saved to .forge, Funscript assessed,
> phrases detected. Green bar: "Scroll to top to select devices..."*

**Voiceover**: "Click Accept. FunscriptForge analyzes the funscript —
finds phrases, patterns, and behavioral tags. When it's done, a green
bar tells me what's next. **I scroll back to the top** to click the
next tab."

### Scene 4 — Device tab (0:50 – 1:30)

> *Visual: Click Device tab. Check "The Handy".*

**Voiceover**: "Device tab. I pick The Handy. FunscriptForge shows me
its speed limit — 400 positions per second — and flags any actions
that would exceed it."

> *Visual: Scroll to show side-by-side Original vs Device Aware charts.*

**Voiceover**: "Here's the before-and-after. The original has sections
that exceed the Handy's speed limit. The device-aware version caps them
safely without flattening the motion."

> *Visual: Scroll to Groove slider. It's at 0.35.*

**Voiceover**: "Groove adds natural timing variation — cycles don't
arrive at exactly the same moment. Zero is mechanical. Point three five
matches expert hand-scripted scripts. It's the difference between a drum
machine and a live drummer."

> *Visual: Scroll to CV heatmap strips. Click Accept. Scroll to top.*

**Voiceover**: "Accept, scroll to top, Tone tab."

### Scene 5 — Tone tab (1:30 – 2:10)

> *Visual: Tone tab. Six cards visible. Suggestion bubbles above them —
> "Best match" pointing at one card, "Most variety" at another.*

**Voiceover**: "This is the creative decision. Six moods from soft to
intense. FunscriptForge analyzes my funscript and suggests two — the
best match for what's already there, and the most variety if I want
contrast."

> *Visual: Click Select on "Build".*

**Voiceover**: "I'll go with Build. Intensity grows phrase by phrase
toward the end — works well for scenes that escalate."

> *Visual: Before/after preview updates below the cards.*

**Voiceover**: "Before-and-after preview updates live. The output is
already re-clamped to the Handy's limits — tone never breaks device
safety."

> *Visual: Click Accept. Scroll to top. Click Export.*

**Voiceover**: "Accept, scroll to top. I'll skip Phrases and Patterns
for the demo — those are for fine-tuning individual sections — and go
straight to Export."

### Scene 6 — Export (2:10 – 2:40)

> *Visual: Export tab. Velocity-colored preview chart. Scroll to show
> Export options and device checkboxes. The Handy is already selected.*

**Voiceover**: "Here's the final preview. The colors show velocity —
blue is slow, red is fast. Default options are what most scripts want:
blend seams, final smooth, and a color heatmap."

> *Visual: Click Export All. Status panel ticks through files being
> written. Click Open folder.*

**Voiceover**: "Export All. FunscriptForge writes everything into a
self-contained folder: the device-safe funscript, a heatmap, and a
forge log that records exactly what was changed. Open folder opens
it in Explorer."

### Scene 7 — Next Steps + close (2:40 – 3:00)

> *Visual: Click Next Steps tab. Playback guide for The Handy expanded.*

**Voiceover**: "Last tab: Next Steps. It tells me exactly how to play
the file on my device — in this case, upload to handyfeeling.com or
use ScriptPlayer to sync with video."

> *Visual: Cut to title card: FunscriptForge + download link + docs link.*

**Voiceover**: "Four tabs. No Python, no terminal, no configuration.
Download link's below — FunscriptForge dot com."

---

## Script 2 — Estim walkthrough (Stereostim + audio)

**Audience**: Estim users (2b, 312, Tingler, EstimHero, ZC95, FOC-Stim,
NeoStim).
**Promise**: Generate ready-to-play stereo audio files from a funscript
with no restim setup.

### Scene 1 — Open (0:00 – 0:20)

> *Visual: FunscriptForge desktop window opens.*

**Voiceover**: "Estim users: FunscriptForge can turn any funscript into
ready-to-play stereo audio files for your device. I'll show you the
full pipeline in about three minutes."

### Scene 2 — Load the demo (0:20 – 0:35)

> *Visual: Click Browse. Open `big_buck_bunny.raw.funscript`. Click Load.*

**Voiceover**: "I'll use the bundled demo funscript. It's nine minutes
fifty-five seconds long — enough to show all the phases."

### Scene 3 — Project Accept (0:35 – 0:50)

> *Visual: Click Accept. Green bar. Scroll to top.*

**Voiceover**: "Click Accept to run the analysis. Green bar appears
with the next step, and I scroll back up to the tab row. That's the
rhythm for every tab — Accept, scroll up, next tab."

### Scene 4 — Device tab, estim selection (0:50 – 1:20)

> *Visual: Device tab. Skip the mechanical column. In the estim column,
> check "Stereostim (pulse)".*

**Voiceover**: "Device tab. I'll pick Stereostim — that's the pulse-based
family: Tingler, EstimHero, ZC95. FunscriptForge shows the speed limit
and runs the device-aware pass."

> *Visual: Scroll to Groove. Already at 0.35. Click Accept. Scroll to top.*

**Voiceover**: "Groove stays at the default. Accept, scroll to top."

### Scene 5 — Tone tab (1:20 – 1:45)

> *Visual: Tone tab with suggestion bubbles. Click Select on a tone
> (e.g., Build or Tease).*

**Voiceover**: "Pick a tone. Same six moods for estim as for mechanical
— FunscriptForge handles the translation under the hood. I'll pick Tease
— it adds push-pull dynamics that work really well on estim."

> *Visual: Before/after preview. Click Accept. Scroll to top.*

**Voiceover**: "Accept, scroll to top."

### Scene 6 — Stim tab (1:45 – 2:15)

> *Visual: Stim tab. Five character cards visible — Gentle, Reactive,
> Scene Builder, Unpredictable, Balanced. Click on Reactive.*

**Voiceover**: "Stim tab. Five personality presets that control how
the sensation moves and builds. I'll pick Reactive — it tracks the
action closely, wide arc, instant response. Good for high-energy content."

> *Visual: Click Accept. Scroll to top.*

**Voiceover**: "Accept. This runs funscript-tools in the background
to generate the channel files. Scroll to top."

### Scene 7 — Export (2:15 – 2:40)

> *Visual: Export tab. Scroll to show the "Include estim audio files
> (WAV)" checkbox. Show it's already on.*

**Voiceover**: "Export tab. Because I selected Stereostim, the WAV
audio option is available — and checked by default. This is the key
piece: FunscriptForge renders real stereo audio you can play directly
on your estim device, no restim required."

> *Visual: Click Export All. Status panel shows channel files being
> written, then WAV rendering.*

**Voiceover**: "Export All. FunscriptForge writes the channel funscripts
— alpha, beta, frequency, volume — and then synthesizes the stereo
audio using math extracted from restim by Diglet48, under MIT license."

> *Visual: Click Open folder. Show the estim/ subfolder with the
> .funscript files and the .stereostim.wav file.*

**Voiceover**: "Here's the output folder. The WAV file is the
stimulation signal itself. Connect your estim device to your computer's
audio output, hit play in any media player, and sync to video with
MultiFunPlayer or ScriptPlayer."

### Scene 8 — Next Steps + close (2:40 – 3:00)

> *Visual: Next Steps tab. Expand the estim audio guide section.*

**Voiceover**: "Last tab: Next Steps tells me exactly how to play it.
For FOC-Stim or NeoStim users, there's a separate guide using restim
— FunscriptForge writes the same channel files either way."

> *Visual: Title card: FunscriptForge + download link + docs link.*

**Voiceover**: "Four tabs. Real audio, real estim, no Python. Download
link's below."

---

## Production notes

- **Window size**: 1400×900 (matches desktop.py default). Crop the recording
  so the Streamlit chrome doesn't dominate.
- **Cursor**: use a cursor highlighter — FunscriptForge's interactions are
  click-based and the mouse needs to be visible.
- **Scroll speed**: slow. Users who haven't seen the app before need time
  to process what's on screen.
- **Silence between scenes**: record with natural pauses; edit them down
  if too long. Don't rush.
- **Audio levels**: voiceover should feel conversational, not scripted.
  The script above is a reference, not a teleprompter.
- **Two videos vs one**: the two scripts share about 50% of the narration
  (intro, Project tab, Device selection pattern, Tone tab, final close).
  Consider shooting them as a single session and editing into two variants.
- **Demo file disclaimer**: mention that the demo is synthetic. The user
  will use their own funscripts — just pointing that out once avoids
  confusion.
- **End card**: FunscriptForge logo + "funscriptforge.com" + small
  "MIT Licensed · Built with Edger's funscript-tools and Diglet48's
  restim math".

## Pre-shoot checklist

- [ ] Kill all Streamlit/FunscriptForge processes before recording
- [ ] Start fresh: `dist/FunscriptForge/FunscriptForge.exe`
- [ ] Confirm demo file is at
      `dist/FunscriptForge/demo/examples/big_buck_bunny.raw.funscript`
- [ ] Window size 1400×900
- [ ] Cursor highlighter enabled
- [ ] Screen recorder set to 1080p or higher
- [ ] Audio input level checked
- [ ] Green status bar guidance visible (don't close the window between
      takes — the UI state needs to be consistent)
