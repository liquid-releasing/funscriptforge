# Tcode support

T‑Code supports multiple axes, for example:

Axis	Meaning (common use)
L	Left / Stroke axis
R	Right / Stroke axis
A	Auxiliary axis (e.g., twist)
B	Auxiliary axis (e.g., pitch)
V	Vibration

## Generate tcode

Start with

- One .funscript file per axis you want to control.
- Axis mapping — decide which funscript maps to which T‑Code axis letter.
- Merge script — reads all funscripts, normalizes positions, merges by timestamp.

## questions

Do we have this already with stim tab?
Does restim already have this capability?
Can we add it to the output for export?

## OSR 2

The OSR2+ is an upgrade from the OSR2 that adds a bolt-on pitch module, with one additional servo granting the device freedom on the pitch axis.

An OSR2+ can move on the following axis:

- stroke (L0, move up & down)
- roll (R1, tilt left & right)
- pitch (R2, tilt back & forth)

## Multifunplayer

[quote="Yoooi, post:1, topic:23006"]
Axis Description Valid file names L0 Up/Down **`<video name>.funscript`** L1 Forward/Backward **`<video name>.surge.funscript`** L2 Left/Right **`<video name>.sway.funscript`** R0 Twist **`<video name>.twist.funscript`** R1 Roll **`<video name>.roll.funscript`** R2 Pitch **`<video name>.pitch.funscript`**
[/quote]



## References

https://discuss.eroscripts.com/t/guide-what-is-the-osr2-sr6-ssr1-and-how-do-i-get-one/158805