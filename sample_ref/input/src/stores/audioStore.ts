/**
 * @file audioStore.ts
 * @author Turtle Village
 * @description Audio state store (BGM and narrations)
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AudioTrack, NarrationClip, NarrationSourceType } from '../types';
import { revokeObjectUrl } from '../utils';
import { useLogStore } from './logStore';

interface CreateNarrationClipParams {
  file: File | { name: string };
  url: string;
  duration: number;
  startTime: number;
  sourceType: NarrationSourceType;
  blobUrl?: string;
  volume?: number;
  aiScript?: string;
  aiVoice?: NarrationClip['aiVoice'];
  aiVoiceStyle?: string;
}

interface AudioState {
  // BGM
  bgm: AudioTrack | null;
  isBgmLocked: boolean;

  // Narrations
  narrations: NarrationClip[];
  isNarrationLocked: boolean;

  // BGM actions
  setBgm: (track: AudioTrack | null) => void;
  updateBgmStartPoint: (value: number) => void;
  updateBgmDelay: (value: number) => void;
  updateBgmVolume: (value: number) => void;
  toggleBgmFadeIn: (enabled: boolean) => void;
  toggleBgmFadeOut: (enabled: boolean) => void;
  updateBgmFadeInDuration: (duration: number) => void;
  updateBgmFadeOutDuration: (duration: number) => void;
  toggleBgmLock: () => void;
  removeBgm: () => void;

  // Narration actions
  addNarration: (clip: NarrationClip) => void;
  updateNarrationStartTime: (id: string, value: number) => void;
  updateNarrationVolume: (id: string, value: number) => void;
  toggleNarrationMute: (id: string) => void;
  updateNarrationTrim: (id: string, edge: 'start' | 'end', value: number) => void;
  updateNarrationMeta: (id: string, updates: Partial<NarrationClip>) => void;
  replaceNarrationAudio: (
    id: string,
    payload: Pick<NarrationClip, 'file' | 'url' | 'blobUrl' | 'duration' | 'sourceType' | 'isAiEditable' | 'aiScript' | 'aiVoice' | 'aiVoiceStyle'>
  ) => void;
  moveNarration: (id: string, direction: 'up' | 'down') => void;
  removeNarration: (id: string) => void;
  setNarrations: (clips: NarrationClip[]) => void;
  toggleNarrationLock: () => void;

  // Clear
  clearAllAudio: () => void;

  // Restore
  restoreFromSave: (
    bgm: AudioTrack | null,
    isBgmLocked: boolean,
    narrations: NarrationClip[],
    isNarrationLocked: boolean
  ) => void;
}

function generateNarrationId(): string {
  return `narration_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function revokeNarrationUrls(clips: NarrationClip[]): void {
  clips.forEach((clip) => {
    if (clip.url) revokeObjectUrl(clip.url);
  });
}

// Helper: create BGM track
export function createAudioTrack(
  file: File,
  duration: number,
  defaultVolume: number = 1.0,
  isAi: boolean = false
): AudioTrack {
  return {
    file,
    url: URL.createObjectURL(file),
    startPoint: 0,
    delay: 0,
    volume: defaultVolume,
    fadeIn: false,
    fadeOut: false,
    fadeInDuration: 2.0,
    fadeOutDuration: 2.0,
    duration,
    isAi,
  };
}

// Helper: create narration clip
export function createNarrationClip(params: CreateNarrationClipParams): NarrationClip {
  const safeDuration = Math.max(0, params.duration);
  return {
    id: generateNarrationId(),
    sourceType: params.sourceType,
    file: params.file,
    url: params.url,
    blobUrl: params.blobUrl,
    startTime: Math.max(0, params.startTime),
    volume: Math.max(0, Math.min(2.5, params.volume ?? 1.0)),
    isMuted: false,
    trimStart: 0,
    trimEnd: safeDuration,
    duration: safeDuration,
    isAiEditable: params.sourceType === 'ai',
    aiScript: params.aiScript,
    aiVoice: params.aiVoice,
    aiVoiceStyle: params.aiVoiceStyle,
  };
}

function normalizeNarrationClip(clip: NarrationClip): NarrationClip {
  const duration = Math.max(0, clip.duration);
  const fallbackTrimEnd = duration;
  const rawTrimStart = Number.isFinite(clip.trimStart) ? clip.trimStart : 0;
  const rawTrimEnd = Number.isFinite(clip.trimEnd) ? clip.trimEnd : fallbackTrimEnd;
  const clampedTrimStart = Math.max(0, Math.min(duration, rawTrimStart));
  const clampedTrimEnd = Math.max(clampedTrimStart, Math.min(duration, rawTrimEnd));

  return {
    ...clip,
    duration,
    startTime: Math.max(0, clip.startTime),
    volume: Math.max(0, Math.min(2.5, clip.volume)),
    isMuted: Boolean(clip.isMuted),
    trimStart: clampedTrimStart,
    trimEnd: clampedTrimEnd,
  };
}

export const useAudioStore = create<AudioState>()(
  devtools(
    (set, get) => ({
      // Initial state
      bgm: null,
      isBgmLocked: false,
      narrations: [],
      isNarrationLocked: false,

      // === BGM actions ===
      setBgm: (track) => {
        const { bgm } = get();
        if (bgm?.url) revokeObjectUrl(bgm.url);
        useLogStore.getState().info('AUDIO', 'BGMを設定', {
          fileName: track?.file instanceof File ? track.file.name : track?.file?.name || 'unknown',
          duration: track?.duration || 0,
          isAi: track?.isAi || false,
        });
        set({ bgm: track });
      },

      updateBgmStartPoint: (value) => {
        set((state) => {
          if (!state.bgm) return state;
          const safeValue = Math.max(0, Math.min(state.bgm.duration, value));
          return { bgm: { ...state.bgm, startPoint: safeValue } };
        });
      },

      updateBgmDelay: (value) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, delay: Math.max(0, value) } };
        });
      },

      updateBgmVolume: (value) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, volume: Math.max(0, Math.min(2.5, value)) } };
        });
      },

      toggleBgmFadeIn: (enabled) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, fadeIn: enabled } };
        });
      },

      toggleBgmFadeOut: (enabled) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, fadeOut: enabled } };
        });
      },

      updateBgmFadeInDuration: (duration) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, fadeInDuration: duration } };
        });
      },

      updateBgmFadeOutDuration: (duration) => {
        set((state) => {
          if (!state.bgm) return state;
          return { bgm: { ...state.bgm, fadeOutDuration: duration } };
        });
      },

      toggleBgmLock: () => {
        set((state) => ({ isBgmLocked: !state.isBgmLocked }));
      },

      removeBgm: () => {
        const { bgm } = get();
        if (bgm?.url) {
          useLogStore.getState().info('AUDIO', 'BGMを削除', {
            fileName: bgm.file instanceof File ? bgm.file.name : (bgm.file as { name: string }).name,
          });
          revokeObjectUrl(bgm.url);
        }
        set({ bgm: null });
      },

      // === Narration actions ===
      addNarration: (clip) => {
        useLogStore.getState().info('AUDIO', 'ナレーションを追加', {
          id: clip.id,
          fileName: clip.file instanceof File ? clip.file.name : clip.file.name,
          sourceType: clip.sourceType,
          startTime: clip.startTime,
          duration: clip.duration,
        });
        set((state) => ({ narrations: [...state.narrations, normalizeNarrationClip(clip)] }));
      },

      updateNarrationStartTime: (id, value) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => {
            if (clip.id !== id) return clip;
            return { ...clip, startTime: Math.max(0, value) };
          }),
        }));
      },

      updateNarrationVolume: (id, value) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => {
            if (clip.id !== id) return clip;
            return normalizeNarrationClip({ ...clip, volume: Math.max(0, Math.min(2.5, value)) });
          }),
        }));
      },

      toggleNarrationMute: (id) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => (
            clip.id === id ? normalizeNarrationClip({ ...clip, isMuted: !clip.isMuted }) : clip
          )),
        }));
      },

      updateNarrationTrim: (id, edge, value) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => {
            if (clip.id !== id) return clip;
            const minGap = 0.05;
            const duration = Math.max(0, clip.duration);
            const trimStart = Number.isFinite(clip.trimStart) ? clip.trimStart : 0;
            const trimEnd = Number.isFinite(clip.trimEnd) ? clip.trimEnd : duration;

            if (edge === 'start') {
              const nextStart = Math.max(0, Math.min(value, trimEnd - minGap));
              return normalizeNarrationClip({ ...clip, trimStart: nextStart });
            }

            const nextEnd = Math.min(duration, Math.max(value, trimStart + minGap));
            return normalizeNarrationClip({ ...clip, trimEnd: nextEnd });
          }),
        }));
      },

      updateNarrationMeta: (id, updates) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => {
            if (clip.id !== id) return clip;
            const next = { ...clip, ...updates };
            return normalizeNarrationClip(next);
          }),
        }));
      },

      replaceNarrationAudio: (id, payload) => {
        set((state) => ({
          narrations: state.narrations.map((clip) => {
            if (clip.id !== id) return clip;
            if (clip.url && clip.url !== payload.url) {
              revokeObjectUrl(clip.url);
            }
            return {
              ...clip,
              file: payload.file,
              url: payload.url,
              blobUrl: payload.blobUrl,
              duration: payload.duration,
              trimStart: 0,
              trimEnd: Math.max(0, payload.duration),
              sourceType: payload.sourceType,
              isAiEditable: payload.isAiEditable,
              aiScript: payload.aiScript,
              aiVoice: payload.aiVoice,
              aiVoiceStyle: payload.aiVoiceStyle,
            };
          }),
        }));
      },

      moveNarration: (id, direction) => {
        set((state) => {
          const idx = state.narrations.findIndex((clip) => clip.id === id);
          if (idx < 0) return state;
          const target = direction === 'up' ? idx - 1 : idx + 1;
          if (target < 0 || target >= state.narrations.length) return state;
          const next = [...state.narrations];
          [next[idx], next[target]] = [next[target], next[idx]];
          return { narrations: next };
        });
      },

      removeNarration: (id) => {
        const clip = get().narrations.find((item) => item.id === id);
        if (clip?.url) {
          useLogStore.getState().info('AUDIO', 'ナレーションを削除', {
            id: clip.id,
            fileName: clip.file instanceof File ? clip.file.name : clip.file.name,
          });
          revokeObjectUrl(clip.url);
        }

        set((state) => ({
          narrations: state.narrations.filter((item) => item.id !== id),
        }));
      },

      setNarrations: (clips) => {
        const { narrations } = get();
        revokeNarrationUrls(narrations);
        set({ narrations: clips.map((clip) => normalizeNarrationClip(clip)) });
      },

      toggleNarrationLock: () => {
        set((state) => ({ isNarrationLocked: !state.isNarrationLocked }));
      },

      // === Clear all ===
      clearAllAudio: () => {
        const { bgm, narrations } = get();
        useLogStore.getState().info('AUDIO', '全オーディオをクリア', {
          hasBgm: !!bgm,
          narrationCount: narrations.length,
        });

        if (bgm?.url) revokeObjectUrl(bgm.url);
        revokeNarrationUrls(narrations);

        set({
          bgm: null,
          isBgmLocked: false,
          narrations: [],
          isNarrationLocked: false,
        });
      },

      // === Restore from save ===
      restoreFromSave: (newBgm, newIsBgmLocked, newNarrations, newIsNarrationLocked) => {
        const { bgm, narrations } = get();

        if (bgm?.url) revokeObjectUrl(bgm.url);
        revokeNarrationUrls(narrations);

        set({
          bgm: newBgm,
          isBgmLocked: newIsBgmLocked,
          narrations: newNarrations.map((clip) => normalizeNarrationClip(clip)),
          isNarrationLocked: newIsNarrationLocked,
        });
      },
    }),
    { name: 'audio-store' }
  )
);

export default useAudioStore;
