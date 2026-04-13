# Attribution

The code in this directory is extracted from **restim** by diglet48.

- **Original repository**: https://github.com/diglet48/restim
- **License**: MIT (see LICENSE)
- **Version extracted from**: v1.58 (commit aa4aab2)
- **Fork maintained at**: https://github.com/bruceatxolvco/restim

## What was extracted

The 3-phase audio synthesis math — the core signal processing that
converts funscript position data into stereo audio waveforms for
e-stim devices. Specifically:

| File | Origin | Purpose |
| --- | --- | --- |
| `transforms.py` | `stim_math/transforms.py` | Clarke transform matrices |
| `threephase.py` | `stim_math/threephase.py` | 3-phase signal generator + calibration |
| `sine_generator.py` | `stim_math/sine_generator.py` | Carrier phase accumulator |
| `pulse.py` | `stim_math/pulse.py` | Pulse envelope shaping |

## What was NOT extracted

- Qt GUI (~4000 lines)
- Device drivers (FOC-Stim, NeoStim — serial/USB/protobuf)
- Real-time audio streaming (sounddevice callbacks)
- Pattern generators, motion generators, IMU code
- Vibration modulation, A/B testing mode
- Hardware calibration (electrode asymmetry correction)

## Modifications

- Removed all Qt/PySide6 dependencies
- Removed real-time axis interpolation (we pre-interpolate at render time)
- Simplified pulse-based algorithm for batch rendering (no real-time
  parameter changes mid-pulse)
- Added batch rendering wrapper (`forge/audio_synthesis.py`)

## Credit

diglet48's restim is exceptional work. The 3-phase synthesis math,
coordinate transforms, and safety limits represent deep domain expertise
in electrical stimulation signal processing. We extract a small fraction
of the codebase to make audio rendering accessible to users who would
never install restim on their own, while crediting the original work.
