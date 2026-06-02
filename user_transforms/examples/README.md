# Example custom transforms (reference, not shipped)

These recipe files are **not** loaded by the app — the recipe loader scans
`user_transforms/*.json`, and this `examples/` subfolder is deliberately
outside that glob. They live here as **reference material for the future
custom-behavior builder**: worked examples of the JSON recipe schema
(chaining built-in transforms into a named multi-step behavior).

- `example_recipe.json`
  - **Center + Lift** (`example_center_lift`) — recenter → amplitude_scale → smooth.
  - **Tame Frantic** (`example_tame_frantic`) — halve_tempo → performance.

To load these into the catalog for testing, point `load_user_transforms`
at this directory explicitly (`recipes_dir=user_transforms/examples`), or
copy a file up into `user_transforms/`.
