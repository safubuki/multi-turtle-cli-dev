import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionSettings, MediaItem } from '../../types';

const mocks = vi.hoisted(() => ({
  saveProject: vi.fn(),
  loadProject: vi.fn(),
  deleteProject: vi.fn(),
  deleteAllProjects: vi.fn(),
  resetProjectDatabase: vi.fn(),
  getProjectsInfo: vi.fn(),
  getStorageEstimate: vi.fn(),
  fileToArrayBuffer: vi.fn(),
  blobUrlToArrayBuffer: vi.fn(),
  arrayBufferToFile: vi.fn(),
}));

vi.mock('../../utils/indexedDB', () => ({
  saveProject: mocks.saveProject,
  loadProject: mocks.loadProject,
  deleteProject: mocks.deleteProject,
  deleteAllProjects: mocks.deleteAllProjects,
  resetProjectDatabase: mocks.resetProjectDatabase,
  getProjectsInfo: mocks.getProjectsInfo,
  getStorageEstimate: mocks.getStorageEstimate,
  fileToArrayBuffer: mocks.fileToArrayBuffer,
  blobUrlToArrayBuffer: mocks.blobUrlToArrayBuffer,
  arrayBufferToFile: mocks.arrayBufferToFile,
}));

import { useProjectStore, isStorageQuotaError } from '../../stores/projectStore';

const defaultCaptionSettings: CaptionSettings = {
  enabled: true,
  fontSize: 'medium',
  fontStyle: 'gothic',
  fontColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2,
  position: 'bottom',
  blur: 0,
  bulkFadeIn: false,
  bulkFadeOut: false,
  bulkFadeInDuration: 0.5,
  bulkFadeOutDuration: 0.5,
};

function createCaption(id = 'caption-1') {
  return {
    id,
    text: 'sample',
    startTime: 0,
    endTime: 1,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 0.5,
    fadeOutDuration: 0.5,
  };
}

function createMediaItem(fileName: string, type: 'video' | 'image' = 'video'): MediaItem {
  const fileType = type === 'video' ? 'video/mp4' : 'image/png';
  return {
    id: `${type}-${fileName}`,
    file: new File(['dummy'], fileName, { type: fileType }),
    type,
    url: `blob:${fileName}`,
    volume: 1,
    isMuted: false,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 1,
    fadeOutDuration: 1,
    duration: type === 'image' ? 5 : 10,
    originalDuration: type === 'image' ? 5 : 10,
    trimStart: 0,
    trimEnd: type === 'image' ? 5 : 10,
    scale: 1,
    positionX: 0,
    positionY: 0,
    isTransformOpen: false,
    isLocked: false,
  };
}

