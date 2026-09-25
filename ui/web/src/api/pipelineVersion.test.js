import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTPUT_PIPELINE_VERSION } from './forge.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PY = path.resolve(here, '../../../../forge/pipeline_version.py');

describe('OUTPUT_PIPELINE_VERSION mirror', () => {
  // A mirrored constant is only safe if it cannot silently diverge. The
  // analyzer's mirror had no such guard; this one reads the Python source so
  // a bump on one side fails the suite rather than shipping a UI that names
  // the wrong version.
  it('matches forge/pipeline_version.py', () => {
    const src = fs.readFileSync(PY, 'utf8');
    const m = src.match(/^OUTPUT_PIPELINE_VERSION\s*=\s*["']([^"']+)["']/m);
    expect(m, 'OUTPUT_PIPELINE_VERSION not found in pipeline_version.py').toBeTruthy();
    expect(OUTPUT_PIPELINE_VERSION).toBe(m[1]);
  });

  it('is a plain integer string, so === comparison is safe on both sides', () => {
    expect(typeof OUTPUT_PIPELINE_VERSION).toBe('string');
    expect(OUTPUT_PIPELINE_VERSION).toMatch(/^\d+$/);
  });
});
