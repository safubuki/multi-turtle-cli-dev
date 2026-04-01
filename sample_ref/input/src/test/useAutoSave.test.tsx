import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AUTO_SAVE_INTERVAL_KEY,
  useAutoSave,
} from '../hooks/useAutoSave';
import { useAudioStore } from '../stores/audioStore';
import { useCaptionStore } from '../stores/captionStore';
import { useMediaStore } from '../stores/mediaStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';

const defaultCaptionSettings = {
  enabled: true,
  fontSize: 'medium' as const,
  fontStyle: 'gothic' as const,
  fontColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2,
  position: 'bottom' as const,
  blur: 0,
  bulkFadeIn: false,
  bulkFadeOut: false,
  bulkFadeInDuration: 0.5,
  bulkFadeOutDuration: 0.5,
};

function setVisibilityState(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value: state,
  });
}

describe('useAutoSave', () => {
  const originalMediaState = useMediaStore.getState();
  const originalAudioState = useAudioStore.getState();
  const originalCaptionState = useCaptionStore.getState();
  const originalProjectState = useProjectStore.getState();
  const originalUiState = useUIStore.getState();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem(AUTO_SAVE_INTERVAL_KEY, '1');
    setVisibilityState('visible');

    useMediaStore.setState({
      mediaItems: [],
      isLocked: false,
    });
    useAudioStore.setState({
      bgm: null,
      narrations: [],
      isBgmLocked: false,
      isNarrationLocked: false,
    });
    useCaptionStore.setState({
      captions: [{
        id: 'caption-1',
        text: 'sample',
        startTime: 0,
        endTime: 1,
        fadeIn: false,
        fadeOut: false,
        fadeInDuration: 0.5,
        fadeOutDuration: 0.5,
      }],
      settings: defaultCaptionSettings,
      isLocked: false,
    });
    useUIStore.setState({
      isProcessing: false,
    });
  });

  afterEach(() => {
    cleanup();
    act(() => {
      useMediaStore.setState(originalMediaState, true);
      useAudioStore.setState(originalAudioState, true);
      useCaptionStore.setState(originalCaptionState, true);
      useProjectStore.setState(originalProjectState, true);
      useUIStore.setState(originalUiState, true);
    });
    localStorage.removeItem(AUTO_SAVE_INTERVAL_KEY);
    setVisibilityState('visible');
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('復帰イベントは可視状態が落ち着いてから追いつき保存を判定する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(undefined);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    const baseNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + 61_000);

    setVisibilityState('hidden');
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    setVisibilityState('visible');
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);
  });

  it('手動保存中は復帰時の自動保存を走らせず、手動保存直後の重複保存も防ぐ', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(undefined);
    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
    });

    renderHook(() => useAutoSave());

    const baseNow = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => baseNow + 61_000);

    act(() => {
      useProjectStore.setState({ isSaving: true });
    });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await Promise.resolve();
    });

    expect(saveProjectAuto).not.toHaveBeenCalled();

    await act(async () => {
      useProjectStore.setState({
        isSaving: false,
        lastManualSave: '2026-03-17T00:00:00.000Z',
      });
      await Promise.resolve();
    });

    await act(async () => {
      vi.advanceTimersByTime(61_000);
      await Promise.resolve();
    });

    expect(saveProjectAuto).not.toHaveBeenCalled();
  });

  it('トリム後の位置・サイズ調整も自動保存の差分として検知する', async () => {
    const refreshSaveInfo = vi.fn().mockResolvedValue(undefined);
    const saveProjectAuto = vi.fn().mockResolvedValue(undefined);
    const mediaFile = new File(['video'], 'clip.mp4', { type: 'video/mp4' });

    act(() => {
      useProjectStore.setState({
        refreshSaveInfo,
        saveProjectAuto,
        isSaving: false,
        lastManualSave: null,
      });
      useMediaStore.setState({
        mediaItems: [{
          id: 'video-1',
          file: mediaFile,
          type: 'video',
          url: 'blob:video-1',
          volume: 1,
          isMuted: false,
          fadeIn: false,
          fadeOut: false,
          fadeInDuration: 0.5,
          fadeOutDuration: 0.5,
          duration: 5,
          originalDuration: 10,
          trimStart: 1,
          trimEnd: 6,
          scale: 1,
          positionX: 0,
          positionY: 0,
          isTransformOpen: false,
          isLocked: false,
        }],
        isLocked: false,
      });
    });

    const { result } = renderHook(() => useAutoSave());

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(1);

    act(() => {
      useMediaStore.getState().updateScale('video-1', 1.35);
      useMediaStore.getState().updatePosition('video-1', 'x', 120);
      useMediaStore.getState().updatePosition('video-1', 'y', -80);
    });

    await act(async () => {
      await result.current.performAutoSave();
    });

    expect(saveProjectAuto).toHaveBeenCalledTimes(2);
  });
});
