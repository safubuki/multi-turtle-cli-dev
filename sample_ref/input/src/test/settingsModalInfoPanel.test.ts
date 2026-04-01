import { describe, expect, it } from 'vitest';
import { getNextInfoPanel } from '../components/modals/SettingsModal';

describe('getNextInfoPanel', () => {
  it('ヘルプパネルは通常どおりトグルできる', () => {
    expect(getNextInfoPanel(null, 'help', true)).toBe('help');
    expect(getNextInfoPanel('help', 'help', true)).toBeNull();
  });

  it('履歴がある場合は履歴パネルをトグルできる', () => {
    expect(getNextInfoPanel(null, 'history', true)).toBe('history');
    expect(getNextInfoPanel('history', 'history', true)).toBeNull();
  });

  it('履歴が無い場合は履歴パネルへ遷移しない', () => {
    expect(getNextInfoPanel(null, 'history', false)).toBeNull();
    expect(getNextInfoPanel('help', 'history', false)).toBe('help');
  });
});
