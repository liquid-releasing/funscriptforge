# Troubleshooting — Transforms and Phrase Editing

Find your situation below. Each question is written the way you might actually think it —
not the way a manual would phrase it.

If your question isn't here, ask the help assistant at [funscriptforge.com/help](https://funscriptforge.com/help)
and if it turns out to be a common one, it will show up on this page.

---

## I applied a transform but nothing changed

*You might be searching for: "transform not working", "apply transform no effect",
"nothing happened after transform", "transform did nothing"*

**Check that you clicked Accept.** Transforms show a preview — you must click
**Accept** to commit the change. Clicking away or switching phrases without accepting
discards the preview.

**Check that a phrase is selected.** Transforms only apply to the currently open phrase
in the Phrase Editor. Make sure a specific phrase is highlighted/selected before applying.

**Check the transform parameters.** Some transforms (like tempo scaling) have a threshold
before they visibly affect a phrase. A very small adjustment may appear identical to the
original at the chart scale.

---

## The transform preview looks wrong / the result isn't what I expected

*You might be searching for: "transform result wrong", "preview looks bad",
"transform made it worse", "unexpected result"*

Transforms work on the phrase's structure — they are not visual filters applied on top.
Results that look "wrong" are often correct:

- **Amplitude scale** makes the waveform taller or shorter — positions get pushed toward
  100 or toward 0, not stretched evenly
- **Tempo halve** removes alternate strokes — the waveform gets sparser, which is intentional
- **Blend seams** modifies the first and last few actions, not the middle of the phrase

If the result genuinely isn't what you wanted, click **Cancel** (or **✗ Discard**) —
the original phrase is untouched. Try a different transform or different parameters.

---

## I accepted a transform by mistake — how do I undo it?

*You might be searching for: "undo transform", "reverse transform", "go back",
"undo my last action"*

Use **Ctrl+Z** (or **Cmd+Z** on macOS) to undo. FunscriptForge maintains an undo
stack for phrase edits within your session.

If you have already exported and closed the session, you will need to reload the
original funscript file from disk. FunscriptForge never modifies the original file —
it writes output only when you explicitly export.

---

## I can't open the Phrase Editor — clicking a phrase does nothing

*You might be searching for: "can't open phrase editor", "phrase editor not opening",
"clicking phrase does nothing", "stuck on phrase selector"*

Make sure you are clicking a phrase row in the **phrase list** or clicking the colored
phrase box on the **chart** directly. Clicking the waveform itself (not on a phrase box)
does not open the editor.

If nothing responds, try refreshing the page. Your session state is held in memory —
a refresh reloads the app but you will need to load your funscript again.

---

## The Transform Catalog tab is empty

*You might be searching for: "transform catalog empty", "no transforms shown",
"catalog blank", "where are the transforms"*

The Transform Catalog is a library of saved transform configurations — it is empty
until you save one. To build up the catalog:

1. Apply a transform to a phrase in the Phrase Editor
2. Click **Save to catalog** before accepting (or from the catalog tab while the transform is configured)

The catalog is personal and local — it grows as you use the app.

---

## My transforms aren't appearing in the catalog / they disappeared

*You might be searching for: "saved transforms gone", "catalog lost my transforms",
"transforms not saved"*

The catalog is stored in the `output/` folder in your FunscriptForge directory.
If you moved or reinstalled FunscriptForge to a different location, the catalog
file did not follow.

Copy `output/pattern_catalog.json` from the old location to the new one to
restore your saved transforms.

---

## I applied transforms to several phrases — some look wrong and some are fine

*You might be searching for: "some transforms wrong", "inconsistent results",
"only some phrases affected correctly"*

Each phrase has different content — the same transform will produce different results
on a fast energetic phrase vs. a slow ambient one. This is expected.

Apply the transform phrase-by-phrase and review each preview before accepting.
The Pattern Editor tab lets you compare multiple phrases side by side.

---

## My question isn't here

[Ask the help assistant →](https://funscriptforge.com/help)

Type your question the way you'd naturally ask it. If it's a question others are likely to
hit too, it will be added to this page. You're helping the next person by asking.

---

← [Back to: Apply a Transform](../03-improve-your-script/apply-a-transform.md)
