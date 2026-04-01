import { describe, expect, it } from 'vitest';
import { SECTION_HELP_CONTENT } from '../constants/sectionHelp';

function getHelpDescription(
  section: keyof typeof SECTION_HELP_CONTENT,
  title: string,
): string {
  const item = SECTION_HELP_CONTENT[section].items.find((entry) => entry.title === title);
  if (!item) {
    throw new Error(`Help item not found: ${section} / ${title}`);
  }
  return item.description;
}

describe('sectionHelp support messaging', () => {
  it('app help は iPhone Safari を非対応ではなく検証中として案内する', () => {
    const description = getHelpDescription('app', '動作確認機種');

    expect(description).toContain('検証中');
    expect(description).not.toContain('非対応');
  });

  it('保存系ヘルプは保存ダイアログと標準ダウンロードの両方を案内する', () => {
    const narrationDescription = getHelpDescription('narration', '並び替え・編集・削除・保存');
    const previewDescription = getHelpDescription('preview', '作成後のダウンロード');

    expect(narrationDescription).toContain('保存先ダイアログ');
    expect(narrationDescription).toContain('標準ダウンロード');
    expect(previewDescription).toContain('保存先ダイアログ');
    expect(previewDescription).toContain('標準ダウンロード');
  });
});
