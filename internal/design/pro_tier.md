# FunscriptForge Pro tier — design

> **Status**: Design only. Not started.
> **Captured**: 2026-04-11 from a user-testing conversation.
> **Order**: After all free-tier polish lands. Audio + desktop app + device redesign all ship in free tier first.

## What Pro is for

The free tier of FunscriptForge serves the **publisher** — the user who
loads a 1D funscript, shapes it, and ships it to
`discuss.eroscripts.com` for an unknown audience to play on their own
devices. The free tier's job is *informed publishing* with one canonical
script and multi-device fit analysis.

The Pro tier serves the **artist** — the user who is investing real
hours per script and wants the **tools edger has but doesn't share**:

- **Per-device tuning** — different stim parameters per output device
  class so each device gets its best feel
- **Audio output** — the actual audio files, not just the funscripts.
  No restim required at playback time.
- **Funscript generation** — making a 1D funscript from scratch (video
  analysis, beat detection, source-material-driven generation), not
  just transforming an existing one
- **Enchantment** — the punctuation-events layer that adds taps, beats,
  breaks, and finales on top of phrases

These are the features that move FunscriptForge from "polished editor"
to "studio."

## The four Pro features

### 1. Audio output

> *Owns its own design at `memory/project_funscriptforge_audio.md`.*

The current audio plan considers three integration paths (shell out to
restim CLI / extract synthesis into a FunscriptForge module / defer).
Path B (extract synthesis) is the right choice for Pro because:

- It's a **shippable artifact**, not a workflow that depends on the user
  installing restim themselves
- It's **bundleable** into the desktop app
- It's **stable enough** that we can make per-device promises about it
- It means the user **never has to learn restim**

The user has been clear: *"My personal goal is to get the two audio
files."* This is the highest-leverage Pro feature because it solves the
single biggest UX gap in the estim ecosystem.

**What ships**: device audio + prostate audio for each estim device
class the user selected at export time. Each per-device folder gets its
own audio file pair, generated from that folder's tuned channel funscripts.

**Open question**: Does free tier get *any* audio? Two options:

- **(a) Pro-only audio.** Cleanest monetization story. Free tier ships
  channel funscripts; users who want audio install restim themselves
  or pay.
- **(b) Free tier ships one audio file** (e.g., stereostim only) and
  Pro unlocks the others. Lets free users hear what FunscriptForge can
  do without paying.

I lean **(b)**. The "wow, I clicked Export and it just made me an audio
file" moment is the strongest possible top-of-funnel for Pro.
Restricting it entirely behind a paywall means free users never feel
the value proposition.

### 2. Per-device tuning (was the original Pro idea)

The artist creates *different versions* of the script for different
device classes. Detail is in
`internal/design/device_export_redesign.md` under "Pro tier — per-device
authoring." Summary:

- **Stim tab gains per-device override panel** (Pro only)
- **Output folders are actually different** between devices (each is
  its own funscript-tools run with a tuned config)
- **README explains per-device tuning** so audience knows what's in
  each folder

This is what edger reportedly does behind the scenes — different
parameters per output device, then ships per-device folders. We make
that artist workflow explicit and tooled.

### 3. Funscript generation (NEW — was previously out of scope)

Generating a 1D funscript **from scratch**, not transforming an
existing one. Sources:

- **Video analysis** — detect motion in a video file and generate
  matching funscript actions. The hardest source.
- **Audio/beat detection** — detect beats in an audio file (the existing
  `forge.beats` module already does this for beat-aware transforms,
  but it doesn't *generate* a script — it informs transforms on an
  existing script).
- **Source-material-driven** — feed a tempo map, a tag list, or a
  natural-language scene description and generate a coarse script
  the artist then refines.

**Open question**: which source ships first? Audio-driven beat
generation is the lowest-effort because the audio analysis already
exists. Video-driven is the holy grail but is its own multi-month
project. Source-material-driven (LLM-assisted) is the most novel but
the least proven.

**Recommendation**: ship **audio-driven beat generation first** as a
"convert this song into a baseline funscript I can shape" feature.
Builds on existing `forge.beats` infrastructure. Two-phase shipping:

1. **Phase 1**: feed an audio file → get a 1D funscript with one
   action per beat at full amplitude. The artist then runs it
   through Tone/Phrases/etc. to shape it.
2. **Phase 2**: smarter generation that varies amplitude/phrase length
   based on energy curves, beat strength, frequency-band activity.

Video-driven generation is captured here but **deferred to later
versions**. It needs computer vision libraries (likely OpenCV +
custom motion-tracking heuristics or a small ML model), GPU
compute, and a meaningful user-research effort to figure out what
"good" looks like for video → funscript.

### 4. Enchantment (the events tab)

> *Owns its own design at `internal/ARCHITECTURE_events.md`.*

Adds **punctuation events** on top of phrases — taps, beats, breaks,
finales. Today phrases shape the *body* of the script; enchantments
shape the *moments* between and within phrases. They're the difference
between a script that flows and a script that *moves you*.

The architecture doc exists. The tab isn't built. The work has been
deferred multiple times because phrases and the export pipeline have
been higher priority. Putting it in Pro:

- **Justifies the effort** — enchantment is a real implementation
  project, not a polish item
- **Differentiates Pro** — free tier has phrases (shape); Pro has
  enchantments (shape + punctuation)
