/**
 * @file useAutoSave.ts
 * @author Turtle Village
 * @description 自動保存機能を提供するカスタムフック。設定に応じた間隔で自動保存を実行する。
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import { useMediaStore } from '../stores/mediaStore';
import { useAudioStore } from '../stores/audioStore';
import { useCaptionStore } from '../stores/captionStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { useLogStore } from '../stores/logStore';

/** 自動保存間隔の設定キー */
export const AUTO_SAVE_INTERVAL_KEY = 'turtle-video-auto-save-interval';
const AUTO_SAVE_INTERVAL_CHANGED_EVENT = 'turtle-video:auto-save-interval-changed';

/** 自動保存間隔オプション（分） */
export type AutoSaveIntervalOption = 0 | 1 | 2 | 5;

/** デフォルトの自動保存間隔（分） */
export const DEFAULT_AUTO_SAVE_INTERVAL: AutoSaveIntervalOption = 2;
const AUTO_SAVE_RETURN_CHECK_DELAY_MS = 80;

function isAutoSaveIntervalOption(value: number): value is AutoSaveIntervalOption {
  return value === 0 || value === 1 || value === 2 || value === 5;
}

/**
 * localStorageから自動保存間隔を取得
 */
export function getAutoSaveInterval(): AutoSaveIntervalOption {
  try {
    const stored = localStorage.getItem(AUTO_SAVE_INTERVAL_KEY);
    if (stored !== null) {
      const value = parseInt(stored, 10);
      if (isAutoSaveIntervalOption(value)) {
        return value;
      }
    }
  } catch {
    // localStorageエラーは無視
  }
  return DEFAULT_AUTO_SAVE_INTERVAL;
}

/**
 * 自動保存間隔をlocalStorageに保存
 */
export function setAutoSaveInterval(interval: AutoSaveIntervalOption): void {
  try {
    localStorage.setItem(AUTO_SAVE_INTERVAL_KEY, String(interval));
  } catch {
    // localStorageエラーは無視
  } finally {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AutoSaveIntervalOption>(AUTO_SAVE_INTERVAL_CHANGED_EVENT, {
        detail: interval,
      }));
    }
  }
}

/**
 * 自動保存機能を提供するカスタムフック
 */
