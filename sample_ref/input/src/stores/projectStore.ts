/**
 * @file projectStore.ts
 * @author Turtle Village
 * @description Project save/load store
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MediaItem, AudioTrack, Caption, CaptionSettings, NarrationClip } from '../types';
import {
  saveProject,
  loadProject,
  deleteProject,
  deleteAllProjects,
  resetProjectDatabase,
  getProjectsInfo,
  getStorageEstimate,
  fileToArrayBuffer,
  blobUrlToArrayBuffer,
  arrayBufferToFile,
  type ProjectData,
  type SaveSlot,
  type SerializedMediaItem,
  type SerializedAudioTrack,
  type SerializedCaption,
  type SerializedNarrationClip,
} from '../utils/indexedDB';
import { useLogStore } from './logStore';
import versionData from '../../version.json';

export function getProjectStoreErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function isStorageQuotaError(error: unknown): boolean {
  const lower = getProjectStoreErrorMessage(error).toLowerCase();
  return (
    lower.includes('quotaexceeded') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota') ||
    lower.includes('storage') ||
    lower.includes('容量')
  );
}

export type SaveFailureRecoveryAction =
  | 'delete-auto-and-retry'
  | 'reset-database-and-retry'
  | 'inspect-media'
  | 'retry';

export interface SaveFailureInfo {
  operation: 'manual' | 'auto';
  reason: string;
  occurredAt: string;
  recoveryAction: SaveFailureRecoveryAction;
  storageEstimate: { usage: number; quota: number } | null;
}

function isLikelyIndexedDbTransactionError(error: unknown): boolean {
  const lower = getProjectStoreErrorMessage(error).toLowerCase();
  return (
    lower.includes('indexeddb') ||
    lower.includes('aborterror') ||
    lower.includes('unknownerror') ||
    lower.includes('invalidstateerror') ||
    lower.includes('transaction') ||
    lower.includes('database')
  );
}

function isLikelyMediaSerializationError(error: unknown): boolean {
  const lower = getProjectStoreErrorMessage(error).toLowerCase();
  return (
    lower.includes('ファイルの読み込みに失敗') ||
    lower.includes('failed to fetch') ||
    lower.includes('blob') ||
    lower.includes('readasarraybuffer')
  );
}

function isStorageNearQuota(estimate: { usage: number; quota: number } | null): boolean {
  if (!estimate) return false;
  if (!(estimate.quota > 0)) return false;
  return estimate.usage / estimate.quota >= 0.85;
}

function classifySaveFailureRecoveryAction(params: {
  error: unknown;
  estimate: { usage: number; quota: number } | null;
  hasAutoSave: boolean;
}): SaveFailureRecoveryAction {
  if (isStorageQuotaError(params.error) || (params.hasAutoSave && isStorageNearQuota(params.estimate))) {
    return params.hasAutoSave ? 'delete-auto-and-retry' : 'retry';
  }
  if (isLikelyMediaSerializationError(params.error)) {
    return 'inspect-media';
  }
  if (isLikelyIndexedDbTransactionError(params.error)) {
    return params.hasAutoSave ? 'delete-auto-and-retry' : 'reset-database-and-retry';
  }
  return 'retry';
}

async function buildSaveFailureInfo(params: {
  operation: 'manual' | 'auto';
  error: unknown;
  hasAutoSave: boolean;
}): Promise<SaveFailureInfo> {
  let estimate: { usage: number; quota: number } | null = null;
  try {
    estimate = await getStorageEstimate();
  } catch {
    // ignore estimate failures
  }

  return {
    operation: params.operation,
    reason: getProjectStoreErrorMessage(params.error),
    occurredAt: new Date().toISOString(),
    recoveryAction: classifySaveFailureRecoveryAction({
      error: params.error,
      estimate,
      hasAutoSave: params.hasAutoSave,
    }),
    storageEstimate: estimate,
  };
}

interface ProjectState {
  isSaving: boolean;
  isLoading: boolean;
  lastAutoSave: string | null;
  lastManualSave: string | null;
  autoSaveError: string | null;
  lastSaveFailure: SaveFailureInfo | null;

  saveProjectManual: (
    mediaItems: MediaItem[],
    isClipsLocked: boolean,
    bgm: AudioTrack | null,
    isBgmLocked: boolean,
    narrations: NarrationClip[],
    isNarrationLocked: boolean,
    captions: Caption[],
    captionSettings: CaptionSettings,
    isCaptionsLocked: boolean
  ) => Promise<void>;

  saveProjectAuto: (
    mediaItems: MediaItem[],
    isClipsLocked: boolean,
    bgm: AudioTrack | null,
    isBgmLocked: boolean,
    narrations: NarrationClip[],
    isNarrationLocked: boolean,
    captions: Caption[],
    captionSettings: CaptionSettings,
    isCaptionsLocked: boolean
  ) => Promise<void>;

  loadProjectFromSlot: (slot: SaveSlot) => Promise<{
    mediaItems: MediaItem[];
    isClipsLocked: boolean;
    bgm: AudioTrack | null;
    isBgmLocked: boolean;
    narrations: NarrationClip[];
    isNarrationLocked: boolean;
    captions: Caption[];
    captionSettings: CaptionSettings;
    isCaptionsLocked: boolean;
  } | null>;

  deleteAllSaves: () => Promise<void>;
  deleteAutoSaveOnly: () => Promise<void>;
  resetSaveDatabase: () => Promise<void>;
  refreshSaveInfo: () => Promise<void>;
  clearAutoSaveError: () => void;
  clearLastSaveFailure: () => void;
}

let projectSaveQueue: Promise<void> = Promise.resolve();

function enqueueProjectSave<T>(task: () => Promise<T>): Promise<T> {
  const run = projectSaveQueue.catch(() => undefined).then(task);
  projectSaveQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function readSerializableFileData(params: {
  file: File;
  fallbackUrl?: string;
  kind: 'メディア' | 'BGM' | 'ナレーション';
}): Promise<ArrayBuffer> {
  try {
    return await fileToArrayBuffer(params.file);
  } catch (fileError) {
    if (params.fallbackUrl) {
      try {
        const fallbackData = await blobUrlToArrayBuffer(params.fallbackUrl);
        useLogStore.getState().warn('SYSTEM', '保存用ファイル読み込み失敗のためURLフォールバックを使用', {
          kind: params.kind,
          fileName: params.file.name,
          error: getProjectStoreErrorMessage(fileError),
        });
        return fallbackData;
      } catch (fallbackError) {
        throw new Error(
          `${params.kind}「${params.file.name}」の読み込みに失敗しました`
          + ` (file: ${getProjectStoreErrorMessage(fileError)} / url: ${getProjectStoreErrorMessage(fallbackError)})`
        );
      }
    }

    throw new Error(
      `${params.kind}「${params.file.name}」の読み込みに失敗しました`
      + ` (${getProjectStoreErrorMessage(fileError)})`
    );
  }
}

async function serializeMediaItem(item: MediaItem): Promise<SerializedMediaItem> {
  const fileData = await readSerializableFileData({
    file: item.file,
    fallbackUrl: item.url,
    kind: 'メディア',
  });
  return {
    id: item.id,
    fileName: item.file.name,
    fileType: item.file.type,
    fileData,
    type: item.type,
    volume: item.volume,
    isMuted: item.isMuted,
    fadeIn: item.fadeIn,
    fadeOut: item.fadeOut,
    fadeInDuration: item.fadeInDuration,
    fadeOutDuration: item.fadeOutDuration,
    duration: item.duration,
    originalDuration: item.originalDuration,
    trimStart: item.trimStart,
    trimEnd: item.trimEnd,
    scale: item.scale,
    positionX: item.positionX,
    positionY: item.positionY,
    isTransformOpen: item.isTransformOpen,
    isLocked: item.isLocked,
  };
}

function deserializeMediaItem(data: SerializedMediaItem): MediaItem {
  const file = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
  return {
    id: data.id,
    file,
    type: data.type,
    url: URL.createObjectURL(file),
    volume: data.volume,
    isMuted: data.isMuted,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    duration: data.duration,
    originalDuration: data.originalDuration,
    trimStart: data.trimStart,
    trimEnd: data.trimEnd,
    scale: data.scale,
    positionX: data.positionX,
    positionY: data.positionY,
    isTransformOpen: data.isTransformOpen,
    isLocked: data.isLocked,
  };
}

async function serializeAudioTrack(track: AudioTrack): Promise<SerializedAudioTrack> {
  let fileData: ArrayBuffer | null = null;
  let blobData: ArrayBuffer | undefined;

  if (track.file instanceof File) {
    fileData = await readSerializableFileData({
      file: track.file,
      fallbackUrl: track.blobUrl || track.url,
      kind: 'BGM',
    });
  }

  if (track.blobUrl) {
    try {
      blobData = await blobUrlToArrayBuffer(track.blobUrl);
    } catch {
      // ignore blob fetch errors
    }
  }

  const fileName = track.file instanceof File ? track.file.name : track.file.name;

  return {
    fileName,
    fileType: track.file instanceof File ? track.file.type : 'audio/wav',
    fileData,
    blobData,
    startPoint: track.startPoint,
    delay: track.delay,
    volume: track.volume,
    fadeIn: track.fadeIn,
    fadeOut: track.fadeOut,
    fadeInDuration: track.fadeInDuration,
    fadeOutDuration: track.fadeOutDuration,
    duration: track.duration,
    isAi: track.isAi,
  };
}

function deserializeAudioTrack(data: SerializedAudioTrack): AudioTrack {
  let file: File | { name: string };
  let url: string;
  let blobUrl: string | undefined;

  if (data.fileData) {
    const f = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
    file = f;
    url = URL.createObjectURL(f);
  } else if (data.blobData) {
    const blob = new Blob([data.blobData], { type: data.fileType });
    file = { name: data.fileName };
    url = URL.createObjectURL(blob);
    blobUrl = url;
  } else {
    file = { name: data.fileName };
    url = '';
  }

  return {
    file,
    url,
    blobUrl,
    startPoint: data.startPoint,
    delay: data.delay,
    volume: data.volume,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    duration: data.duration,
    isAi: data.isAi,
  };
}

async function serializeNarrationClip(clip: NarrationClip): Promise<SerializedNarrationClip> {
  let fileData: ArrayBuffer | null = null;
  let blobData: ArrayBuffer | undefined;

  if (clip.file instanceof File) {
    fileData = await readSerializableFileData({
      file: clip.file,
      fallbackUrl: clip.blobUrl || clip.url,
      kind: 'ナレーション',
    });
  }

  if (clip.blobUrl) {
    try {
      blobData = await blobUrlToArrayBuffer(clip.blobUrl);
    } catch {
      // ignore blob fetch errors
    }
  }

  const fileName = clip.file instanceof File ? clip.file.name : clip.file.name;

  return {
    id: clip.id,
    sourceType: clip.sourceType,
    fileName,
    fileType: clip.file instanceof File ? clip.file.type : 'audio/wav',
    fileData,
    blobData,
    startTime: clip.startTime,
    volume: clip.volume,
    isMuted: clip.isMuted,
    trimStart: clip.trimStart,
    trimEnd: clip.trimEnd,
    duration: clip.duration,
    isAiEditable: clip.isAiEditable,
    aiScript: clip.aiScript,
    aiVoice: clip.aiVoice,
    aiVoiceStyle: clip.aiVoiceStyle,
  };
}

function deserializeNarrationClip(data: SerializedNarrationClip): NarrationClip {
  let file: File | { name: string };
  let url: string;
  let blobUrl: string | undefined;

  if (data.fileData) {
    const f = arrayBufferToFile(data.fileData, data.fileName, data.fileType);
    file = f;
    url = URL.createObjectURL(f);
  } else if (data.blobData) {
    const blob = new Blob([data.blobData], { type: data.fileType });
    file = { name: data.fileName };
    url = URL.createObjectURL(blob);
    blobUrl = url;
  } else {
    file = { name: data.fileName };
    url = '';
  }

  const duration = Math.max(0, data.duration);
  const trimStart = Math.max(0, Math.min(duration, data.trimStart ?? 0));
  const trimEnd = Math.max(trimStart, Math.min(duration, data.trimEnd ?? duration));

  return {
    id: data.id,
    sourceType: data.sourceType,
    file,
    url,
    blobUrl,
    startTime: Math.max(0, data.startTime),
    volume: Math.max(0, Math.min(2.5, data.volume)),
    isMuted: Boolean(data.isMuted),
    trimStart,
    trimEnd,
    duration,
    isAiEditable: data.isAiEditable,
    aiScript: data.aiScript,
    aiVoice: data.aiVoice as NarrationClip['aiVoice'],
    aiVoiceStyle: data.aiVoiceStyle,
  };
}

function convertLegacyNarrationToClip(track: AudioTrack): NarrationClip {
  return {
    id: `legacy_narration_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    sourceType: track.isAi ? 'ai' : 'file',
    file: track.file,
    url: track.url,
    blobUrl: track.blobUrl,
    startTime: Math.max(0, track.delay || 0),
    volume: Math.max(0, Math.min(2.5, track.volume)),
    isMuted: false,
    trimStart: 0,
    trimEnd: Math.max(0, track.duration),
    duration: track.duration,
    isAiEditable: !!track.isAi,
  };
}

function serializeCaption(caption: Caption): SerializedCaption {
  return {
    id: caption.id,
    text: caption.text,
    startTime: caption.startTime,
    endTime: caption.endTime,
    fadeIn: caption.fadeIn,
    fadeOut: caption.fadeOut,
    fadeInDuration: caption.fadeInDuration,
    fadeOutDuration: caption.fadeOutDuration,
    overridePosition: caption.overridePosition,
    overrideFontStyle: caption.overrideFontStyle,
    overrideFontSize: caption.overrideFontSize,
    overrideFadeIn: caption.overrideFadeIn,
    overrideFadeOut: caption.overrideFadeOut,
    overrideFadeInDuration: caption.overrideFadeInDuration,
    overrideFadeOutDuration: caption.overrideFadeOutDuration,
  };
}

function deserializeCaption(data: SerializedCaption): Caption {
  return {
    id: data.id,
    text: data.text,
    startTime: data.startTime,
    endTime: data.endTime,
    fadeIn: data.fadeIn,
    fadeOut: data.fadeOut,
    fadeInDuration: data.fadeInDuration,
    fadeOutDuration: data.fadeOutDuration,
    overridePosition: data.overridePosition,
    overrideFontStyle: data.overrideFontStyle,
    overrideFontSize: data.overrideFontSize,
    overrideFadeIn: data.overrideFadeIn,
    overrideFadeOut: data.overrideFadeOut,
    overrideFadeInDuration: data.overrideFadeInDuration,
    overrideFadeOutDuration: data.overrideFadeOutDuration,
  };
}

export const useProjectStore = create<ProjectState>()(
  devtools(
    (set, get) => ({
      isSaving: false,
      isLoading: false,
      lastAutoSave: null,
      lastManualSave: null,
      autoSaveError: null,
      lastSaveFailure: null,

      saveProjectManual: async (
        mediaItems,
        isClipsLocked,
        bgm,
        isBgmLocked,
        narrations,
        isNarrationLocked,
        captions,
        captionSettings,
        isCaptionsLocked
      ) => {
        set({ isSaving: true });
        useLogStore.getState().info('SYSTEM', '手動保存を開始', {
          mediaCount: mediaItems.length,
          hasBgm: !!bgm,
          narrationCount: narrations.length,
          captionCount: captions.length,
        });

        try {
          const projectData = await enqueueProjectSave(async () => {
            const serializedMediaItems = await Promise.all(mediaItems.map(serializeMediaItem));
            const serializedBgm = bgm ? await serializeAudioTrack(bgm) : null;
            const serializedNarrations = await Promise.all(narrations.map(serializeNarrationClip));
            const serializedCaptions = captions.map(serializeCaption);

            const nextProjectData: ProjectData = {
              slot: 'manual',
              savedAt: new Date().toISOString(),
              version: versionData.version,
              mediaItems: serializedMediaItems,
              isClipsLocked,
              bgm: serializedBgm,
              isBgmLocked,
              narrations: serializedNarrations,
              isNarrationLocked,
              captions: serializedCaptions,
              captionSettings,
              isCaptionsLocked,
            };

            await saveProject(nextProjectData);
            return nextProjectData;
          });

          useLogStore.getState().info('SYSTEM', '手動保存完了', { savedAt: projectData.savedAt });
          set({
            lastManualSave: projectData.savedAt,
            isSaving: false,
            lastSaveFailure: null,
          });
        } catch (error) {
          const failureInfo = await buildSaveFailureInfo({
            operation: 'manual',
            error,
            hasAutoSave: get().lastAutoSave !== null,
          });
          useLogStore.getState().error('SYSTEM', '手動保存失敗', {
            error: failureInfo.reason,
            recoveryAction: failureInfo.recoveryAction,
            storageEstimate: failureInfo.storageEstimate,
          });
          set({ isSaving: false, lastSaveFailure: failureInfo });
          throw error;
        }
      },

      saveProjectAuto: async (
        mediaItems,
        isClipsLocked,
        bgm,
        isBgmLocked,
        narrations,
        isNarrationLocked,
        captions,
        captionSettings,
        isCaptionsLocked
      ) => {
        if (mediaItems.length === 0 && !bgm && narrations.length === 0 && captions.length === 0) {
          return;
        }

        useLogStore.getState().debug('SYSTEM', '自動保存を開始', {
          mediaCount: mediaItems.length,
          hasBgm: !!bgm,
          narrationCount: narrations.length,
          captionCount: captions.length,
        });

        try {
          const projectData = await enqueueProjectSave(async () => {
            const serializedMediaItems = await Promise.all(mediaItems.map(serializeMediaItem));
            const serializedBgm = bgm ? await serializeAudioTrack(bgm) : null;
            const serializedNarrations = await Promise.all(narrations.map(serializeNarrationClip));
            const serializedCaptions = captions.map(serializeCaption);

            const nextProjectData: ProjectData = {
              slot: 'auto',
              savedAt: new Date().toISOString(),
              version: versionData.version,
              mediaItems: serializedMediaItems,
              isClipsLocked,
              bgm: serializedBgm,
              isBgmLocked,
              narrations: serializedNarrations,
              isNarrationLocked,
              captions: serializedCaptions,
              captionSettings,
              isCaptionsLocked,
            };

            await saveProject(nextProjectData);
            return nextProjectData;
          });
          useLogStore.getState().debug('SYSTEM', '自動保存完了', { savedAt: projectData.savedAt });
          set({ lastAutoSave: projectData.savedAt, autoSaveError: null, lastSaveFailure: null });
        } catch (error) {
          const failureInfo = await buildSaveFailureInfo({
            operation: 'auto',
            error,
            hasAutoSave: get().lastAutoSave !== null,
          });
          const message = isStorageQuotaError(error)
            ? '保存容量が不足しています。不要な保存データを削除してください'
            : getProjectStoreErrorMessage(error);
          useLogStore.getState().error('SYSTEM', '自動保存失敗', {
            error: message,
            recoveryAction: failureInfo.recoveryAction,
            storageEstimate: failureInfo.storageEstimate,
          });
          set({ autoSaveError: message, lastSaveFailure: failureInfo });
        }
      },

      loadProjectFromSlot: async (slot) => {
        set({ isLoading: true });
        useLogStore.getState().info('SYSTEM', 'プロジェクトを読み込み中', { slot });

        try {
          const data = await loadProject(slot);
          if (!data) {
            useLogStore.getState().warn('SYSTEM', '読み込み対象のプロジェクトが存在しません', { slot });
            set({ isLoading: false });
            return null;
          }

          const mediaItems = data.mediaItems.map(deserializeMediaItem);
          const bgm = data.bgm ? deserializeAudioTrack(data.bgm) : null;
          const narrations = (data.narrations && data.narrations.length > 0)
            ? data.narrations.map(deserializeNarrationClip)
            : (data.narration ? [convertLegacyNarrationToClip(deserializeAudioTrack(data.narration))] : []);
          const captions = data.captions.map(deserializeCaption);

          useLogStore.getState().info('SYSTEM', 'プロジェクト読み込み完了', {
            slot,
            mediaCount: mediaItems.length,
            hasBgm: !!bgm,
            narrationCount: narrations.length,
            captionCount: captions.length,
            savedAt: data.savedAt,
          });
          set({ isLoading: false });

          return {
            mediaItems,
            isClipsLocked: data.isClipsLocked,
            bgm,
            isBgmLocked: data.isBgmLocked,
            narrations,
            isNarrationLocked: data.isNarrationLocked,
            captions,
            captionSettings: data.captionSettings,
            isCaptionsLocked: data.isCaptionsLocked,
          };
        } catch (error) {
          useLogStore.getState().error('SYSTEM', 'プロジェクト読み込み失敗', {
            slot,
            error: error instanceof Error ? error.message : String(error),
          });
          set({ isLoading: false });
          throw error;
        }
      },

      deleteAllSaves: async () => {
        useLogStore.getState().info('SYSTEM', '全保存データを削除');
        await deleteAllProjects();
        set({ lastAutoSave: null, lastManualSave: null });
        useLogStore.getState().info('SYSTEM', '全保存データ削除完了');
      },

      deleteAutoSaveOnly: async () => {
        useLogStore.getState().info('SYSTEM', '自動保存データを削除');
        await deleteProject('auto');
        set({ lastAutoSave: null, lastSaveFailure: null });
        useLogStore.getState().info('SYSTEM', '自動保存データ削除完了');
      },

      resetSaveDatabase: async () => {
        useLogStore.getState().warn('SYSTEM', '保存用データベースを初期化');
        await enqueueProjectSave(async () => {
          await resetProjectDatabase();
        });
        set({
          lastAutoSave: null,
          lastManualSave: null,
          autoSaveError: null,
          lastSaveFailure: null,
        });
        useLogStore.getState().info('SYSTEM', '保存用データベース初期化完了');
      },

      refreshSaveInfo: async () => {
        try {
          const info = await getProjectsInfo();
          set({
            lastAutoSave: info.auto?.savedAt || null,
            lastManualSave: info.manual?.savedAt || null,
          });
        } catch {
          // ignore
        }
      },

      clearAutoSaveError: () => set({ autoSaveError: null }),
      clearLastSaveFailure: () => set({ lastSaveFailure: null }),
    }),
    { name: 'ProjectStore' }
  )
);
