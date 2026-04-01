/**
 * UIストア - Zustand
 * UI状態・再生・エクスポート・AIモーダルの状態管理
 */

/**
 * @file uiStore.ts
 * @author Turtle Village
 * @description アプリケーションのUI状態（モーダル表示、選択中のアイテム、ドラッグ状態など）を管理するZustandストア。
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { ExportFormat, VoiceId } from '../types';

interface UIState {
  // Toast & Error
  toastMessage: string;
  errorMsg: string;
  errorCount: number; // エラーカウンター

  // Playback
  isPlaying: boolean;
  currentTime: number;

  // Processing & Export
  isProcessing: boolean;
  isLoading: boolean;  // リソース読み込み中フラグ
  exportUrl: string | null;
  exportExt: ExportFormat;

  // AI Modal
  showAiModal: boolean;
  aiPrompt: string;
  aiScript: string;
  aiVoice: VoiceId;
  aiVoiceStyle: string;
  isAiLoading: boolean;

  // Actions - Toast & Error
  showToast: (message: string, duration?: number) => void;
  clearToast: () => void;
  setError: (message: string, autoClear?: boolean) => void;
  clearError: () => void;

  // Actions - Playback
  play: () => void;
  pause: () => void;
  togglePlayback: () => void;
  setCurrentTime: (time: number) => void;
  seekTo: (time: number) => void;

  // Actions - Processing & Export
  setProcessing: (processing: boolean) => void;
  setLoading: (loading: boolean) => void;
  setExportUrl: (url: string | null) => void;
  setExportExt: (ext: ExportFormat) => void;
  clearExport: () => void;

  // Actions - AI Modal
  openAiModal: () => void;
  closeAiModal: () => void;
  setAiPrompt: (prompt: string) => void;
  setAiScript: (script: string) => void;
  setAiVoice: (voice: VoiceId) => void;
  setAiVoiceStyle: (style: string) => void;
  setAiLoading: (loading: boolean) => void;
  resetAiModal: () => void;

  // Reset
  resetUI: () => void;
}

// Toast timer ID
let toastTimerId: number | undefined;
// Error timer ID for auto-clear
let errorTimerId: number | undefined;
// Error auto-clear timeout duration (ms)
const ERROR_AUTO_CLEAR_TIMEOUT_MS = 10000;

export const useUIStore = create<UIState>()(
  devtools(
    (set, get) => ({
      // Initial state
      toastMessage: '',
      errorMsg: '',
      errorCount: 0,
      isPlaying: false,
      currentTime: 0,
      isProcessing: false,
      isLoading: false,
      exportUrl: null,
      exportExt: 'mp4' as const,
      showAiModal: false,
      aiPrompt: '',
      aiScript: '',
      aiVoice: 'Aoede' as const,
      aiVoiceStyle: '',
      isAiLoading: false,

      // === Toast & Error Actions ===
      showToast: (message, duration = 3000) => {
        if (toastTimerId) {
          clearTimeout(toastTimerId);
        }
        set({ toastMessage: message });

        toastTimerId = window.setTimeout(() => {
          set({ toastMessage: '' });
          toastTimerId = undefined;
        }, duration);
      },

      clearToast: () => {
        if (toastTimerId) {
          clearTimeout(toastTimerId);
          toastTimerId = undefined;
        }
        set({ toastMessage: '' });
      },

      setError: (message, autoClear = true) => {
        const currentError = get().errorMsg;
        const currentCount = get().errorCount;
        
        // 既存のタイマーをクリア
        if (errorTimerId) {
          clearTimeout(errorTimerId);
          errorTimerId = undefined;
        }
        
        // 同じエラーメッセージの場合はカウントを増やす
        if (currentError === message && currentCount > 0) {
          set({ errorCount: currentCount + 1 });
        } else {
          // 新しいエラーメッセージの場合は初期化
          set({ errorMsg: message, errorCount: 1 });
        }
        
        // 自動消去を有効にする場合
        if (autoClear) {
          errorTimerId = window.setTimeout(() => {
            set({ errorMsg: '', errorCount: 0 });
            errorTimerId = undefined;
          }, ERROR_AUTO_CLEAR_TIMEOUT_MS);
        }
      },

      clearError: () => {
        if (errorTimerId) {
          clearTimeout(errorTimerId);
          errorTimerId = undefined;
        }
        set({ errorMsg: '', errorCount: 0 });
      },

      // === Playback Actions ===
      play: () => {
        set({ isPlaying: true });
      },

      pause: () => {
        set({ isPlaying: false });
      },

      togglePlayback: () => {
        set((state) => ({ isPlaying: !state.isPlaying }));
      },

      setCurrentTime: (time) => {
        set({ currentTime: Math.max(0, time) });
      },

      seekTo: (time) => {
        set({ currentTime: Math.max(0, time), isPlaying: false });
      },

      // === Processing & Export Actions ===
      setProcessing: (processing) => {
        set({ isProcessing: processing });
      },

      setLoading: (loading) => {
        set({ isLoading: loading });
      },

      setExportUrl: (url) => {
        const { exportUrl } = get();
        // 既存URLを解放
        if (exportUrl) {
          URL.revokeObjectURL(exportUrl);
        }
        set({ exportUrl: url });
      },

      setExportExt: (ext) => {
        set({ exportExt: ext });
      },

      clearExport: () => {
        const { exportUrl } = get();
        if (exportUrl) {
          URL.revokeObjectURL(exportUrl);
        }
        set({ exportUrl: null });
      },

      // === AI Modal Actions ===
      openAiModal: () => {
        set({ showAiModal: true });
      },

      closeAiModal: () => {
        set({ showAiModal: false });
      },

      setAiPrompt: (prompt) => {
        set({ aiPrompt: prompt });
      },

      setAiScript: (script) => {
        set({ aiScript: script });
      },

      setAiVoice: (voice) => {
        set({ aiVoice: voice });
      },

      setAiVoiceStyle: (style) => {
        set({ aiVoiceStyle: style });
      },

      setAiLoading: (loading) => {
        set({ isAiLoading: loading });
      },

      resetAiModal: () => {
        set({
          showAiModal: false,
          aiPrompt: '',
          aiScript: '',
          aiVoice: 'Aoede' as const,
          aiVoiceStyle: '',
          isAiLoading: false,
        });
      },

      // === Reset UI ===
      resetUI: () => {
        const { exportUrl } = get();
        if (exportUrl) {
          URL.revokeObjectURL(exportUrl);
        }
        if (toastTimerId) {
          clearTimeout(toastTimerId);
          toastTimerId = undefined;
        }
        if (errorTimerId) {
          clearTimeout(errorTimerId);
          errorTimerId = undefined;
        }
        set({
          toastMessage: '',
          errorMsg: '',
          errorCount: 0,
          isPlaying: false,
          currentTime: 0,
          isProcessing: false,
          exportUrl: null,
          exportExt: 'mp4' as const,
          showAiModal: false,
          aiPrompt: '',
          aiScript: '',
          aiVoice: 'Aoede' as const,
          aiVoiceStyle: '',
          isAiLoading: false,
        });
      },
    }),
    { name: 'ui-store' }
  )
);

export default useUIStore;