export function useAutoSave() {
  const intervalRef = useRef<number | null>(null);
  const catchUpSaveTimeoutRef = useRef<number | null>(null);
  const lastSaveHashRef = useRef<string>('');
  const performAutoSaveRef = useRef<() => Promise<void>>(async () => {});
  const isAutoSaveRunningRef = useRef(false);
  const lastAutoSaveAttemptAtRef = useRef<number>(Date.now());
  const [autoSaveMinutes, setAutoSaveMinutes] = useState<AutoSaveIntervalOption>(getAutoSaveInterval);
  
  // ストアからデータを取得
  const mediaItems = useMediaStore((s) => s.mediaItems);
  const isClipsLocked = useMediaStore((s) => s.isLocked);
  const bgm = useAudioStore((s) => s.bgm);
  const isBgmLocked = useAudioStore((s) => s.isBgmLocked);
  const narrations = useAudioStore((s) => s.narrations);
  const isNarrationLocked = useAudioStore((s) => s.isNarrationLocked);
  const captions = useCaptionStore((s) => s.captions);
  const captionSettings = useCaptionStore((s) => s.settings);
  const isCaptionsLocked = useCaptionStore((s) => s.isLocked);
  
  // エクスポート中かどうか
  const isProcessing = useUIStore((s) => s.isProcessing);
  
  const saveProjectAuto = useProjectStore((s) => s.saveProjectAuto);
  const lastManualSave = useProjectStore((s) => s.lastManualSave);
  
  /**
   * 現在の状態のハッシュを計算（簡易的な変更検知用）
   */
  const computeHash = useCallback(() => {
    const parts = [
      mediaItems.length,
      mediaItems.map((m) => [
        m.id,
        m.type,
        m.file?.name ?? '',
        m.volume,
        m.isMuted,
        m.fadeIn,
        m.fadeOut,
        m.fadeInDuration,
        m.fadeOutDuration,
        m.duration,
        m.originalDuration,
        m.trimStart,
        m.trimEnd,
        m.scale,
        m.positionX,
        m.positionY,
        m.isTransformOpen,
        m.isLocked,
      ].join(':')).join(','),
      bgm ? [
        bgm.file?.name ?? '',
        bgm.url,
        bgm.blobUrl ?? '',
        bgm.startPoint,
        bgm.delay,
        bgm.volume,
        bgm.fadeIn,
        bgm.fadeOut,
        bgm.fadeInDuration,
        bgm.fadeOutDuration,
        bgm.duration,
        bgm.isAi,
      ].join(':') : 'none',
      narrations.length,
      narrations.map((n) => [
        n.id,
        n.sourceType,
        n.file?.name ?? '',
        n.url,
        n.blobUrl ?? '',
        n.startTime,
        n.volume,
        n.isMuted,
        n.duration,
        n.trimStart,
        n.trimEnd,
        n.isAiEditable,
        n.aiScript ?? '',
        n.aiVoice ?? '',
        n.aiVoiceStyle ?? '',
      ].join(':')).join(','),
      captions.length,
      captions.map((c) => [
        c.id,
        c.text,
        c.startTime,
        c.endTime,
        c.fadeIn,
        c.fadeOut,
        c.fadeInDuration,
        c.fadeOutDuration,
        c.overridePosition ?? '',
        c.overrideFontStyle ?? '',
        c.overrideFontSize ?? '',
        c.overrideFadeIn ?? '',
        c.overrideFadeOut ?? '',
        c.overrideFadeInDuration ?? '',
        c.overrideFadeOutDuration ?? '',
      ].join(':')).join(','),
      JSON.stringify(captionSettings),
      isClipsLocked,
      isBgmLocked,
      isNarrationLocked,
      isCaptionsLocked,
    ];
    return parts.join('|');
  }, [
    mediaItems,
    bgm,
    narrations,
    captions,
    captionSettings,
    isClipsLocked,
    isBgmLocked,
    isNarrationLocked,
    isCaptionsLocked,
  ]);
  
  /**
   * 自動保存を実行
   */
  const performAutoSave = useCallback(async () => {
    // エクスポート中は保存をスキップ（動画品質を保護）
    if (isProcessing) {
      return;
    }
    
    const currentHash = computeHash();
    
    // 変更がない場合はスキップ
    if (currentHash === lastSaveHashRef.current) {
      return;
    }
    
    // データがない場合はスキップ
    if (mediaItems.length === 0 && !bgm && narrations.length === 0 && captions.length === 0) {
      return;
    }
    
    await saveProjectAuto(
      mediaItems,
      isClipsLocked,
      bgm,
      isBgmLocked,
      narrations,
      isNarrationLocked,
      captions,
      captionSettings,
      isCaptionsLocked
    );
    
    // 自動保存成功ログ（デバッグレベルで記録）
    useLogStore.getState().debug('SYSTEM', '自動保存を実行', {
      mediaCount: mediaItems.length,
      captionCount: captions.length,
    });
    
    lastSaveHashRef.current = currentHash;
  }, [
    computeHash,
    mediaItems,
    isClipsLocked,
    bgm,
    isBgmLocked,
    narrations,
    isNarrationLocked,
    captions,
    captionSettings,
    isCaptionsLocked,
    isProcessing,
    saveProjectAuto,
  ]);

  useEffect(() => {
    performAutoSaveRef.current = performAutoSave;
  }, [performAutoSave]);

  const runAutoSave = useCallback(async () => {
    if (useProjectStore.getState().isSaving) return;
    if (isAutoSaveRunningRef.current) return;

    isAutoSaveRunningRef.current = true;
    lastAutoSaveAttemptAtRef.current = Date.now();
    try {
      await performAutoSaveRef.current();
    } finally {
      isAutoSaveRunningRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!lastManualSave) return;
    // 手動保存直後は同一内容が保存済みなので、自動保存の差分ベースラインも更新する。
    lastSaveHashRef.current = computeHash();
    lastAutoSaveAttemptAtRef.current = Date.now();
  }, [lastManualSave, computeHash]);

  // 保存間隔の更新を即時反映（同一タブ + 他タブ）
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleIntervalChanged = (event: Event) => {
      const next = (event as CustomEvent<AutoSaveIntervalOption>).detail;
      if (typeof next === 'number' && isAutoSaveIntervalOption(next)) {
        setAutoSaveMinutes(next);
        return;
      }
      setAutoSaveMinutes(getAutoSaveInterval());
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTO_SAVE_INTERVAL_KEY) return;
      setAutoSaveMinutes(getAutoSaveInterval());
    };

    window.addEventListener(AUTO_SAVE_INTERVAL_CHANGED_EVENT, handleIntervalChanged as EventListener);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(AUTO_SAVE_INTERVAL_CHANGED_EVENT, handleIntervalChanged as EventListener);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);
  
  // 自動保存タイマーの設定
  useEffect(() => {
    // 初回起動時は少し遅延してから保存情報を更新
    const initTimeout = window.setTimeout(() => {
      useProjectStore.getState().refreshSaveInfo();
    }, 1000);
    
    // オフの場合はタイマーを設定しない
    if (autoSaveMinutes === 0) {
      return () => {
        clearTimeout(initTimeout);
      };
    }
    
    // 自動保存タイマー開始
    const intervalMs = autoSaveMinutes * 60 * 1000;
    lastAutoSaveAttemptAtRef.current = Date.now();
    intervalRef.current = window.setInterval(() => {
      void runAutoSave();
    }, intervalMs);

    const clearScheduledCatchUpSave = () => {
      if (catchUpSaveTimeoutRef.current !== null) {
        clearTimeout(catchUpSaveTimeoutRef.current);
        catchUpSaveTimeoutRef.current = null;
      }
    };

    const triggerCatchUpSave = () => {
      clearScheduledCatchUpSave();
      // visibilitychange / focus / pageshow の発火順は環境依存なので、
      // 少し待ってから可視状態と手動保存状態を確定させる。
      catchUpSaveTimeoutRef.current = window.setTimeout(() => {
        catchUpSaveTimeoutRef.current = null;
        if (document.visibilityState === 'hidden') return;
        if (useProjectStore.getState().isSaving) return;
        const elapsed = Date.now() - lastAutoSaveAttemptAtRef.current;
        if (elapsed < intervalMs) return;
        void runAutoSave();
      }, AUTO_SAVE_RETURN_CHECK_DELAY_MS);
    };

    document.addEventListener('visibilitychange', triggerCatchUpSave);
    window.addEventListener('focus', triggerCatchUpSave);
    window.addEventListener('pageshow', triggerCatchUpSave);
    
    return () => {
      clearTimeout(initTimeout);
      if (intervalRef.current !== null) {
        clearInterval(intervalRef.current);
      }
      clearScheduledCatchUpSave();
      document.removeEventListener('visibilitychange', triggerCatchUpSave);
      window.removeEventListener('focus', triggerCatchUpSave);
      window.removeEventListener('pageshow', triggerCatchUpSave);
    };
  }, [autoSaveMinutes, runAutoSave]);
  
  /**
   * 自動保存間隔を更新
   */
  const updateAutoSaveInterval = useCallback((interval: AutoSaveIntervalOption) => {
    setAutoSaveInterval(interval);
    setAutoSaveMinutes(interval);
  }, []);
  
  return {
    performAutoSave: runAutoSave,
    autoSaveMinutes,
    updateAutoSaveInterval,
  };
}
