# Migration housekeeping

## Tags v0.0.8 / v0.0.9 / v0.0.10 — resolved 2026-04-29: deleted

Initial premise (push to origin) was wrong. Investigation showed:

- These tags pointed at commits with a **different root commit** than current `main`
  (`28a5d52` vs `db067ce`) — completely disjoint histories. v0.0.10 was 189
  commits long with no merge-base against main.
- Origin's tag sequence intentionally **skips** from v0.0.7 → v0.0.11 — the gap
  is the migration boundary; main was rebuilt fresh during migration.
- The features described in the tag subjects (Phrase Editor, Funnel transform,
  Plugin security with JSON schema + Python plugin gate + validate-plugins CLI,
  SECURITY.md, Windows installer) were re-implemented in current main under
  fresh commits.
- Pushing would have uploaded 189 disconnected commits as dangling tag refs and
  polluted the release-timeline narrative on GitHub.

Action taken: `git tag -d v0.0.8 v0.0.9 v0.0.10`. Local tag list now mirrors origin.

## Strategic docs not in any git repo

`c:\Users\bruce\Projects\_lqr\.funscriptforge\` is a sibling-but-hidden folder containing six strategic documents that are NOT tracked anywhere:

- [ ] `backlog-internal.md`
- [ ] `cost-estimates.md`
- [ ] `deployment-architecture.md`
- [ ] `marketing-plan-internal.md`
- [ ] `patent-briefing.md`
- [ ] `vision-agentic.md`

If this disk dies, these are lost. Decide on a home:

- (a) commit to a private path inside this repo (the existing `internal/` pattern is already gitignored)
- (b) move to a separate private repo (e.g. `liquid-releasing/funscriptforge-internal`)
- (c) back up off-machine only (encrypted cloud / external drive)

Delete this file once all sections are done.
