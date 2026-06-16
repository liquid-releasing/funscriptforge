# FunscriptForge — Guided Tour Script (Big Buck Bunny)

**Format:** approachable marketing overview, ~6.5 min. Shows the whole system end-to-end without deep-diving individual tabs — each tab gets its own follow-up video.
**Audience:** artists & non-technical creators. Taste up front, science backstage.
**Voice:** warm, friendly, confident. A knowledgeable friend, not a salesperson. ~150 wpm.
**Companion file:** `bbb_tour.json` (Playwright tour spec — same scenes, with on-screen actions + selectors).
**Total runtime:** ~6:36.

> **Scene order follows the actual app nav:** Library → Project → **Generate → Analysis → Chapters** → (deeper tabs).
>
> **The spine:** lead with the magic (Generate builds the first draft) and use that wait to explain **what makes a great funscript**. Then **Analysis** reveals the **viewer** — your video, audio, and funscript in one place — and shows how you **use the video + audio to find the precise spot where your magic goes** (we *play* the video here). Then **Chapters**: give each chapter a **tone**, and reshape whole **patterns** — never a single cycle by hand. Then the breadth, then ship.

> **Honesty note:** deep frame-by-frame video analysis is post-beta. We never claim the tool "watches" the video — we show how *the creator* uses the video + audio in the viewer to navigate. Keep it that way until motion-CV ships.

---

## 00:00 — Welcome  *(Library screen)*
**On screen:** app opens to the Library; a soft highlight sweeps across the top nav to imply breadth.

> This is FunscriptForge. If you've ever wanted to make a funscript — the motion track that drives interactive toys and e-stim devices — but figured it meant hours of hand-drawing dots, this is for you. FunscriptForge turns a video into a finished, device-ready script, and keeps you in the driver's seat the whole way. We'll use a clip you might know — Big Buck Bunny — to walk the whole system, end to end. Don't worry about every button today; think of this as the map.

## 00:40 — Open the project  *(Library → Project)*
**On screen:** click the Big Buck Bunny card; the Project view opens.

> Everything starts in your Library — every video and project in one place. We'll open Big Buck Bunny. FunscriptForge reads the file, sets up a workspace, and never touches your original — your source stays safe while everything we create lives right alongside it. This Project view is home base: the video, its details, and the path forward. With a fresh video like this, the fastest way in is to let FunscriptForge build the first draft for you.

## 01:14 — The magic: Generate + what makes a great funscript  *(Generate)*
**On screen:** click Generate; linger on the Pace / Range intent sliders, then show the generated motion *materializing* (not a bare spinner).

> Here's the magic, right up front. Point FunscriptForge at a video, and Generate builds you a funscript from the motion itself — no drawing dots one at a time. And while it works, let me tell you what it's actually going for. We studied real, hand-crafted funscripts — the gold standard, made by people — to learn what makes one feel great instead of mechanical. The surprise: it isn't loudness, and it isn't going full-throttle the whole time. A great script *breathes.* It has an arc — it builds, it settles, it peaks, it comes back down — the way a good scene does. The motion swells and recedes with the action. And the rhythm of variation — how much the pace and the depth move over time — lives in a measurable sweet spot. Too uniform feels robotic; too random feels like noise. Generate tunes your draft to exactly that band, and locks it to the beat. You set the intent — how much pace, how much range — and the tool does the labor. You're the artist.

## 02:30 — Analysis: the viewer, and finding your spot  *(Analysis — play the video here)*
**On screen:** click Analysis; data loads. Sweep the three stacked layers (video → audio/spectrogram → funscript). On "press play," **start playback** — baton sweeps, beats tick, the funscript tape scrolls in sync — and let it run through the rest of the scene.

> Now, where does all of that come from? This is Analysis — where FunscriptForge shows its work, all in one place: the viewer. And this is the heart of the tool — three layers, stacked together. Your video. Its audio, as a waveform and a spectrogram. And the funscript itself, riding right alongside.
>
> This is how you find your way. Scrub through and watch the action, see the audio spike, follow the strokes — and land right on the exact moment you want to shape. The video and the audio are your map; they let you place yourself precisely where your magic goes. Press play, and it all moves together — the beat ticking under the playhead, the strokes scrolling in time — so you can feel what you're making, not just see it.
>
> Because every great funscript is already half-written inside the footage. The pulse, the build, the moments that want to land — they're in there. FunscriptForge surfaces that and frames it for you. Your job — the fun part — is to turn it into gold.

## 03:44 — Chapters: tone + patterns, never a cycle by hand  *(Chapters)*
**On screen:** click Chapters; sweep the chapter strip; pan the tone cards as they're named (optionally click one so a chapter takes a tone); then show the whole velocity-colored pattern (not individual points).

> And shaping it is where FunscriptForge is different. It divides your script into chapters — and you give each one a tone. Tender. Building. Teasing. Edging. Climax. That's how you direct the emotional arc of the whole piece, in broad, confident strokes. And within a chapter, you work in patterns, not dots. A finished script holds thousands of individual strokes, and the last thing you want is to nudge them one at a time. Want a stretch to feel more relentless, or more varied? You reshape the whole pattern at once, and the fine detail takes care of itself. You're never editing math; you're directing the feel — chapter by chapter, tone by tone. That's the difference between a script that's merely correct and one your audience remembers — and you get there without ever touching a single cycle by hand.

## 04:48 — A whole studio  *(nav overview — no deep dive)*
**On screen:** hover each tab as it's named — about one every six seconds. Do **not** click in. *(Generate and Chapters had their own scenes — not re-pitched here.)*

> And there's a whole studio behind that. Channels is where you shape character and feel — and turn one script into output for real devices, from e-stim to multi-axis strokers. Phrases and Stanzas let you sculpt section by section. Events let you place specific moments — a whole catalog of named effects. And Polish tunes everything to a particular device. Each one is a full workspace, and each gets its own video. What matters today is that it's all here: approachable enough to start in minutes, deep enough that you'll never outgrow it.

## 05:36 — Ship it  *(Export)*
**On screen:** click Export; highlight the bundle's file list / preview thumbnails.

> When you're happy, Export packages it all into a single bundle — the motion script, the audio, device-ready files for whatever hardware you use, even a beat track and preview images. One click, everything in one place, ready to play.

## 06:06 — Close  *(back to Library)*
**On screen:** return to Library; soft highlight across the full nav.

> That's FunscriptForge: open a video, let it find the gold already inside, shape it in patterns, and ship it to any device. Approachable on the very first day, and as deep as you want to go. We'll dig into each step in the videos to come. Welcome to the forge.

---

### Notes for the editor
- **Pacing anchor:** scene lengths in `bbb_tour.json` (`narrationSec`) are the source of truth — the automation holds each scene for that long while the VO plays.
- **Play the video on cue:** in the Analysis scene, playback starts on "press play" and runs under the ore/gold narration — the synced motion *is* the visual there.
- **The breath beat:** let a half-second land after *"A great script breathes."* (Generate scene) — it's the line the whole pitch hangs on.
- **No jargon on screen-read:** the VO deliberately avoids numbers and metric names (rateCoV, octave, etc.). Keep it that way for this audience; depth shows through the *result*, not the vocabulary.
- **Reliability:** for a repeatable recording, add the `data-tour` hooks listed in `bbb_tour.json` → `recommendedDataTourHooks`. Text/coordinate selectors work but are brittle across layout changes.
