// Single source of truth for the displayed app version — read from
// package.json so the title bar, status bar, and About dialog all track
// the real version and update automatically on every release cut (the
// cut-forge-release skill bumps package.json). Vite/Rollup resolve the
// JSON import at build time.
import pkg from '../package.json';

export const APP_VERSION = pkg.version;
