import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ★ Why this exists.
//
// `useMemo` was used in App.jsx without being imported. `vite build` passed —
// an undefined identifier is a RUNTIME ReferenceError, not a compile error —
// and the whole vitest suite passed too, because vitest never renders App.
// The app booted to a white screen with `useMemo is not defined`.
//
// There is no ESLint in this project, so nothing catches an undefined
// identifier anywhere. A full lint setup is the real answer; until then this
// covers the specific class that has bitten twice, costs no dependencies, and
// runs in milliseconds.
//
// It is deliberately narrow: React hooks only, checked against what the file
// imports from 'react'. It cannot catch every undefined name, and it is not
// pretending to.

const REACT_HOOKS = [
  'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useContext',
  'useReducer', 'useLayoutEffect', 'useImperativeHandle', 'useDeferredValue',
  'useTransition', 'useId', 'useSyncExternalStore', 'useDebugValue',
];

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..');

function sourceFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { sourceFiles(full, out); continue; }
    if (!/\.jsx?$/.test(e.name)) continue;
    if (/\.test\.jsx?$/.test(e.name)) continue;
    out.push(full);
  }
  return out;
}

/** Names imported from 'react', whether named, default-namespaced or both. */
function reactImports(src) {
  const named = new Set();
  let namespace = null;
  const re = /import\s+([^;]+?)\s+from\s+['"]react['"]/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const clause = m[1];
    const braces = clause.match(/\{([^}]*)\}/);
    if (braces) {
      for (const part of braces[1].split(',')) {
        const name = part.trim().split(/\s+as\s+/).pop()?.trim();
        if (name) named.add(name);
      }
    }
    const ns = clause.match(/^\s*(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)/);
    if (ns && !clause.trim().startsWith('{')) namespace = ns[1];
  }
  return { named, namespace };
}

describe('every React hook a file calls is imported', () => {
  const files = sourceFiles(SRC);

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    it(rel, () => {
      const src = fs.readFileSync(file, 'utf8');
      const { named, namespace } = reactImports(src);
      const missing = [];
      for (const hook of REACT_HOOKS) {
        // A bare call: `useMemo(` not preceded by `.` (so `React.useMemo`
        // and `foo.useMemo` are someone else's problem).
        const called = new RegExp(`(^|[^.\\w$])${hook}\\s*\\(`).test(src);
        if (!called) continue;
        if (named.has(hook)) continue;
        // A local definition of the same name is fine — custom hooks in
        // hooks/ define their own.
        if (new RegExp(`(function|const|let)\\s+${hook}\\b`).test(src)) continue;
        if (namespace && new RegExp(`${namespace}\\.${hook}\\s*\\(`).test(src)) continue;
        missing.push(hook);
      }
      expect(missing, `${rel} calls ${missing.join(', ')} without importing from 'react'`)
        .toEqual([]);
    });
  }
});
