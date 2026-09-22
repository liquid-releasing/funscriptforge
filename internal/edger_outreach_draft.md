# Edger outreach — draft email

**Status:** draft for review. Fill in your name; optionally reconcile the
About-box wording (see note at bottom) before sending.
**Context:** see memory `project_edger_licensing` — release is gated on his
permission; the clean-room is the fallback; lead with giving, then permission,
then collaboration.

---

## Email

**Subject:** funscript-tools — a thank-you, features to contribute back, and a question

Hi Edger,

I'm [your name], the developer behind FunscriptForge. First — thank you.
funscript-tools has been foundational to what I'm building: it powers
FunscriptForge's e-stim (Stim channel) generation, and your event and
character system has shaped how I think about the whole problem.

I want to be upfront and do right by you, so this is three short parts:
something to give, something to ask, and an idea.

**To give** — we've already contributed the CLI adapter to funscript-tools,
and that's the spirit I'd like to continue. I've also built an eTransforms
system on top of it — contextual sliders, channel prioritization, and a
reworked Creative panel — and I'd happily contribute that upstream if it's
useful to you. There's a fixture-based integration test suite and docs too.
As FunscriptForge grows I'll keep sending improvements back rather than
hoarding them in a fork — just tell me what you'd want.

**To ask** — FunscriptForge bundles funscript-tools in its releases to drive
the e-stim generation, and I credit you in the About box. Before I release it
publicly I want your blessing and to get the licensing right:

1. What license is funscript-tools under? (I couldn't find a LICENSE file.)
   If you're open to it, may I have your permission to bundle and redistribute
   it — including in a commercial release — keeping your code clearly under
   your name and your license?
2. The same for your event-definition catalog (`edger_event_definitions.yml`),
   which I vendor.

If you'd prefer, I'm glad to keep your code as a separately-licensed library
alongside FunscriptForge (the way ffmpeg is bundled) — fully attributed,
never relicensed into my MIT source.

**An idea** — I also noticed you've added a Funscript Generator of your own,
so we're clearly circling similar territory. That's exactly why I'd rather
align than diverge: your events and characters are the shared vocabulary I've
been building FunscriptForge around, and a common standard would serve both
our users better than two incompatible dialects. If that's interesting, I'd
love to talk.

No pressure on any of it — I'd just rather build alongside you than around
you. Email or a call, whatever's easiest.

Thanks again for funscript-tools.

[your name]
FunscriptForge

---

## Before sending — checklist

- [ ] Drop in your **name / signature**.
- [ ] **About-box reconciliation:** `forge/about.py` currently credits "the
      eTransform algorithms" to Edger. Since the transforms system is yours,
      consider rewording so your About and this email tell the same story
      (e.g. credit his *event/stim* foundation, and claim the eTransforms
      *system* as yours).
- [ ] Optional: trim to a 3-paragraph short version if this feels long for a
      first contact (I can produce that on request).
- [ ] Decide channel (his GitHub / the contact method you found).

## What we actually have to offer (accurate, verified)

- **CLI adapter** (`cli.py`/DESIGN.md) — *already contributed.*
- **eTransforms system** (`c8ec859`) — yours; offered above.
- **Integration tests + fixtures** (`7f28758`, `5de14cb`), docs/architecture/MkDocs.
- Review-tab / Creative-panel work.
- ⚠️ The dark-theme work (`5875d27`/`3e2df4f`) is **Edger's own** — not ours to offer.
- Upstream is at **v2.4.4**; he added his own **Funscript Generator (v2.4.0)** — acknowledged in the "idea" section.
