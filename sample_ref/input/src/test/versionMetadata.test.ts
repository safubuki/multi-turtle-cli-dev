import { describe, expect, it } from 'vitest';
import versionData from '../../version.json';

describe('version metadata', () => {
  it('現在バージョンと前回差分の概要を持つ', () => {
    expect(versionData.version).toBeTruthy();
    expect(versionData.history.previousVersion).toBeTruthy();
    expect(versionData.history.summary.length).toBeGreaterThan(0);
    expect(versionData.history.highlights.length).toBeGreaterThan(0);
  });
});
