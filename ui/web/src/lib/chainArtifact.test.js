import { describe, it, expect } from 'vitest';
import { chainArtifactFor, stemFromPath, TAB_ARTIFACT } from './chainArtifact.js';

describe('chainArtifactFor', () => {
  it('★ Events writes feel.yml, not events.json', () => {
    // The old footer built `<title>.<tabid>.json`, so Events advertised
    // `<title>.events.json` — a file nothing writes or reads. It sent a real
    // debugging session after a file that has never existed.
    expect(chainArtifactFor('events', 'scene')).toBe('scene.feel.yml');
    expect(chainArtifactFor('events', 'scene')).not.toContain('events.json');
  });

  it('names the real file for the tabs the id-formula got wrong', () => {
    expect(chainArtifactFor('polish', 'scene')).toBe('scene.polish.yml');
    expect(chainArtifactFor('stim', 'scene')).toBe('scene.characters.json');
    expect(chainArtifactFor('generate', 'scene')).toBe('scene.generated.funscript');
  });

  it('keeps the ones the formula happened to get right', () => {
    expect(chainArtifactFor('chapters', 'scene')).toBe('scene.chapters.json');
    expect(chainArtifactFor('phrases', 'scene')).toBe('scene.phrases.json');
  });

  it('stanzas point at chapters.json, where stanzas actually live', () => {
    expect(chainArtifactFor('stanzas', 'scene')).toBe('scene.chapters.json');
  });

  it('★ says nothing rather than inventing a name', () => {
    // Export writes a .forge bundle and Viewer writes nothing. Naming a
    // sidecar for either would be the same class of lie.
    expect(chainArtifactFor('export', 'scene')).toBe(null);
    expect(chainArtifactFor('viewer', 'scene')).toBe(null);
    expect(chainArtifactFor('nonsense', 'scene')).toBe(null);
  });

  it('needs a stem', () => {
    expect(chainArtifactFor('chapters', null)).toBe(null);
    expect(chainArtifactFor('chapters', '')).toBe(null);
  });

  it('every mapped suffix carries a real extension', () => {
    // Guards against a future entry reintroducing a bare tab id.
    for (const [tab, suffix] of Object.entries(TAB_ARTIFACT)) {
      if (suffix === null) continue;
      expect(suffix, `${tab} suffix`).toMatch(/\.(json|yml|funscript)$/);
    }
  });
});

describe('stemFromPath', () => {
  it('takes the basename without its extension', () => {
    expect(stemFromPath('D:/a/b/scene.funscript')).toBe('scene');
    expect(stemFromPath(String.raw`D:\a\b\scene v2.funscript`)).toBe('scene v2');
  });

  it('handles a dotted name', () => {
    expect(stemFromPath('/x/my.scene.v2.funscript')).toBe('my.scene.v2');
  });

  it('is null-safe', () => {
    expect(stemFromPath(null)).toBe(null);
    expect(stemFromPath('')).toBe(null);
  });
});
