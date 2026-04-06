# Export tab

Export tab selectors for exporting

- copy media
- device selection
  - tcode
  - funnscript for Handy, OSR, Intiface
  - list for estim (shown in a following section)
- cli script (bash) to reproduce this workflow (for rinse and repeat)
- sound files for estim
- enchantment yml

## CLI Script

Bash (powershell) script that can be called from command line to reproduce this exact settings. 

Or can this be a config json file we pass to a one or more commands?

## Copy media selector

Add checkbox "Copy media to output directory" with info, copy one copy. If checked and if not already named we need to add the input bar. Or do we have them put it in on project tab?

## Devices for export

User selects one or more devices for export.

## Generate TCode

For those devices that are not estim, let's generate TCode.

- OSR

What others support tcode? Handy? Intaface?

For Possible code sample for Funscript to Timed T-code see tcodenewfeature.md. code should output timing data too.

## Handy, OSR, Intiface

Show the same items selected as on the devices tab.

On export, we put the single funscript into its own folder.

Is there a way to build out multi-axis from what we know already? From what I can tell, all of the fmulti-axis requires video. Unless we want to do random like funscript.io ?

## supported estim devices

User can select one or more of these

1. Audio-based three phase.

- 1a, Continuous (for legacy 2b and 312). Low power efficiency.
- 1b. Pulse based for (stereo stim, such as Tingler, ZC???) <== default

2. FOC-Stim (for three phase and experimental four phase)

- 2a. Three phase
- 2b. Four phase

3. NeoStim

- 3a. Three phase

## Funscript export

AFAIK, each output uses the same set of funscript files. So the funscripts should probably be the same regardless of which device you want.

we are either

- copying the results from the stim tab to individual folders (these were created by funscript-tools)
- generating 2d funscripts from restim

### Generate 2d scripts

restim can convert 1D funscript files (typical one dimensional funscript files, e.g. found on Milovana or Eroscripts ) to 2D (2 axes of freedom) funscript files. You get funscript alpha and beta files. 

This is FunscriptForge minimum output.

### who gets what

2d gets

```
  funscript
  alpha
  beta
```

3p shows the following as png:

```text
  funscript
  alpha
  beta
  frequency
  pulse_frequency
  pulse_rise_time
  pulse_width
  volume
  alpha-prostate
  beta-prostate
  volume-prostate
```

4p gets everything

### Folders

<original_funscript_name>.<output_name>

| output_name | funscript | sound |
| - | - |
| legacy | 2d | continuous sound|
| stereostim | 3phase | pulse sound|
| foc3phase | 3phase | foc-stim 3 phase sound|
| foc4phase | all | foc-stim sound|
| neostim |3phase | neostim|
| tcode | tcode| no sound |
| handy | funscript only | no sound|
| osr | funscript only | no sound|
| Intiface | funscript only |no sound|

### Heatmap generation

Let's save heatmap as PNG file for each funscript file.

## Sound generation

Generate both device audio and prostate audio if the files are availab.

### Create audio file

This is how you do it using the UI. The code is probably easier. 

Should we use the CLI?

load video player with video. video not actually needed except as a name to select funscripts.

All funscripts have the same funscipt base name. if it can read the files, picks which ones it needs for the use case. Noone knows why you have to have video loaded, but you do.

(offset to start audio after video. not all video or devices or something syncs well)

select sampling rate. default is 44100

Generate Mp3

### Restim supported devices:

1. Audio-based three phase. 

- 1a. Continuous (for legacy 2b and 312). Low power efficiency.
- 1b. Pulse based for (stereo stim, such as Tingler, ZC???) <== 

2. FOC-Stim (for three phase and experimental four phase)

- 2a. Three phase
- 2b. Four phase

3. NeoStim

- 3a. Three phase

## TODO

Update .\internal\diagrams.md