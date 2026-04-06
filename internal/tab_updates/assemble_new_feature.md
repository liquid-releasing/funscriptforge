# Assemble tab

So now we have video1 done. video2 done. video3 done. And we have a bunch of funscripts.

Time to combine them into a single video.

Built on C:\Users\bruce\Projects\videoedit

## Video composer

UI that build the video edit json.

Initial feature, combine a list of videos one after another. 

### Features

- Metadata: title, stars, etc
- Markers: name of the next video
- the order of clips
- per-clip trim timing (cut titles off if wanted. expressed in time from start of video in HH:MM.SS.xxx
and end of video)
- audio fade timing (ramp up and ramp out.)
- output path

To be later

- gaps
- titles

## Video edit json

Use video edit json to import hand written json for all the features in videoedit.

## Apply

Apply does the 

`apply` button renders the combined video, audio files (combined mp3), and funscript files.