- **Aligns with the artist persona** — the user investing hours per
  script wants this layer; the casual publisher doesn't need it

**Open question**: Does the **enchantment editor UI** also gate behind
Pro, or does free tier get the editor with a runtime gate that disables
the *export* of enchanted scripts? The latter is friendlier (free users
can play with enchantments and see what they're missing) but harder to
implement.

**Recommendation**: enchantment editor is Pro-gated entirely. No
half-measures. The architecture doc already treats enchantment as a
distinct subsystem with its own data model — clean Pro/free split.

## How the four features relate

All four Pro features are **independent** but **synergistic**:

| Feature | Standalone value | Synergy with others |
|---|---|---|
| Audio output | Highest. The thing nobody else makes easy. | Per-device tuning makes per-device audio meaningfully different. |
| Per-device tuning | Medium on its own. | Becomes load-bearing once audio ships per-device. |
| Funscript generation | Highest for new users. | Generated scripts feed straight into the existing free-tier shape pipeline. |
| Enchantment | High for artists. | Multiplies with per-device tuning — different enchantments per device. |

The lock-step is: **audio + per-device tuning** form a coherent first
Pro release, because together they deliver "I clicked Export and got
five tuned audio files, one per device, each with its own feel."
Funscript generation and enchantment can ship later as independent Pro
upgrades.

## Sequencing — when does Pro happen?

Free-tier work has to land first. The order I'd recommend:

1. **Now**: free-tier export folder restructure (in progress)
2. **Audio synthesis PR** (ships to free tier? or held for Pro?
   See open question above. My recommendation: free tier gets
   stereostim audio, Pro unlocks the rest)
3. **Desktop app PR** (free tier becomes a real app)
4. **Device/export redesign PR** (per-device fit badges, README
   carries fit info, splits `output_targets` from `performance_maximums`)
5. **Pro tier scoping decision**: pricing, licensing model, gating
   mechanism. Out of scope for this doc — captured separately.
6. **Pro v1 PR**: per-device tuning + remaining audio device classes.
   First paying feature.
7. **Pro v2 PR**: enchantment editor + enchantment-aware export
8. **Pro v3 PR**: funscript generation (audio-driven first, video-driven
   much later)

## Pricing/licensing — out of scope for this doc

Real questions when we get there:

- One-time purchase or subscription?
- Tied to a license key file? Online activation? Pure honor system
  with a build flag?
- Open-source the free tier, source-available the Pro tier?
  Closed-source both? Source-available with a paid commercial license?
- Distribution: through `funscriptforge-releases` GitHub or a real
  storefront? Stripe + license-key-by-email is the lightest path.
- Refund policy. Trial period. Educational discount.

These need their own conversation. Capture them when we're closer to
shipping Pro.

## What free tier remains

Important to be clear about what *stays* free, because the value
proposition for free has to remain strong enough that people enter the
funnel:

- **Loading + visualization** — funscript chart, heatmap PNG, stats
- **Tone tab** — full tone analysis and shaping
- **Phrases tab** — full phrase detection and editing
- **Patterns tab** — full pattern editor
- **Catalogs tab** — full catalog browsing
- **Stim tab (basic)** — single character preset, applied uniformly
- **Export** — channel funscripts, mechanical/ + estim/ folders, README,
  forgetmpl
- **Device-aware fix** — humanize + clamp + groove
- **Multi-device fit analysis** — the badges and the "ship anyway with
  context" model
- **One audio file** (stereostim, recommendation) — the hook

What free tier **doesn't** get:

- ❌ Per-device stim tuning (Pro 1)
- ❌ Audio for non-stereostim devices (Pro 1)
- ❌ Enchantment editor (Pro 2)
- ❌ Funscript generation (Pro 3)
- ❌ Per-device output folders (because there's no per-device tuning,
  the folders would be identical anyway — Pro 1)

## Why we're writing this *now*

The user surfaced "we have a Pro version" mid-conversation while we
were planning the device/export redesign and the audio PR. Capturing
the Pro scope now means:

- The audio PR design knows whether it's targeting free or Pro
- The device/export redesign knows where its Pro layer lives
- We don't accidentally ship a free tier that's so feature-rich there's
  no Pro upgrade left
- We don't accidentally ship a Pro tier that depends on free-tier
  refactors that haven't happened yet

## Open questions

Cataloged here so they don't get lost:

1. **Does free tier get any audio at all?** My pick: yes, stereostim
   only. (See section 1.)
2. **Which funscript generation source ships first?** My pick:
   audio-driven beat generation. (See section 3.)
3. **Is enchantment editor Pro-only or runtime-gated?** My pick:
   Pro-only entirely. (See section 4.)
4. **Pricing model.** Out of scope for this doc.
5. **Code distribution model** (open source / source-available /
   closed). Out of scope.
6. **What happens to existing free users when Pro ships?** Grandfather
   nothing? Honor whatever they had at install time? Most permissive
   answer is "free tier never loses features — Pro is purely additive."
   Most monetization-friendly is "some features migrate to Pro, give
   existing users a 90-day grace period." I'd lean permissive.

## References

- Audio plan: `memory/project_funscriptforge_audio.md`
- Device/export redesign: `internal/design/device_export_redesign.md`
- Desktop app design: `internal/design/desktop_app.md`
- Enchantment architecture: `internal/ARCHITECTURE_events.md`
- Free tier export restructure: `internal/tab_updates/export_tab_update.md`
