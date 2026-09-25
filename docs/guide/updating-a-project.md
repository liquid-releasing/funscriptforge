# Updating a Project

When FunscriptForge improves how it builds device files, your existing
projects do not change on their own. The funscript and channel files already
on disk were written by whichever version produced them.

This page covers how FunscriptForge tells you an update is available, what the
two kinds of "out of date" mean, and how to update one project or a whole
library.

---

## The prompt

Open a project and, when its device files are out of date, you get this:

> **Your device files are out of date**
>
> Events now last as long as you set them. A flat stretch before an event was
> being discarded when the channel was saved, so players slid gradually into
> the event from wherever the flat stretch began…
>
> **Later** · **Update outputs**

The text is the actual list of what changed since your files were built, not a
version number. If several improvements have landed since, you get all of them.

- **Update outputs** re-renders everything: each device station you stamped in
  Polish, then the `.forge` bundle.
- **Later** dismisses it for this session. Nothing is changed, and the prompt
  returns next time you open the project — the state is read from disk, not
  remembered.

Your authoring is never touched. Chapters, tones, events, phrases and your
edited funscript are the inputs to an update, so an update cannot lose them.

!!! note "Nothing appears when nothing is wrong"
    If your files are current, there is no prompt. A project you have never
    exported does not prompt either — that is a normal state while you are
    still authoring, not a problem to fix.

---

## Two kinds of out of date

| State | What it means | Cause |
| --- | --- | --- |
| **Out of date** | A newer version of FunscriptForge would produce different — better — files than the ones you have. | You updated the app. |
| **Older than your edits** | The files are right for this version, but you changed something after they were written. | You edited a chapter, tone or event and did not re-export. |

Both are fixed by the same update, which is why they share one button.

The second one is easy to create without noticing: set a chapter back to
Untoned, accept it, and your device files still contain the tone until you
update. The funscript you are editing is current; the files your device plays
are not.

---

## Updating from the command line

Useful for a whole library, or when you would rather not open each project.

Check without changing anything:

```bash
python cli.py refresh "D:/my-library" --check
```

This prints one record per project that needs work, each with the reasons in
the same words the prompt uses. Add `--all` to see every project including the
current ones.

Update one project:

```bash
python cli.py refresh "D:/my-library/scene/scene.funscript"
```

Update every project that needs it:

```bash
python cli.py refresh "D:/my-library"
```

The `.forge` bundle is replaced in place, keeping its filename, and inherits
the options that built the previous one — so an update cannot quietly ship
less than it replaced.

---

## Why re-exporting is not always enough

!!! warning "`--export-only` skips the part that usually matters"
    Export is a **packager**, not a generator. Device files you stamped in
    Polish are copied from disk exactly as they are, however old they are.
    Re-exporting a project whose channel files were built by an older version
    produces a brand-new bundle full of old channel files.

    `--export-only` is the fast path for when only the packaging step changed.
    For anything that changed how channels are *generated*, you need the full
    update, which re-stamps each station first. That is what **Update outputs**
    and a plain `cli.py refresh` do.

One thing does come out fresh either way: a device station you never stamped
in Polish is generated at export time using default settings. So adding a new
device to your setup only needs an export — while picking up a generation fix
needs the full update.

---

## Checking it worked

After an update, `--check` reports nothing outstanding:

```bash
python cli.py refresh "D:/my-library/scene/scene.funscript" --check
```

If you want to confirm the files themselves changed, compare stroke depth per
chapter before and after — a fix that restores dynamics shows up as different
depth between chapters, where the old files were uniform.

!!! note "Two updates of the same project are not byte-identical"
    E-stim rotation includes a deliberate random element, so the alpha/beta
    pair differs slightly every time channels are generated. The motion,
    timing, depth and volume are reproducible; only the rotation varies. A file
    that differs after an update is expected, not a sign something went wrong.

---

## Sharing and assembling

A `.forge` bundle records the version that built it. Update before you hand a
bundle to someone else or load it into ForgeAssembler — otherwise the older
output travels with it, and a compiled scene inherits whatever the bundle
carried.
