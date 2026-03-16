# Pipeline Gap Analysis

Generated after: DevOps pipeline initial setup (v0.0.10 prep)
Status: manual — automation of this report is a future pipeline stage

---

## Implemented ✅

| Stage | What shipped |
|-------|-------------|
| lint | ruff in test gate + ci.yml |
| test — unit | `python -m unittest discover -s ui/common/tests` |
| test — integration | `python cli.py test` |
| build Windows | PyInstaller + NSIS → `FunscriptForge-vX.Y.Z-win.exe` |
| build macOS | PyInstaller + `.app` zip → `FunscriptForge-vX.Y.Z-macos.zip` |
| build Linux | PyInstaller + tarball → `FunscriptForge-vX.Y.Z-linux.tar.gz` |
| docs | MkDocs Material → GitHub Pages on docs change |
| release | GitHub Release to `funscriptforge-releases` with generated notes |
| dependency scanning | Dependabot weekly (pip + GitHub Actions) |
| secrets template | `.env.example` committed; `.env` gitignored |
| dev guide | `CONTRIBUTING.md` — SSH setup, secrets, release flow diagram, open source credits |

---

## Gaps — known, deferred

### Coverage gate
**Spec says:** fail if coverage < threshold
**Status:** not implemented
**Why deferred:** need to establish a realistic baseline first — running coverage on the current test suite and setting a threshold before we have broad coverage would set an arbitrary bar
**To do:** add `pip install pytest-cov`, run `pytest --cov`, observe baseline, set threshold in pyproject.toml

### Secrets scanning (pre-commit)
**Spec says:** git-secrets / truffleHog / GitHub Advanced Security on every commit
**Status:** not implemented
**Why deferred:** low immediate risk (solo dev, no external contributors yet)
**To do:** add `pre-commit` hook with `detect-secrets` or `truffleHog`; add `.pre-commit-config.yaml`

### macOS — proper .dmg
**Spec says:** `.dmg` drag-to-Applications experience
**Status:** ships `.app` inside a zip — functional but not polished
**Why deferred:** requires `create-dmg` or `hdiutil` — extra step, alpha is fine with zip
**To do:** add `create-dmg` step after PyInstaller on macOS runner

### Linux — AppImage
**Spec says:** AppImage (single file, no install, works across distros)
**Status:** ships `.tar.gz` — functional but requires user to extract
**Why deferred:** AppImage tooling in CI is fiddly; tarball works for alpha
**To do:** investigate `pyinstaller-appimage` or `appimagetool` in Docker

### Auto changelog
**Spec says:** auto-generated from conventional commits
**Status:** using GitHub's `generate_release_notes` (PR/commit based)
**Why deferred:** `generate_release_notes` is good enough for now; conventional-changelog adds complexity
**To do:** add `git-cliff` or `conventional-changelog` step if release notes quality becomes an issue

### Branch protection
**Spec says:** no direct pushes to main, PRs only
**Status:** not enforced (GitHub settings, not code)
**Why deferred:** solo dev; needs to be set up in repo settings
**To do:** Settings → Branches → Add rule → Require PR before merging

### Signed commits
**Spec says:** every commit attributable via GPG/SSH signing
**Status:** not enforced
**Why deferred:** solo dev, low risk
**To do:** `git config commit.gpgsign true` + upload signing key to GitHub

### Container / SaaS build
**Spec says:** Dockerfile → image pushed to ghcr.io (for SaaS tier)
**Status:** not implemented
**Why deferred:** SaaS tier is future; desktop app is the current target
**To do:** add when SaaS tier becomes active

### BizOps notify hook
**Spec says:** notify BizOps pipeline on release (platform-02)
**Status:** BizOps pipeline not yet implemented
**Blocked by:** platform-02

---

## Required before first alpha release

- [ ] `RELEASES_PAT` secret added to repo (Settings → Secrets → New repository secret)
- [ ] Branch protection enabled on `main`
- [ ] First full pipeline run: push a `v0.0.10` tag and verify all three artifacts appear in `funscriptforge-releases`
