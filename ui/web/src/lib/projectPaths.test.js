import { describe, it, expect } from 'vitest';
import {
  basename,
  projectDirname,
  isRevealablePath,
  ellipsizePath,
} from './projectPaths.js';

describe('basename', () => {
  it('takes the last segment of a Windows path', () => {
    expect(basename('D:\\hovixag935\\hovixag935 - bikinis vs Baylee.funscript'))
      .toBe('hovixag935 - bikinis vs Baylee.funscript');
  });

  it('takes the last segment of a POSIX path', () => {
    expect(basename('/media/scripts/scene.funscript')).toBe('scene.funscript');
  });

  it('handles mixed separators — Tauri hands back both on Windows', () => {
    expect(basename('D:/hovixag935\\scene.funscript')).toBe('scene.funscript');
  });

  it('returns the input when there is no separator', () => {
    expect(basename('scene.funscript')).toBe('scene.funscript');
  });

  it('returns empty string for empty input rather than throwing', () => {
    expect(basename('')).toBe('');
    expect(basename(null)).toBe('');
    expect(basename(undefined)).toBe('');
  });
});

describe('isRevealablePath', () => {
  it('accepts a real path', () => {
    expect(isRevealablePath('D:\\hovixag935\\scene.funscript')).toBe(true);
  });

  it('rejects the synthetic sample project', () => {
    // The bundled sample has no folder on disk; revealing it would open
    // whatever the shell falls back to (the Documents bug, c9015e2).
    expect(isRevealablePath('sample://demo.funscript')).toBe(false);
  });

  it('rejects empty and non-string input', () => {
    expect(isRevealablePath('')).toBe(false);
    expect(isRevealablePath(null)).toBe(false);
    expect(isRevealablePath(undefined)).toBe(false);
    expect(isRevealablePath(42)).toBe(false);
  });
});

describe('projectDirname', () => {
  it('returns the containing folder of a Windows funscript', () => {
    expect(projectDirname({ path: 'D:\\hovixag935\\hovixag935 - bikinis vs Baylee.funscript' }))
      .toBe('D:\\hovixag935');
  });

  it('accepts a bare string as well as a project object', () => {
    expect(projectDirname('D:\\hovixag935\\scene.funscript')).toBe('D:\\hovixag935');
  });

  it('returns the folder for a POSIX path', () => {
    expect(projectDirname('/media/scripts/scene.funscript')).toBe('/media/scripts');
  });

  it('returns undefined for the sample project', () => {
    expect(projectDirname({ path: 'sample://demo.funscript' })).toBeUndefined();
  });

  it('returns undefined when the project has no path', () => {
    expect(projectDirname({})).toBeUndefined();
    expect(projectDirname(null)).toBeUndefined();
  });

  it('returns undefined for a bare filename — there is no folder to show', () => {
    expect(projectDirname('scene.funscript')).toBeUndefined();
  });

  it('returns undefined at a POSIX root rather than an empty string', () => {
    // idx === 0, so slice(0, 0) would render as a blank row.
    expect(projectDirname('/scene.funscript')).toBeUndefined();
  });
});

describe('ellipsizePath', () => {
  it('leaves a short path untouched', () => {
    expect(ellipsizePath('D:\\hovixag935')).toBe('D:\\hovixag935');
  });

  it('keeps the tail when truncating, so the project folder stays visible', () => {
    const long = 'C:\\Users\\bruce\\OneDrive\\Documents\\projects\\archive\\2026\\hovixag935';
    const out = ellipsizePath(long);
    expect(out.length).toBeLessThanOrEqual(56);
    expect(out).toContain('hovixag935');
    expect(out).toContain('…');
  });

  it('keeps the head so the drive is still identifiable', () => {
    const long = 'D:\\a-very-long-intermediate-folder-name-here\\and-another\\scene';
    expect(ellipsizePath(long).startsWith('D:\\a-very')).toBe(true);
  });

  it('returns empty string for empty input', () => {
    expect(ellipsizePath('')).toBe('');
    expect(ellipsizePath(null)).toBe('');
  });
});

describe('a video-only project still has a folder', () => {
  // ★ Dogfood 2026-09-25. A project opened from a video has media but no
  // `.path` — the funscript does not exist until Generate runs. Everything
  // in the Project tab derived the folder from `.path`, so the folder row
  // rendered nothing for exactly the projects where the user most needs to
  // find the folder. The directory was never unknown; it was never asked for.
  const videoOnly = {
    title: "EroticonVI - Wildcat 'Totally Str[AI]ght'.forgeme",
    path: null,
    mediaPath: String.raw`D:\ai\_forge ready\New folder (2)\EroticonVI.forgeme.mp4`,
  };

  it('resolves nothing from the missing funscript path', () => {
    expect(projectDirname(videoOnly)).toBeUndefined();
  });

  it('★ resolves the folder from the media file instead', () => {
    expect(projectDirname(videoOnly.mediaPath))
      .toBe(String.raw`D:\ai\_forge ready\New folder (2)`);
  });

  it('the fallback chain the tab uses lands on a real folder', () => {
    const dirPath = undefined                      // no readdir result
      ?? projectDirname(videoOnly)                 // no funscript
      ?? projectDirname(videoOnly.mediaPath);      // media
    expect(isRevealablePath(dirPath)).toBe(true);
  });

  it('and still shows nothing for a sample project', () => {
    const sample = { path: 'sample://demo', mediaPath: 'sample://demo.mp4' };
    const dirPath = undefined
      ?? projectDirname(sample)
      ?? projectDirname(sample.mediaPath);
    expect(dirPath).toBeUndefined();
    expect(isRevealablePath(dirPath)).toBe(false);
  });
});

