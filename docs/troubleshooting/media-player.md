# Troubleshooting — Media Player

Find your situation below. Each question is written the way you might actually think it —
not the way a manual would phrase it.

If your question isn't here, ask the help assistant at [funscriptforge.com/help](https://funscriptforge.com/help)
and if it turns out to be a common one, it will show up on this page.

---

## The media player isn't showing up

*You might be searching for: "no media player", "where is the video player",
"can't find media player", "player missing"*

The media player appears in the **Phrase Editor** tab, not the Phrase Selector.

1. Load your funscript (Phrase Selector tab)
2. Click any phrase in the chart or phrase list — this opens the Phrase Editor
3. The media player appears in the right column of the Phrase Editor

If you don't see it there, click **📹 Show player** — it may be hidden.

---

## I don't have a video file — do I need one?

*You might be searching for: "media player required", "do I need video",
"can I use FunscriptForge without video"*

No. The media player is optional. FunscriptForge works entirely from the `.funscript`
file — you can assess, edit, transform, and export without any video or audio.

The player is there if you want to see and hear the context while editing a phrase.
It is not required.

---

## The video won't load — it just shows an error

*You might be searching for: "video won't load", "media error", "can't play video",
"unsupported format", "video not playing"*

**Check the file format.** FunscriptForge supports: `.mp4`, `.mkv`, `.mov`, `.m4v`, `.webm`,
`.mp3`, `.m4a`, `.aac`, `.wav`, `.ogg`, `.flac`.

If your file is in a different format, use [HandBrake](https://handbrake.fr) (free) to
convert it to `.mp4` first.

**Check the file path.** The path must be the full absolute path to the file on your disk.
See [how to copy a file path](./loading-a-script.md#the-file-wont-load--it-says-file-not-found)
for platform-specific instructions.

**Check the file size.** Files over 500 MB may not load in browser-based mode. Use
the local desktop app (not a remote server) for large files.

---

## The video plays but it's out of sync with the waveform

*You might be searching for: "video out of sync", "audio timing wrong",
"waveform doesn't match video", "sync issue"*

FunscriptForge does not shift or adjust timing — it plays exactly what is in the
funscript and the media file. If they are out of sync, the funscript itself has an
offset from the video.

This is a property of the original funscript, not a bug in FunscriptForge.
Most funscript players have a sync offset control. FunscriptForge does not apply
one because it is working with the raw script structure, not playback timing.

---

## The video loads but there is no sound

*You might be searching for: "no audio", "video plays silently", "no sound",
"muted video"*

Check your system volume and browser tab mute. Click the speaker icon in your
browser tab to unmute if needed.

If the file is a video with no audio track (some `.mkv` and `.webm` files), there
is nothing to play. Try a version of the file with audio.

---

## The video player controls are missing or cut off

*You might be searching for: "player controls missing", "can't see play button",
"controls cut off", "player too small"*

Click **📹 Show player** / **Hide player** to toggle the player panel.
Widening your browser window or zooming out (Ctrl/Cmd −) will give the player
more room.

The player is sized proportionally to the Phrase Editor column layout. On small
screens it may be narrow — this is expected.

---

## The phrase plays but shows the wrong section of the video

*You might be searching for: "wrong part of video", "plays from wrong time",
"video not at right position"*

The player seeks to the phrase start time automatically. If the video appears to
start from a different point, the funscript timestamps and the video file may have
different reference points (see [sync issue](#the-video-plays-but-its-out-of-sync-with-the-waveform) above).

---

## My question isn't here

[Ask the help assistant →](https://funscriptforge.com/help)

Type your question the way you'd naturally ask it. If it's a question others are likely to
hit too, it will be added to this page. You're helping the next person by asking.

---

← [Back to: Phrase Editor](../03-improve-your-script/apply-a-transform.md)
