/**
 * @file captionStore.ts
 * @author Turtle Village
 * @description 字幕（キャプション）のデータとスタイル設定を管理するZustandストア。
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { Caption, CaptionSettings, CaptionPosition, CaptionSize, CaptionFontStyle } from '../types';
import { useLogStore } from './logStore';

interface CaptionState {
  // キャプション一覧
  captions: Caption[];

  // スタイル設定
  settings: CaptionSettings;

  // ロック状態
  isLocked: boolean;

  // === キャプション操作 ===
  addCaption: (text: string, startTime: number, endTime: number) => void;
  updateCaption: (id: string, updates: Partial<Omit<Caption, 'id'>>) => void;
  removeCaption: (id: string) => void;
  moveCaption: (id: string, direction: 'up' | 'down') => void;
  clearAllCaptions: () => void;

  // === スタイル設定 ===
  setEnabled: (enabled: boolean) => void;
  setFontSize: (size: CaptionSize) => void;
  setFontStyle: (style: CaptionFontStyle) => void;
  setFontColor: (color: string) => void;
  setStrokeColor: (color: string) => void;
  setStrokeWidth: (width: number) => void;
  setPosition: (position: CaptionPosition) => void;
  setBlur: (blur: number) => void;

  // === 一括フェード設定 ===
  setBulkFadeIn: (enabled: boolean) => void;
  setBulkFadeOut: (enabled: boolean) => void;
  setBulkFadeInDuration: (duration: number) => void;
  setBulkFadeOutDuration: (duration: number) => void;

  // === ロック ===
  toggleLock: () => void;

  // === リセット ===
  resetCaptions: () => void;

  // === 復元 ===
  restoreFromSave: (
    captions: Caption[],
    settings: CaptionSettings,
    isLocked: boolean
  ) => void;
}

// 初期設定
const initialSettings: CaptionSettings = {
  enabled: true,
  fontSize: 'medium',
  fontStyle: 'gothic',
  fontColor: '#FFFFFF',
  strokeColor: '#000000',
  strokeWidth: 2,
  position: 'bottom',
  blur: 0, // ぼかし強度（0=なし）
  // 一括フェード設定
  bulkFadeIn: false,
  bulkFadeOut: false,
  bulkFadeInDuration: 0.5,
  bulkFadeOutDuration: 0.5,
};

// ID生成
const generateId = () => `caption_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const useCaptionStore = create<CaptionState>()(
  devtools(
    (set) => ({
      // Initial state
      captions: [],
      settings: { ...initialSettings },
      isLocked: false,

      // === キャプション操作 ===
      addCaption: (text, startTime, endTime) => {
        useLogStore.getState().info('MEDIA', 'キャプションを追加', { text: text.substring(0, 20), startTime, endTime });
        return set(
          (state) => ({
            captions: [
              ...state.captions,
              {
                id: generateId(),
                text,
                startTime,
                endTime,
                fadeIn: state.settings.bulkFadeIn,
                fadeOut: state.settings.bulkFadeOut,
                fadeInDuration: state.settings.bulkFadeInDuration,
                fadeOutDuration: state.settings.bulkFadeOutDuration,
              },
            ],
          }),
          false,
          'addCaption'
        );
      },

      updateCaption: (id, updates) =>
        set(
          (state) => ({
            captions: state.captions
              .map((c) => (c.id === id ? { ...c, ...updates } : c)),
          }),
          false,
          'updateCaption'
        ),

      removeCaption: (id) => {
        useLogStore.getState().info('MEDIA', 'キャプションを削除', { id });
        return set(
          (state) => ({
            captions: state.captions.filter((c) => c.id !== id),
          }),
          false,
          'removeCaption'
        );
      },

      moveCaption: (id, direction) =>
        set(
          (state) => {
            const idx = state.captions.findIndex((c) => c.id === id);
            if (idx < 0) return state;
            const newIdx = direction === 'up' ? idx - 1 : idx + 1;
            if (newIdx < 0 || newIdx >= state.captions.length) return state;
            const newCaptions = [...state.captions];
            [newCaptions[idx], newCaptions[newIdx]] = [newCaptions[newIdx], newCaptions[idx]];
            return { captions: newCaptions };
          },
          false,
          'moveCaption'
        ),

      clearAllCaptions: () => {
        useLogStore.getState().info('MEDIA', '全キャプションをクリア');
        return set({ captions: [] }, false, 'clearAllCaptions');
      },

      // === スタイル設定 ===
      setEnabled: (enabled) =>
        set(
          (state) => ({
            settings: { ...state.settings, enabled },
          }),
          false,
          'setEnabled'
        ),

      setFontSize: (fontSize) =>
        set(
          (state) => ({
            settings: { ...state.settings, fontSize },
          }),
          false,
          'setFontSize'
        ),

      setFontStyle: (fontStyle) =>
        set(
          (state) => ({
            settings: { ...state.settings, fontStyle },
          }),
          false,
          'setFontStyle'
        ),

      setFontColor: (fontColor) =>
        set(
          (state) => ({
            settings: { ...state.settings, fontColor },
          }),
          false,
          'setFontColor'
        ),

      setStrokeColor: (strokeColor) =>
        set(
          (state) => ({
            settings: { ...state.settings, strokeColor },
          }),
          false,
          'setStrokeColor'
        ),

      setStrokeWidth: (strokeWidth) =>
        set(
          (state) => ({
            settings: { ...state.settings, strokeWidth },
          }),
          false,
          'setStrokeWidth'
        ),

      setPosition: (position) =>
        set(
          (state) => ({
            settings: { ...state.settings, position },
          }),
          false,
          'setPosition'
        ),

      setBlur: (blur) =>
        set(
          (state) => ({
            settings: { ...state.settings, blur },
          }),
          false,
          'setBlur'
        ),

      // === 一括フェード設定 ===
      // 要望対応: 一括設定は「個別設定がOFFのもの」に対してのみ適用し、
      // 既存の個別設定（ONになっているもの）や、決定済みの時間を勝手に変更しない。

      setBulkFadeIn: (bulkFadeIn) =>
        set(
          (state) => ({
            settings: { ...state.settings, bulkFadeIn },
          }),
          false,
          'setBulkFadeIn'
        ),

      setBulkFadeOut: (bulkFadeOut) =>
        set(
          (state) => ({
            settings: { ...state.settings, bulkFadeOut },
          }),
          false,
          'setBulkFadeOut'
        ),

      // 時間変更は settings のみ更新し、既存キャプションには連動させない
      setBulkFadeInDuration: (bulkFadeInDuration) =>
        set(
          (state) => ({
            settings: { ...state.settings, bulkFadeInDuration },
          }),
          false,
          'setBulkFadeInDuration'
        ),

      setBulkFadeOutDuration: (bulkFadeOutDuration) =>
        set(
          (state) => ({
            settings: { ...state.settings, bulkFadeOutDuration },
          }),
          false,
          'setBulkFadeOutDuration'
        ),

      // === ロック ===
      toggleLock: () =>
        set(
          (state) => ({ isLocked: !state.isLocked }),
          false,
          'toggleLock'
        ),

      // === リセット ===
      resetCaptions: () =>
        set(
          {
            captions: [],
            settings: { ...initialSettings },
            isLocked: false,
          },
          false,
          'resetCaptions'
        ),

      // === 復元 ===
      restoreFromSave: (newCaptions, newSettings, newIsLocked) =>
        set(
          {
            captions: newCaptions,
            settings: newSettings,
            isLocked: newIsLocked,
          },
          false,
          'restoreFromSave'
        ),
    }),
    { name: 'CaptionStore' }
  )
);
