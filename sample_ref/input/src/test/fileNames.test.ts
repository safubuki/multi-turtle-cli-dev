import { describe, expect, it } from 'vitest';
import { preserveOriginalFileName, resolveAiNarrationFileName } from '../utils/fileNames';

describe('fileNames', () => {
  it('元のファイル名があればそのまま維持する', () => {
    expect(preserveOriginalFileName('voice.wav', 'narration.wav')).toBe('voice.wav');
  });

  it('空のファイル名だけ fallback を使う', () => {
    expect(preserveOriginalFileName('   ', 'narration.wav')).toBe('narration.wav');
  });

  it('AIナレーション再生成時は既存名を優先する', () => {
    expect(resolveAiNarrationFileName({ currentName: 'original.wav', voiceLabel: 'Aoede' })).toBe('original.wav');
  });

  it('AIナレーション新規生成時だけ既定名を使う', () => {
    expect(resolveAiNarrationFileName({ currentName: '', voiceLabel: 'Aoede' })).toBe('AIナレーション_Aoede.wav');
  });
});
