# stim tab update roadmap

Stim tab needs updating to be responsive.

Not available unless user selects estim in Devices

Put up the blue bar and explain if estim is not selected.

## Stim tab issues

4. Slider labels — show min_label/max_label from presets next to slider
5. Show ALL generated channels (15+ including prostate, e1-e4, pulse_width, pulse_rise_time)
6. Three-column channel layout for visibility
7. Accept should reuse Preview output — hash config, skip re-generation (saves 30-60s)
8. Progress stuck at 17% — honest messaging or indeterminate spinner for prostate bottleneck
9. Old chain files in output — pre-.forge/ projects still have _funscript_*.json at top level
10. Stim 20s to respond to character selection — pre-cache path PNGs

## Preview selection

Provide user selection radio just above preview button:

- Display basic 2d (displays in seconds)
- Display three-phase (displays in minutes) 
- info tip: This selection does not affect the exported output, just the display in the tab

default is three phase

### Display 2d shows original, alpha and beta only

Rows of the original and preview

[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ]

### Display 3 phase

as described in notes. three-column layout makes sense for the channels:

[ Input funscript — full width, vibrant ]

[ Alpha L/R    ] [ Beta U/D     ] [ Pulse freq   ]
[ Frequency    ] [ Volume       ] [ Pulse rise    ]
[ Alpha prost. ] [ Beta prost.  ] [ Vol. prost.   ]

Compact, all visible at once, grouped by function. The input stays full-width on top as the reference. Each row is a logical group: position channels, modulation channels, prostate variants.

## funscript generation test results times

Response for victoriaoaks

| Technique | time | note |
| - | - | - |
| convert to 2d basic | 18seconds | alpha and beta only |
| process to 3p | 2 or 3 minutes | this is what we do i think.  10 files |

## Accept button response

Radio above Accept

- Generate 2d (for 2b, 312)
- Generate 3-phase (for stereo stim, Tingler, ZC95, NeoStim, FOC-Stim)
- Generate all including 4-phase (for Foc-Stim)

### Accept button functionality

Save the funscripts into our temp folder for copying into folders during export. No regeneration for export.

Remember which selection the user made. We will reuse it on export.

### Export behavior

And when we export, we use funscript-tools to generate some of the files. (the 10 documented ones). https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#the-ten-output-files

## References

### User creative decisions

We support the creative decisions: 
- https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#1-algorithm--where-the-sensation-moves

what he thinks users want to change
- https://github.com/edger477/funscript-tools/blob/main/docs/USER_GUIDE.md#key-config-settings

### output best practices

https://github.com/edger477/funscript-tools/blob/main/FUNDAMENTAL_OPERATIONS.md#iv-best-practices