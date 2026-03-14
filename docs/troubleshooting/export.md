# Troubleshooting — Export

Find your situation below. Each question is written the way you might actually think it —
not the way a manual would phrase it.

If your question isn't here, ask the help assistant at [funscriptforge.com/help](https://funscriptforge.com/help)
and if it turns out to be a common one, it will show up on this page.

---

## I can't find the Export tab

*You might be searching for: "where is export", "can't find export",
"Export tab missing", "how do I save my funscript"*

The Export tab is the fifth tab at the top of the app. You need to have a funscript
loaded to see it. If no file is loaded, load your funscript first (Phrase Selector tab).

---

## I clicked Export but nothing happened / no file downloaded

*You might be searching for: "export not working", "export button does nothing",
"file didn't download", "nothing happened when I exported"*

Check your browser's download folder. The file may have been saved there without
a visible prompt, depending on your browser settings.

If you're using Firefox or Safari and downloads are set to ask, check if a download
dialog appeared and was dismissed.

If nothing downloaded at all, try again — and check the browser console (F12 → Console)
for any error messages, then [ask for help](https://funscriptforge.com/help) with
those details.

---

## The exported file has the wrong name

*You might be searching for: "output filename wrong", "exported file name",
"how to rename output"*

By default the output file is named after your original funscript with a suffix
indicating the transforms applied (e.g. `myscript.transformed.funscript`).

You can rename the file after downloading — funscript players use file content,
not filenames, to play scripts.

---

## The exported funscript doesn't play correctly in my device software

*You might be searching for: "exported funscript won't play", "device not responding",
"script doesn't work after export", "output file broken"*

**Verify the file is valid.** Open it in a text editor and check the first few lines —
it should look like:

```json
{"actions": [{"at": 0, "pos": 50}, {"at": 400, "pos": 100}, ...], "version": 1}
```

If the file looks correct, the issue is likely with how your device software loads
funscripts. Check that:

- The file and the video are in the same folder with matching names
  (e.g. `myvideo.mp4` and `myvideo.funscript`)
- Your device software is up to date
- You are loading the *exported* file, not the original

---

## The exported file looks identical to the original

*You might be searching for: "export same as original", "transforms not in output",
"my changes aren't in the exported file"*

Transforms must be **accepted** before they appear in the export. If you previewed
a transform but clicked Cancel or navigated away without clicking Accept, the change
was not committed.

Go back to the Phrase Editor, re-apply the transforms, click **Accept** for each one,
then export again.

---

## I only want to export some phrases, not all of them

*You might be searching for: "export specific phrases", "partial export",
"export selected phrases only"*

The Export tab offers range options. You can export the full script (all phrases,
including untouched ones) or only the phrases that have been modified.

Select the relevant option before clicking Export.

---

## The export completed but the file seems smaller than expected

*You might be searching for: "exported file too small", "file size reduced",
"actions missing in export"*

Some transforms intentionally reduce the number of actions:

- **Tempo halve** removes alternate strokes — fewer actions, shorter file
- **Smooth** may merge closely-spaced actions — file gets smaller

Fewer actions is not necessarily wrong. Open the file in a text editor and check that
the `actions` array starts and ends at the correct timestamps.

---

## My question isn't here

[Ask the help assistant →](https://funscriptforge.com/help)

Type your question the way you'd naturally ask it. If it's a question others are likely to
hit too, it will be added to this page. You're helping the next person by asking.

---

← [Back to: Export and Use](../04-export-and-use/export.md)
