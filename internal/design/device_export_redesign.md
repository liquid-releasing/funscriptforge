# Device & Export tab redesign — publisher's assistant

> **Status**: Design only. Not started.
> **Order**: ships after the current export-folder restructure cycle.
> **Captured**: 2026-04-11 from a user-testing conversation.

## The reframe that changes everything

FunscriptForge is **not a gatekeeper**. The user is making a script
they're going to **publish on `discuss.eroscripts.com`** for an audience
they don't know yet, with devices they don't control. The right
question isn't *"is this safe for your one device?"* — it's:

> **"Which devices will this script work well on, and which will struggle?"**

That's information for the **publisher to share with their audience**,
not a blocker that stops the script from existing. The user is the
**author**, not a **player**. The published script will outlive any
one device choice.

This reframe blows up the current "select your device, get clamped"
model and replaces it with "select your authoring constraint, see how
your script fits each output device, ship the ones you want, README
carries the fit info forward."

## Two independent decisions

Today we conflate *limit profile* and *output target* into one
`output_targets` list. They are different things and need different
pickers.

### 1. Performance maximums (Device tab)

The **authoring constraint**. The user picks which device limits they
want their script to fit *during creation*. This drives the
device-aware fix (humanize + clamp).

| Device | Source | Notes |
|---|---|---|
| The Handy v1 | TheHandy.com | 400 pos/s, 120 BPM, firmware ~2024 |
| The Handy v2 | TheHandy.com | placeholder — "v2 specs unverified" |
| OSR2 | community | 500 pos/s, 150 BPM |
| Generic / Intiface | conservative | 300 pos/s, Lovense/Kiiroo Bluetooth fallback |
| Estim — FOC | community | TBD |
| Estim — Stereo | community | TBD — slower than FOC per ongoing community work |

**Multi-select.** Combined limits = most restrictive wins for each
parameter. The Device tab shows which device contributed which limit.

This is the picker that's missing from today's Device tab — the user
has to go to Export to change selection, which is wrong. **Performance
maximums belong on the Device tab** because they're authoring decisions.

### 2. Output devices (Export tab)

The **publishing decision**. Which file sets / folder layouts to ship.
This is what we built into the Export tab in this cycle:

- Mechanical (single checkbox) — handy / OSR / Intiface get one funscript
- Estim — five separate checkboxes (legacy / stereostim / foc3phase /
  foc4phase / neostim)

**Independent of performance maximums.** A user might author against
Handy v2 maximums and ship for Stereostim + FOC3phase + NeoStim because
that's their target audience.

The estim checkboxes are **today metadata-only** — the channel
funscripts are identical across estim devices because audio synthesis
hasn't landed yet. They become load-bearing in the audio PR.

## The fit badges (no greying out!)

Every output device on the Export tab gets a status badge computed from
analyze_violations() against that device's limits **after** the
device-aware fix has been applied.

| Status | Meaning | Badge | Effect |
|---|---|---|---|
| ✅ Works | All actions within this device's limits | green check | none |
| ⚠️ Partial | Some actions exceed limits — clamping will lose fidelity | amber + violation count | none |
| ⛔ Heavy clamping | Most actions exceed limits — script will be significantly altered | red + violation count + suggestion | none |

**All three keep the checkbox enabled.** The user picks what they ship;
the badge informs the choice. **Greying out is forbidden** in this
design — it implies "you can't" and the user is the author.

The badge is followed by a **plain-language explanation** that the
user can act on:

> ⛔ Handy: 3,200 sections exceed 400 pos/s. Device-aware reduced
> violations from 14,709 to 3,200, but the remaining sections are too
> dense to clamp without losing fidelity. Try Handy v2 or OSR2.

This is the *story we need to let users know*, in the user's words. It
explains the math, names the result, and offers a next step.

## README carries fit analysis to the audience

The README we already write to every export folder grows a **per-device
fit section** so the published script carries the analysis forward.
When a player downloads from eroscripts, they read:

```text
Device fit
----------
This script was authored against The Handy v2 maximums (600 pos/s, 150 BPM).

Output devices included in this export:
  ✅ Stereostim — 23,710 actions, all within 350 pos/s, 0 sections clamped
  ✅ FOC 3-phase — 23,710 actions, all within 500 pos/s, 0 sections clamped
  ⚠️ NeoStim — 23,710 actions, 2,400 sections exceed 280 pos/s
                  (10% of script). NeoStim users may want to reduce
                  intensity or skip the most aggressive phrases.
  ⛔ Handy v1 — 12,000 sections exceed 400 pos/s. Handy v1 users
                  should pick a tamer script.
```

