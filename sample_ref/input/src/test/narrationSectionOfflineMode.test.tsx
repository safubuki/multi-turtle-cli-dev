import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import NarrationSection from '../components/sections/NarrationSection';
import type { NarrationClip } from '../types';

const createNarrationClip = (overrides: Partial<NarrationClip> = {}): NarrationClip => {
  const duration = overrides.duration ?? 12;
  const trimStart = overrides.trimStart ?? 0;
  const trimEnd = overrides.trimEnd ?? duration;

  return {
    id: overrides.id ?? 'narration-1',
    sourceType: overrides.sourceType ?? 'file',
    file: overrides.file ?? new File([''], 'narration.wav', { type: 'audio/wav' }),
    url: overrides.url ?? 'blob:narration',
    startTime: overrides.startTime ?? 0,
    volume: overrides.volume ?? 1,
    isMuted: overrides.isMuted ?? false,
    trimStart,
    trimEnd,
    duration,
    isAiEditable: overrides.isAiEditable ?? false,
    blobUrl: overrides.blobUrl,
    aiScript: overrides.aiScript,
    aiVoice: overrides.aiVoice,
    aiVoiceStyle: overrides.aiVoiceStyle,
  };
};

describe('NarrationSection offline mode', () => {
  it('オフライン時は AI 追加と AI 編集だけを無効化する', () => {
    const narrations: NarrationClip[] = [
      createNarrationClip({
        id: 'ai-clip',
        sourceType: 'ai',
        isAiEditable: true,
        file: new File([''], 'ai.wav', { type: 'audio/wav' }),
      }),
      createNarrationClip({
        id: 'file-clip',
        sourceType: 'file',
        isAiEditable: false,
        file: new File([''], 'file.wav', { type: 'audio/wav' }),
      }),
    ];

    render(
      <NarrationSection
        narrations={narrations}
        offlineMode={true}
        isNarrationLocked={false}
        totalDuration={30}
        currentTime={0}
        onToggleNarrationLock={vi.fn()}
        onAddAiNarration={vi.fn()}
        onEditAiNarration={vi.fn()}
        onNarrationUpload={vi.fn()}
        onRemoveNarration={vi.fn()}
        onMoveNarration={vi.fn()}
        onSaveNarration={vi.fn()}
        onUpdateStartTime={vi.fn()}
        onSetStartTimeToCurrent={vi.fn()}
        onUpdateVolume={vi.fn()}
        onToggleMute={vi.fn()}
        onUpdateTrimStart={vi.fn()}
        onUpdateTrimEnd={vi.fn()}
        formatTime={(value) => `${value.toFixed(1)}s`}
        onOpenHelp={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'AI' })).toBeDisabled();

    fireEvent.click(screen.getByText('ナレーション'));

    expect(screen.getByTitle('オフラインモードではAI編集できません')).toBeDisabled();
    expect(screen.getAllByTitle('下へ移動')[0]).toBeEnabled();
  });
});