describe('projectStore save behavior', () => {
  beforeEach(() => {
    mocks.saveProject.mockReset();
    mocks.loadProject.mockReset();
    mocks.deleteProject.mockReset();
    mocks.deleteAllProjects.mockReset();
    mocks.resetProjectDatabase.mockReset();
    mocks.getProjectsInfo.mockReset();
    mocks.getStorageEstimate.mockReset();
    mocks.fileToArrayBuffer.mockReset();
    mocks.blobUrlToArrayBuffer.mockReset();
    mocks.arrayBufferToFile.mockReset();

    mocks.getProjectsInfo.mockResolvedValue({ auto: null, manual: null });
    mocks.getStorageEstimate.mockResolvedValue(null);
    mocks.fileToArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mocks.blobUrlToArrayBuffer.mockResolvedValue(new ArrayBuffer(0));
    mocks.arrayBufferToFile.mockImplementation((buffer: ArrayBuffer, fileName: string, fileType: string) =>
      new File([buffer], fileName, { type: fileType })
    );

    useProjectStore.setState({
      isSaving: false,
      isLoading: false,
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: null,
      autoSaveError: null,
      lastSaveFailure: null,
    });
  });

  it('手動保存で容量不足の場合は失敗を返し、自動保存は勝手に削除しない', async () => {
    mocks.saveProject.mockRejectedValueOnce(
      new Error('プロジェクトの保存に失敗しました (QuotaExceededError: storage full)')
    );

    await expect(
      useProjectStore.getState().saveProjectManual(
        [],
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('QuotaExceededError');

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().lastAutoSave).toBe('2026-02-17T00:00:00.000Z');
  });

  it('容量不足以外の手動保存失敗では再試行しない', async () => {
    mocks.saveProject.mockRejectedValueOnce(new Error('保存に失敗'));

    await expect(
      useProjectStore.getState().saveProjectManual(
        [],
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('保存に失敗');

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(mocks.deleteProject).not.toHaveBeenCalled();
  });

  it('容量不足判定ヘルパーがクォータ超過を検知する', () => {
    expect(isStorageQuotaError(new Error('QuotaExceededError'))).toBe(true);
    expect(isStorageQuotaError(new Error('storage is full'))).toBe(true);
    expect(isStorageQuotaError(new Error('network error'))).toBe(false);
  });

  it('deleteAutoSaveOnlyはautoだけ削除しmanualは保持する', async () => {
    mocks.deleteProject.mockResolvedValue(undefined);

    useProjectStore.setState({
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: '2026-02-17T01:00:00.000Z',
    });

    await useProjectStore.getState().deleteAutoSaveOnly();

    expect(mocks.deleteProject).toHaveBeenCalledWith('auto');
    expect(useProjectStore.getState().lastAutoSave).toBeNull();
    expect(useProjectStore.getState().lastManualSave).toBe('2026-02-17T01:00:00.000Z');
  });

  it('generic な IndexedDB 失敗でも auto save がある間は削除リカバリを提案する', async () => {
    mocks.saveProject.mockRejectedValueOnce(
      new Error('プロジェクトの保存に失敗しました (AbortError: transaction aborted)')
    );

    await expect(
      useProjectStore.getState().saveProjectManual(
        [],
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('AbortError');

    expect(useProjectStore.getState().lastSaveFailure?.recoveryAction).toBe('delete-auto-and-retry');
  });

  it('メディアの File 読み込み失敗時は url フォールバックで保存を継続する', async () => {
    const mediaItems = [createMediaItem('clip-1.mp4', 'video')];

    mocks.fileToArrayBuffer.mockRejectedValueOnce(new Error('ファイルの読み込みに失敗しました'));
    mocks.blobUrlToArrayBuffer.mockResolvedValueOnce(new ArrayBuffer(8));

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).resolves.toBeUndefined();

    expect(mocks.blobUrlToArrayBuffer).toHaveBeenCalledWith(mediaItems[0].url);
    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().lastSaveFailure).toBeNull();
  });

  it('素材名付きの読み込み失敗を保持して inspect-media を提案する', async () => {
    const mediaItems = [createMediaItem('broken.mp4', 'video')];

    mocks.fileToArrayBuffer.mockRejectedValueOnce(new Error('ファイルの読み込みに失敗しました'));
    mocks.blobUrlToArrayBuffer.mockRejectedValueOnce(new Error('Failed to fetch'));

    await expect(
      useProjectStore.getState().saveProjectManual(
        mediaItems,
        false,
        null,
        false,
        [],
        false,
        [],
        defaultCaptionSettings,
        false
      )
    ).rejects.toThrow('メディア「broken.mp4」');

    expect(mocks.saveProject).not.toHaveBeenCalled();
    expect(useProjectStore.getState().lastSaveFailure?.recoveryAction).toBe('inspect-media');
    expect(useProjectStore.getState().lastSaveFailure?.reason).toContain('broken.mp4');
  });

  it('保存と読込の往復でメディアの元ファイル名を維持する', async () => {
    const mediaItems = [createMediaItem('original-name.mp4', 'video')];
    mocks.saveProject.mockResolvedValue(undefined);

    await useProjectStore.getState().saveProjectManual(
      mediaItems,
      false,
      null,
      false,
      [],
      false,
      [],
      defaultCaptionSettings,
      false
    );

    expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    const savedProjectData = mocks.saveProject.mock.calls[0][0] as { mediaItems: Array<{ fileName: string }> };
    expect(savedProjectData.mediaItems[0].fileName).toBe('original-name.mp4');

    mocks.loadProject.mockResolvedValue(savedProjectData);

    const loaded = await useProjectStore.getState().loadProjectFromSlot('manual');

    if (!loaded) {
      throw new Error('loaded project was null');
    }
    expect(loaded.mediaItems[0].file.name).toBe('original-name.mp4');
  });

  it('resetSaveDatabase は保存情報と失敗状態を初期化する', async () => {
    mocks.resetProjectDatabase.mockResolvedValue(undefined);

    useProjectStore.setState({
      lastAutoSave: '2026-02-17T00:00:00.000Z',
      lastManualSave: '2026-02-17T01:00:00.000Z',
      autoSaveError: '保存失敗',
      lastSaveFailure: {
        operation: 'manual',
        reason: 'AbortError',
        occurredAt: '2026-03-17T00:00:00.000Z',
        recoveryAction: 'reset-database-and-retry',
        storageEstimate: null,
      },
    });

    await useProjectStore.getState().resetSaveDatabase();

    expect(mocks.resetProjectDatabase).toHaveBeenCalledTimes(1);
    expect(useProjectStore.getState().lastAutoSave).toBeNull();
    expect(useProjectStore.getState().lastManualSave).toBeNull();
    expect(useProjectStore.getState().autoSaveError).toBeNull();
    expect(useProjectStore.getState().lastSaveFailure).toBeNull();
  });
  it('自動保存が進行中でも手動保存は直列化され、復帰直後の競合で失敗しない', async () => {
    const captions = [createCaption()];
    let resolveAutoSave: (() => void) = () => {
      throw new Error('auto save resolver is not ready');
    };

    mocks.saveProject.mockImplementation((data: { slot: 'auto' | 'manual' }) => {
      if (data.slot === 'auto') {
        return new Promise<void>((resolve) => {
          resolveAutoSave = resolve;
        });
      }
      return Promise.resolve();
    });

    const autoSavePromise = useProjectStore.getState().saveProjectAuto(
      [],
      false,
      null,
      false,
      [],
      false,
      captions,
      defaultCaptionSettings,
      false,
    );

    await vi.waitFor(() => {
      expect(mocks.saveProject).toHaveBeenCalledTimes(1);
    });

    const manualSavePromise = useProjectStore.getState().saveProjectManual(
      [],
      false,
      null,
      false,
      [],
      false,
      captions,
      defaultCaptionSettings,
      false,
    );

    expect(mocks.saveProject.mock.calls[0][0].slot).toBe('auto');

    resolveAutoSave();

    await autoSavePromise;
    await manualSavePromise;

    expect(mocks.saveProject).toHaveBeenCalledTimes(2);
    expect(mocks.saveProject.mock.calls[1][0].slot).toBe('manual');
    expect(useProjectStore.getState().lastManualSave).not.toBeNull();
  });
});