This is the highest-leverage part of the redesign. **The information
travels with the file.** The publisher's audience is the next reader,
and they get the context the publisher used to decide.

## The math

The badge per device requires running `analyze_violations(actions,
limits_for_device_X)` once per device. Cost per call: ~50ms on a
23k-action script. Seven devices total = ~350ms when the Export tab
loads. Acceptable, especially with caching.

**Cache invalidation**: hash the funscript actions + device limits.
When the hash changes (user edited tone, phrases, device-aware groove,
etc.), re-run. Otherwise return cached.

## Per-device fix preview (deferred)

Could we *preview* what the script looks like after a fix targeted at
each specific device? Yes, but it's expensive:

- 7 devices × full device-aware pipeline × ~2-5 seconds = 15-35 seconds
  on every Export tab load.
- Not acceptable as the default. Could be lazy-loaded on click.

**Defer this**. The badge + explanation are enough for v1 of this
redesign. Per-device preview is a polish feature for later.

## Override toggle ("I know what I'm doing")

Not needed in this design — we never grey out, so there's nothing to
override. The user can always check any device. The badges *inform*
the choice; they don't *gate* it.

If we ever decide to add a hard gate (e.g., "device incompatible — do
not ship"), we'd add an override toggle then. Not now.

## What this means for the existing code

The current code we just shipped has:

- **Export tab**: two checkbox groups (Mechanical + Estim), single
  flat `output_targets` list. ✅ Reusable as-is.
- **Device tab**: read-only summary of `output_targets`, recomputes
  combined limits. ✅ Reusable as-is for the *display* part.
- **`output_targets` flat list**: ❌ Conflates limits and outputs.

The redesign adds a **second list** to the project file:

```python
{
    "performance_maximums": ["handy_v2", "osr2"],   # ← NEW. Authoring constraint.
    "output_targets":       ["stereostim", "foc3phase", "neostim"],  # ← Existing. Publishing.
}
```

Migration: any project loaded with only `output_targets` set gets
`performance_maximums = output_targets` as a one-time copy on load.
Then the user can split them on next visit to either tab.

## File-by-file changes

| File | Change |
|---|---|
| `forge/project.py` `default_forge` | Add `performance_maximums = ["handy"]` (or v2 once we have it). Keep `output_targets = ["handy", "stereostim"]`. |
| `forge/tabs/device_tab.py` | Add multi-select picker for performance maximums. Remove read-only-summary fallback to `output_targets`. The combined limits table reads from `performance_maximums`. |
| `ui/streamlit/panels/export_panel.py` | Per-device badge next to each checkbox. Computes per-device fit by running `analyze_violations(post_fix_actions, device_limits)`. Adds the explanation under each badge. |
| `ui/streamlit/panels/export_panel.py` `_write_readme` | Add "Device fit" section listing each output device's fit status with the same explanation. |
| `forge/device_specs.py` | Add `analyze_violations_per_device(actions, device_keys)` helper. Returns dict keyed by device. |
| `forge/device_specs.json` | Add `handy_v2`, `legacy`, `stereostim`, `foc3phase`, `foc4phase`, `neostim` entries with placeholder limits + notes flagging them as estimates. |
| `tests/test_device_export_redesign.py` (new) | Tests for the per-device fit math, the badge thresholds, and the README writer's device-fit section. |
| `docs/guide/device.md`, `docs/guide/export.md` | Rewrite to explain the new mental model: maximums = authoring, output devices = publishing. |

## Open design questions

1. **Where do "Performance maximums" appear in the workflow?** The
   Device tab sounds right (it's currently the limits-and-fix tab). But
   should the picker move to a separate "Constraints" tab to make the
   independence from output devices visually clear? Probably no — too
   many tabs already.

2. **Default performance maximum for new projects?** Today we seed
   `output_targets = ["handy", "stereostim"]`. After the redesign, the
   default would be `performance_maximums = ["handy"]`,
   `output_targets = ["handy", "stereostim"]`. Handy v1 (most
   restrictive) is the safest default — anything authored against it
   fits everywhere.

3. **Does the badge update live as the user changes Groove?** Yes,
   ideally. Groove is the only knob the user has to *fix* a too-fast
   script. Badge should re-render when groove changes.

4. **What happens to a script that fits no devices?** Show all-red
   badges. The user sees the problem. They can either crank up the
   device-aware fix (more groove, more clamping) or accept the fit and
   ship anyway. We never block.

5. **Eroscripts integration?** Could we auto-format the README's
   device-fit section in eroscripts-friendly markdown so the publisher
   can copy-paste into a thread? That's a polish feature for v2.

## Why we are writing this *now*

We were about to:
- Spend a session adding code to grey out devices (which the user
  rightly hates)
- Spend another session fighting with the conflated `output_targets`
  list when we add audio
- Ship the export-folder restructure with a half-coherent device model
  that we'd have to redesign anyway

Capturing the reframe now means the next PR after the current cycle
is a focused, well-scoped refactor. The current cycle still ships as
planned; the redesign builds on it cleanly.

## Sequencing

1. **Finish current export-folder restructure cycle** (in progress).
2. **Audio synthesis PR** (per `project_funscriptforge_audio.md`).
3. **Desktop app PR** (per `internal/design/desktop_app.md`).
4. **This redesign** — splits `output_targets` into
   `performance_maximums` + `output_targets`, adds per-device fit
   badges and README sections.

These are independent PRs. Order can shift if priorities change, but
the current cycle has to land first because the device-export redesign
builds on the new folder layout.

## Pro tier — per-device authoring (future, layered on top)

> **Owns its own design at `internal/design/pro_tier.md`** — that doc
> covers Pro's full scope (audio, per-device tuning, funscript generation,
> enchantment). The summary below is the Pro slice that touches the
> device/export model specifically.

Captured 2026-04-11 from the same testing session.

**The free-tier design above** treats the script as a **single canonical
artifact** that gets shipped as-is to multiple output devices. The fit
badges tell the user how well it lands on each device. The user picks
which devices to publish for and ships one set of channel funscripts
that all those devices share.

**The Pro tier inverts this.** A Pro user is an artist spending hours
per script and **wants to make different versions for different device
classes** — slower amplitudes for Handy, faster pulses for FOC, different
prostate emphasis for FOC4phase, different sweep widths for Stereostim.

This is reportedly what Edger does behind the scenes: different
parameters per output device class, tuned for each device's response
characteristics. He then ships the per-device folders as the deliverable.

### What changes in the data model

Today (free tier):

```python
{
    "performance_maximums": ["handy"],
    "output_targets":       ["stereostim", "foc3phase"],
    # One stim_character + stim_sliders applied to ALL output_targets
    "stim_character": "Balanced",
    "stim_sliders":   {"cv_min_dist": 0.30},
}
```

Pro tier:

```python
{
    "performance_maximums": ["handy"],
    "output_targets":       ["stereostim", "foc3phase", "neostim"],
    "stim_per_device": {
        "stereostim": {
            "character": "Balanced",
            "sliders":   {"cv_min_dist": 0.40, "cv_pr_max": 0.65},
            "groove":    0.35,
        },
        "foc3phase": {
            "character": "Reactive",
            "sliders":   {"cv_freq_ramp_ratio": 1.5, "cv_pf_max": 0.95},
            "groove":    0.20,
        },
        "neostim": {
            "character": "Gentle",
            "sliders":   {"cv_min_dist": 0.18},
            "groove":    0.40,
        },
    },
}
```

**The free-tier `stim_character` + `stim_sliders` becomes the default**
that Pro users override per device. A Pro user who hasn't tuned a
specific device falls back to the project-wide character. So Pro is
purely additive.

### What changes in the folder layout

Today (free tier):

```text
{output_folder}/
  {stem}.funscript           ← top-level base
  {stem}.heatmap.png
  estim/                     ← one folder, shared across estim devices
    {stem}.alpha.funscript
    …
```

Pro tier:

```text
{output_folder}/
  {stem}.funscript           ← top-level base
  {stem}.heatmap.png
  estim_stereostim/          ← one folder per device
    {stem}.funscript
    {stem}.alpha.funscript
    {stem}.beta.funscript
    …
  estim_foc3phase/
    {stem}.funscript
    {stem}.alpha.funscript    ← different bytes — tuned for FOC
    …
  estim_neostim/
    …
```

Each per-device folder is the result of an **independent funscript-tools
run** with the device-specific config. The folders **really are different**
in Pro, unlike free tier where they would be identical.

### What changes in the UI

Stim tab (Pro only) gains a per-device tuning section:

```text
┌───────────────────────────────────────────────┐
│  Stim — character & tuning                    │
│                                               │
│  Project-wide default                         │
│    Character: Balanced                        │
│    [sliders…]                                 │
│                                               │
│  Per-device overrides (Pro)                   │
│    ▾ Stereostim     Override on  [character…] │
│    ▾ FOC 3-phase    Override on  [character…] │
│    ▾ FOC 4-phase    Inherit defaults          │
│    ▾ NeoStim        Override on  [character…] │
│                                               │
│  [Preview side-by-side]                       │
└───────────────────────────────────────────────┘
```

The free-tier user sees only the "Project-wide default" section. Pro
users see the override section. Both produce the same data model —
free-tier just doesn't write to `stim_per_device`.

### What changes in the README

The Pro README's "Device fit" section explains that **each device folder
contains a tuned version**, not identical files:

```text
Device fit
----------
This script was authored against The Handy v2 maximums.

Each estim device folder contains a tuned version of the script:

  estim_stereostim/   — Balanced character, 0.40 sweep, 0.35 groove
                        ✅ All actions within Stereostim limits
  estim_foc3phase/    — Reactive character, FOC-tuned for fast response
                        ✅ All actions within FOC limits
  estim_neostim/      — Gentle character, softer feel for NeoStim
                        ⚠️ 200 sections approach NeoStim's 280 pos/s cap

Pick the folder for your device. Each contains the same source media
plus device-specific channel funscripts.
```

The free-tier README explains the *single shared* folder model. The
Pro README explains the *per-device tuned* model. The README writer
detects which mode by looking for `stim_per_device` in the project file.

### What this means for sequencing

The current free-tier work **is correct** and ships first. Pro is a
**later layer** on top. Order:

1. **Now**: free-tier export restructure (one `estim/` folder, current
   cycle, near-complete)
2. **Audio PR**: bundles audio synthesis into the FunscriptForge
   module. Free-tier ships first; Pro can use the same audio module
   per-device once Pro lands.
3. **Desktop app PR**: free-tier in a real desktop app
4. **Device/export redesign PR**: free-tier fit badges and the
   `performance_maximums` split
5. **Pro tier PR**: per-device tuning, per-device folders, per-device
   authoring UI

Pro is genuinely separate work and probably ships **after** all the
free-tier polish lands. The free tier needs to be the best version of
itself before Pro is justified.

### Open Pro questions

1. **Pricing/licensing model**: not designed. Out of scope for this
   doc. Captured separately when we get serious about it.
2. **What signal toggles "Pro mode" in the UI?**: a license key, a
   config flag, a build variant? Not designed.
3. **Per-device groove?**: the example data model above has
   per-device groove. Worth confirming — groove might naturally be a
   project-wide setting since it's about *humanization* not *device
   character*.
4. **Per-device device-aware fix?**: should the device-aware fix run
   per-device too, with each device's actual limits? Probably yes —
   that's the whole point of Pro. The free-tier "single combined
   limits" model becomes "one device-aware pass per device folder."
5. **How does Pro interact with per-device fit badges?**: in Pro,
   every device folder is *guaranteed to fit* its target device
   (because it was tuned for it). So fit badges become "✅ Tuned for
   this device" instead of free-tier's "may exceed."

## What's NOT in this redesign

Documented to make the boundaries clear:

- **Per-device fix preview** (run device-aware fix once per device and
  show results). Deferred — too expensive for default render.
- **Override toggles**. Not needed — we never grey out.
- **Auto-eroscripts post draft**. Possible v2 polish.
- **Linking from Device tab to Export tab and back**. Maybe a small
  "go to Export" button on Device, but discoverability isn't critical
  with the current tab navigation.
- **Per-channel limits for estim devices**. Estim devices have channel-
  specific concerns (e.g. pulse_rise_time has different limits than
  alpha) that we ignore today. Out of scope for this redesign.

## Memory implications

This redesign deserves two memory entries:

1. **Project memory**: "device limits are best-guess from community
   sources, not vendor specs — manufacturer documentation is poor"
2. **Feedback memory**: "user explicitly hates greying out controls
   without explanation — always show the analysis, never block the
   choice, the user is the author not a player"

I'll capture both when this redesign starts as a real PR.
