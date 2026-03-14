# Media Player

Load an audio or video file alongside your funscript to hear or see the content while you edit. The player restricts playback to the current phrase — so you are always listening to exactly what you are changing.

---

## Loading media

In the sidebar, find the **Media file** input below the funscript file input.

Paste the full path to your audio or video file. Supported formats:

| Type | Formats |
| --- | --- |
| Audio | MP3, M4A, WAV, OGG |
| Video | MP4, MKV, MOV, WEBM |

FunscriptForge also attempts to auto-detect media by looking for a file with the same base name as your funscript in the same folder. If your funscript is `myvideo.funscript` and `myvideo.mp4` is next to it, it loads automatically.

<!-- SCREENSHOT: Sidebar with the media file input populated. A clear button (✕) is visible next to the path. Caption: "Paste the media file path in the sidebar. FunscriptForge also auto-detects files with matching names." -->

---

## Phrase-locked playback

Once media is loaded and you open a phrase in the Phrase Editor, a player column appears to the right of the charts.

The player plays only within the current phrase boundaries — it loops from the phrase start to the phrase end. This keeps your attention focused on the section you are editing rather than the whole file.

<!-- SCREENSHOT: Phrase Editor with media player column visible. Player shows a waveform for audio or a video frame. The phrase boundaries are visible as the start/end points. Caption: "The player loops within the current phrase. You hear or see exactly what you are editing." -->

---

## Layout toggle

The player column takes up 1/4 of the Phrase Editor width. If you need more space for the charts, click **📹 Hide player** above the charts. The charts expand to 3/4 width. Click again to restore.

---

## Setting a split point with media

While the media player is open, you can click **📌** (pin) at any point during playback to drop a phrase split boundary at the current timestamp. This is the fastest way to split a phrase at a specific beat or scene change — play the content, hit pin when you hear it, and the split appears on the chart.

See [Phrase Editor — Splitting a phrase →](phrase-editor.md#splitting-a-phrase) for details on working with splits.

---

## File size limits

| Mode | Limit |
| --- | --- |
| Local (desktop app) | No limit — file is streamed from disk |
| Web mode | 500 MB |

For local use there is no cap. If you are running FunscriptForge in web mode (hosted) and your media file is larger than 500 MB, the player will not load it.

---

## Troubleshooting

**Player doesn't appear after loading media**
Check that the file path is correct and the file format is supported. See [Troubleshoot the media player →](../troubleshooting/media-player.md).

**Video loads but audio is silent**
Check your browser's audio permissions. Some browsers mute autoplay by default — click the audio/video element to unmute, or check your browser's site permissions.

**Playback is out of sync**
The player uses the funscript timestamps directly. If the content and funscript are misaligned, use the [Nudge transform](transforms.md#nudge) to shift the phrase forward or backward to match.

---

## Related

- [Phrase Editor →](phrase-editor.md) — editing context for the player
- [Nudge →](transforms.md#nudge) — shift a phrase in time to fix sync
- [Troubleshoot media player →](../troubleshooting/media-player.md)
