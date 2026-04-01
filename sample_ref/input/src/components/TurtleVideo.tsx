/**
 * @file TurtleVideo.tsx
 * @author Turtle Village
 * @description 動画編集アプリケーションのメインコンポーネント。タイムライン管理、再生制御、レンダリングループ、および各種セクションの統合を行う。
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';

import type { MediaItem, AudioTrack, NarrationClip, NarrationScriptLength } from '../types';
import type { SectionHelpKey } from '../constants/sectionHelp';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  VOICE_OPTIONS,
  GEMINI_API_BASE_URL,
  GEMINI_SCRIPT_MODEL,
  GEMINI_SCRIPT_FALLBACK_MODELS,
  GEMINI_TTS_MODEL,
  TTS_SAMPLE_RATE,
  SEEK_THROTTLE_MS,
} from '../constants';

// Hooks
import { useExport } from '../hooks/useExport';
import type { ExportPreparationStep } from '../hooks/useExport';
import { usePreventUnload } from '../hooks/usePreventUnload';

// Utils
import { captureCanvasAsImage } from '../utils/canvas';
import { preserveOriginalFileName, resolveAiNarrationFileName } from '../utils/fileNames';
import { saveObjectUrlWithClientFileStrategy } from '../utils/fileSave';
import { openFilesWithPicker } from '../utils/platform';
import { findActiveTimelineItem, collectPlaybackBlockingVideos } from '../utils/playbackTimeline';
import { getPlatformCapabilities } from '../utils/platform';
import {
  getFutureVideoAudioProbeTimes,
  getPreviewAudioOutputMode,
  getPreviewAudioRoutingPlan,
  getPreviewPlatformPolicy,
  getPreviewVideoSyncThreshold,
  shouldHoldVideoFrameAtClipEnd,
  shouldMuteNativeMediaElement,
  shouldReinitializeAudioRoute,
  shouldResumeAudioContextOnVisibilityReturn,
  shouldUseCaptionBlurFallback,
} from '../utils/previewPlatform';

// Zustand Stores
import { useMediaStore, useAudioStore, useUIStore, useCaptionStore, useLogStore, createNarrationClip } from '../stores';
import { useOfflineModeStore } from '../stores/offlineModeStore';

// コンポーネント
import Toast from './common/Toast';
import ErrorMessage from './common/ErrorMessage';
import MediaResourceLoader from './media/MediaResourceLoader';
import Header from './Header';
import ClipsSection from './sections/ClipsSection';
import BgmSection from './sections/BgmSection';
import NarrationSection from './sections/NarrationSection';
import CaptionSection from './sections/CaptionSection';
import PreviewSection from './sections/PreviewSection';
import AiModal from './modals/AiModal';
import SettingsModal, { getStoredApiKey } from './modals/SettingsModal';
import SaveLoadModal from './modals/SaveLoadModal';
import SectionHelpModal from './modals/SectionHelpModal';

// API キー取得関数（localStorage優先、フォールバックで環境変数）
const getApiKey = (): string => {
  const storedKey = getStoredApiKey();
  if (storedKey) return storedKey;
  return import.meta.env.VITE_GEMINI_API_KEY || '';
};

const resetNativeMediaAudioState = (mediaEl: HTMLMediaElement) => {
  mediaEl.defaultMuted = false;
  mediaEl.muted = false;
  mediaEl.volume = 1;
};

const applyPreviewAudioOutputState = (
  policy: ReturnType<typeof getPreviewPlatformPolicy>,
  mediaEl: HTMLMediaElement,
  options: {
    hasAudioNode: boolean;
    desiredVolume: number;
    audibleSourceCount: number;
    isExporting: boolean;
  },
) => {
  const sourceType = mediaEl.tagName === 'AUDIO' ? 'audio' : 'video';
  const outputMode = getPreviewAudioOutputMode(policy, {
    hasAudioNode: options.hasAudioNode,
    isExporting: options.isExporting,
    audibleSourceCount: options.audibleSourceCount,
    desiredVolume: options.desiredVolume,
    sourceType,
  });
  const shouldMuteNative =
    outputMode === 'webaudio'
      && shouldMuteNativeMediaElement(policy, {
        hasAudioNode: options.hasAudioNode,
        isExporting: options.isExporting,
      });

  if (shouldMuteNative && options.hasAudioNode) {
    // WebAudio が createMediaElementSource で要素の音声を取得済みの場合、
    // muted=true ではなく volume=0 でネイティブ出力を無音化する。
    // iOS Safari は muted=true の要素に対して音声デコード自体をスキップする
    // 最適化を行うことがあり、その場合 WebAudio グラフにも無音データしか流れない。
    // volume=0 であればデコードは維持されつつネイティブ出力のみが無音化される。
    mediaEl.defaultMuted = false;
    mediaEl.muted = false;
    mediaEl.volume = 0;
  } else {
    mediaEl.defaultMuted = shouldMuteNative;
    mediaEl.muted = shouldMuteNative;
    mediaEl.volume = outputMode === 'native'
      ? Math.max(0, Math.min(1, options.desiredVolume))
      : 1;
  }

  return outputMode;
};

const TurtleVideo: React.FC = () => {
  // 離脱防止フックを使用
  usePreventUnload();

  // === Zustand Stores ===
  // Media Store
  const mediaItems = useMediaStore((s) => s.mediaItems);
  const totalDuration = useMediaStore((s) => s.totalDuration);
  const isClipsLocked = useMediaStore((s) => s.isClipsLocked);
  const addMediaItems = useMediaStore((s) => s.addMediaItems);
  const removeMediaItem = useMediaStore((s) => s.removeMediaItem);
  const moveMediaItem = useMediaStore((s) => s.moveMediaItem);
  const setVideoDuration = useMediaStore((s) => s.setVideoDuration);
  const updateVideoTrim = useMediaStore((s) => s.updateVideoTrim);
  const updateImageDuration = useMediaStore((s) => s.updateImageDuration);
  const updateScale = useMediaStore((s) => s.updateScale);
  const updatePosition = useMediaStore((s) => s.updatePosition);
  const resetTransform = useMediaStore((s) => s.resetTransform);
  const toggleTransformPanel = useMediaStore((s) => s.toggleTransformPanel);
  const updateVolume = useMediaStore((s) => s.updateVolume);
  const toggleMute = useMediaStore((s) => s.toggleMute);
  const toggleFadeIn = useMediaStore((s) => s.toggleFadeIn);
  const toggleFadeOut = useMediaStore((s) => s.toggleFadeOut);
  const updateFadeInDuration = useMediaStore((s) => s.updateFadeInDuration);
  const updateFadeOutDuration = useMediaStore((s) => s.updateFadeOutDuration);
  const toggleItemLock = useMediaStore((s) => s.toggleItemLock);
  const toggleClipsLock = useMediaStore((s) => s.toggleClipsLock);
  const clearAllMedia = useMediaStore((s) => s.clearAllMedia);

  // Audio Store
  const bgm = useAudioStore((s) => s.bgm);
  const isBgmLocked = useAudioStore((s) => s.isBgmLocked);

  const setBgm = useAudioStore((s) => s.setBgm);
  const updateBgmStartPoint = useAudioStore((s) => s.updateBgmStartPoint);
  const updateBgmDelay = useAudioStore((s) => s.updateBgmDelay);
  const updateBgmVolume = useAudioStore((s) => s.updateBgmVolume);
  const toggleBgmFadeIn = useAudioStore((s) => s.toggleBgmFadeIn);
  const toggleBgmFadeOut = useAudioStore((s) => s.toggleBgmFadeOut);
  const updateBgmFadeInDuration = useAudioStore((s) => s.updateBgmFadeInDuration);
  const updateBgmFadeOutDuration = useAudioStore((s) => s.updateBgmFadeOutDuration);
  const toggleBgmLock = useAudioStore((s) => s.toggleBgmLock);
  const removeBgm = useAudioStore((s) => s.removeBgm);

  const narrations = useAudioStore((s) => s.narrations);
  const isNarrationLocked = useAudioStore((s) => s.isNarrationLocked);
  const addNarration = useAudioStore((s) => s.addNarration);
  const updateNarrationStartTime = useAudioStore((s) => s.updateNarrationStartTime);
  const updateNarrationVolume = useAudioStore((s) => s.updateNarrationVolume);
  const toggleNarrationMute = useAudioStore((s) => s.toggleNarrationMute);
  const updateNarrationTrim = useAudioStore((s) => s.updateNarrationTrim);
  const updateNarrationMeta = useAudioStore((s) => s.updateNarrationMeta);
  const replaceNarrationAudio = useAudioStore((s) => s.replaceNarrationAudio);
  const moveNarration = useAudioStore((s) => s.moveNarration);
  const toggleNarrationLock = useAudioStore((s) => s.toggleNarrationLock);
  const removeNarration = useAudioStore((s) => s.removeNarration);
  const clearAllAudio = useAudioStore((s) => s.clearAllAudio);

  // UI Store
  const toastMessage = useUIStore((s) => s.toastMessage);
  const errorMsg = useUIStore((s) => s.errorMsg);
  const errorCount = useUIStore((s) => s.errorCount);
  const isPlaying = useUIStore((s) => s.isPlaying);
  const currentTime = useUIStore((s) => s.currentTime);
  const isProcessing = useUIStore((s) => s.isProcessing);
  const exportUrl = useUIStore((s) => s.exportUrl);
  const exportExt = useUIStore((s) => s.exportExt);
  const showAiModal = useUIStore((s) => s.showAiModal);
  const aiPrompt = useUIStore((s) => s.aiPrompt);
  const aiScript = useUIStore((s) => s.aiScript);
  const aiVoice = useUIStore((s) => s.aiVoice);
  const aiVoiceStyle = useUIStore((s) => s.aiVoiceStyle);
  const isAiLoading = useUIStore((s) => s.isAiLoading);

  const clearToast = useUIStore((s) => s.clearToast);
  const showToast = useUIStore((s) => s.showToast);
  const setError = useUIStore((s) => s.setError);
  const clearError = useUIStore((s) => s.clearError);
  const offlineMode = useOfflineModeStore((s) => s.offlineMode);
  const play = useUIStore((s) => s.play);
  const pause = useUIStore((s) => s.pause);
  const setCurrentTime = useUIStore((s) => s.setCurrentTime);
  const setProcessing = useUIStore((s) => s.setProcessing);
  const setLoading = useUIStore((s) => s.setLoading);

  const isLoading = useUIStore((s) => s.isLoading);
  const setExportUrl = useUIStore((s) => s.setExportUrl);
  const setExportExt = useUIStore((s) => s.setExportExt);
  const clearExport = useUIStore((s) => s.clearExport);
  const openAiModal = useUIStore((s) => s.openAiModal);
  const closeAiModal = useUIStore((s) => s.closeAiModal);
  const setAiPrompt = useUIStore((s) => s.setAiPrompt);
  const setAiScript = useUIStore((s) => s.setAiScript);
  const setAiVoice = useUIStore((s) => s.setAiVoice);
  const setAiVoiceStyle = useUIStore((s) => s.setAiVoiceStyle);
  const setAiLoading = useUIStore((s) => s.setAiLoading);
  const resetUI = useUIStore((s) => s.resetUI);

  // Caption Store
  const captions = useCaptionStore((s) => s.captions);
  const captionSettings = useCaptionStore((s) => s.settings);
  const isCaptionLocked = useCaptionStore((s) => s.isLocked);
  const addCaption = useCaptionStore((s) => s.addCaption);
  const updateCaption = useCaptionStore((s) => s.updateCaption);
  const removeCaption = useCaptionStore((s) => s.removeCaption);
  const moveCaption = useCaptionStore((s) => s.moveCaption);
  const setCaptionEnabled = useCaptionStore((s) => s.setEnabled);
  const setCaptionFontSize = useCaptionStore((s) => s.setFontSize);
  const setCaptionFontStyle = useCaptionStore((s) => s.setFontStyle);
  const setCaptionPosition = useCaptionStore((s) => s.setPosition);
  const setCaptionBlur = useCaptionStore((s) => s.setBlur);
  const setBulkFadeIn = useCaptionStore((s) => s.setBulkFadeIn);
  const setBulkFadeOut = useCaptionStore((s) => s.setBulkFadeOut);
  const setBulkFadeInDuration = useCaptionStore((s) => s.setBulkFadeInDuration);
  const setBulkFadeOutDuration = useCaptionStore((s) => s.setBulkFadeOutDuration);
  const toggleCaptionLock = useCaptionStore((s) => s.toggleLock);
  const resetCaptions = useCaptionStore((s) => s.resetCaptions);

  // Log Store
  const logInfo = useLogStore((s) => s.info);
  const logWarn = useLogStore((s) => s.warn);
  const logError = useLogStore((s) => s.error);
  const logDebug = useLogStore((s) => s.debug);
  const updateMemoryStats = useLogStore((s) => s.updateMemoryStats);

  // === Local State ===
  const [reloadKey, setReloadKey] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [showProjectManager, setShowProjectManager] = useState(false);
  const [editingNarrationId, setEditingNarrationId] = useState<string | null>(null);
  const [aiScriptLength, setAiScriptLength] = useState<NarrationScriptLength>('medium');
  const [activeHelpSection, setActiveHelpSection] = useState<SectionHelpKey | null>(null);
  const [exportPreparationStep, setExportPreparationStep] = useState<ExportPreparationStep | null>(null);

  // Ref
  const mediaItemsRef = useRef<MediaItem[]>([]);
  const bgmRef = useRef<AudioTrack | null>(null);
  const narrationsRef = useRef<NarrationClip[]>([]);
  const totalDurationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaElementsRef = useRef<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>({});
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Audio Nodes
  const sourceNodesRef = useRef<Record<string, MediaElementAudioSourceNode>>({});
  const gainNodesRef = useRef<Record<string, GainNode>>({});
  const sourceElementsRef = useRef<Record<string, HTMLMediaElement>>({});
  const pendingAudioDetachTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const masterDestRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const audioRoutingModeRef = useRef<'preview' | 'export'>('preview');
  const reqIdRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const hiddenStartedAtRef = useRef<number | null>(null);
  const needsResyncAfterVisibilityRef = useRef(false);
  const audioResumeWaitFramesRef = useRef(0);
  const lastVisibilityRefreshAtRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const loopIdRef = useRef(0); // ループの世代を追跡
  const isPlayingRef = useRef(false); // 再生状態を即座に反映するRef
  const isSeekingRef = useRef(false); // シーク中フラグ
  const activeVideoIdRef = useRef<string | null>(null); // 現在再生中のビデオID
  const lastToggleTimeRef = useRef(0); // デバウンス用
  const videoRecoveryAttemptsRef = useRef<Record<string, number>>({}); // ビデオリカバリー試行時刻を追跡
  const exportPlayFailedRef = useRef<Record<string, boolean>>({}); // エクスポート中にplay()が失敗した動画を追跡
  const exportFallbackSeekAtRef = useRef<Record<string, number>>({}); // フォールバックシーク実行時刻を追跡
  const seekingVideosRef = useRef<Set<string>>(new Set()); // シーク中のビデオIDを追跡
  const lastSeekTimeRef = useRef(0); // 最後のシーク時刻（スロットリング用）
  const pendingSeekRef = useRef<number | null>(null); // 保留中のシーク位置
  const wasPlayingBeforeSeekRef = useRef(false); // シーク前の再生状態を保持
  const pendingSeekTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 保留中のシーク処理用タイマー


  const playbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null); // 再生開始待機用タイマー
  const seekSettleGenerationRef = useRef(0);
  const pendingPausedSeekWaitRef = useRef<{ cleanup: () => void } | null>(null);
  const previewAudioRouteRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const requestPreviewAudioRouteRefreshRef = useRef<() => void>(() => { });
  const detachGlobalSeekEndListenersRef = useRef<(() => void) | null>(null);
  const handleSeekEndCallbackRef = useRef<(() => void) | null>(null);
  const renderPausedPreviewFrameAtTimeRef = useRef<(targetTime: number) => void>(() => { });
  const cancelSeekPlaybackPrepareRef = useRef<(() => void) | null>(null);
  const isSeekPlaybackPreparingRef = useRef(false);
  const endFinalizedRef = useRef(false); // 終端ファイナライズ済みフラグ（遅延renderFrame競合防止）

  const captionsRef = useRef(captions);
  const captionSettingsRef = useRef(captionSettings);

  // 描画が遅延実行されても最新状態を参照できるようにする
  captionsRef.current = captions;
  captionSettingsRef.current = captionSettings;

  const platformCapabilities = useMemo(() => getPlatformCapabilities(), []);
  const previewPlatformPolicy = useMemo(
    () => getPreviewPlatformPolicy(platformCapabilities),
    [platformCapabilities]
  );
  const supportsShowSaveFilePicker = platformCapabilities.supportsShowSaveFilePicker;
  const supportsShowOpenFilePicker = platformCapabilities.supportsShowOpenFilePicker;

  const mediaTimelineRanges = useMemo(() => {
    let timelineStart = 0;
    const ranges: Record<string, { start: number; end: number }> = {};
    for (const item of mediaItems) {
      const duration = Number.isFinite(item.duration) ? Math.max(0, item.duration) : 0;
      const start = timelineStart;
      const end = start + duration;
      ranges[item.id] = { start, end };
      timelineStart = end;
    }
    return ranges;
  }, [mediaItems]);

  // Hooks
  const { startExport: startWebCodecsExport, stopExport: stopWebCodecsExport } = useExport();

  useEffect(() => {
    if (!offlineMode || !showAiModal) return;
    setEditingNarrationId(null);
    closeAiModal();
  }, [offlineMode, showAiModal, closeAiModal]);

  // --- メモリ監視（10秒ごと） ---
  useEffect(() => {
    // 初回実行
    updateMemoryStats();

    const intervalId = setInterval(() => {
      updateMemoryStats();
    }, 10000); // 10秒ごと

    return () => clearInterval(intervalId);
  }, [updateMemoryStats]);

  const cancelPendingPausedSeekWait = useCallback(() => {
    const pendingWait = pendingPausedSeekWaitRef.current;
    if (pendingWait) {
      pendingWait.cleanup();
      pendingPausedSeekWaitRef.current = null;
    }
    if (playbackTimeoutRef.current) {
      clearTimeout(playbackTimeoutRef.current);
      playbackTimeoutRef.current = null;
    }
  }, []);

  const cancelPendingSeekPlaybackPrepare = useCallback(() => {
    if (cancelSeekPlaybackPrepareRef.current) {
      cancelSeekPlaybackPrepareRef.current();
      cancelSeekPlaybackPrepareRef.current = null;
    }
    isSeekPlaybackPreparingRef.current = false;
  }, []);

  const detachGlobalSeekEndListeners = useCallback(() => {
    if (detachGlobalSeekEndListenersRef.current) {
      detachGlobalSeekEndListenersRef.current();
      detachGlobalSeekEndListenersRef.current = null;
    }
  }, []);

  const attachGlobalSeekEndListeners = useCallback(() => {
    if (detachGlobalSeekEndListenersRef.current || typeof window === 'undefined') {
      return;
    }

    const onSeekInteractionEnd = () => {
      if (!isSeekingRef.current) return;
      handleSeekEndCallbackRef.current?.();
    };

    window.addEventListener('pointerup', onSeekInteractionEnd);
    window.addEventListener('pointercancel', onSeekInteractionEnd);
    window.addEventListener('mouseup', onSeekInteractionEnd);
    window.addEventListener('touchend', onSeekInteractionEnd);
    window.addEventListener('touchcancel', onSeekInteractionEnd);
    window.addEventListener('blur', onSeekInteractionEnd);

    detachGlobalSeekEndListenersRef.current = () => {
      window.removeEventListener('pointerup', onSeekInteractionEnd);
      window.removeEventListener('pointercancel', onSeekInteractionEnd);
      window.removeEventListener('mouseup', onSeekInteractionEnd);
      window.removeEventListener('touchend', onSeekInteractionEnd);
      window.removeEventListener('touchcancel', onSeekInteractionEnd);
      window.removeEventListener('blur', onSeekInteractionEnd);
    };
  }, []);

  useEffect(() => {
    return () => {
      detachGlobalSeekEndListeners();
    };
  }, [detachGlobalSeekEndListeners]);

  useEffect(() => {
    return () => {
      cancelPendingSeekPlaybackPrepare();
    };
  }, [cancelPendingSeekPlaybackPrepare]);

  // --- Helper: 非アクティブなビデオを開始位置にリセット ---
  const resetInactiveVideos = useCallback(() => {
    for (const item of mediaItemsRef.current) {
      if (item.type === 'video' && item.id !== activeVideoIdRef.current) {
        const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
        if (videoEl) {
          // 一時停止
          if (!videoEl.paused) {
            videoEl.pause();
          }
          // 開始位置にリセット
          const startTime = item.trimStart || 0;
          if (Math.abs(videoEl.currentTime - startTime) > 0.1) {
            videoEl.currentTime = startTime;
          }
        }
      }
    }
  }, []);

  // --- Helper: renderFrame ---
  const renderFrame = useCallback(
    (time: number, isActivePlaying = false, _isExporting = false) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const currentItems = mediaItemsRef.current;
        const currentBgm = bgmRef.current;
        const currentNarrations = narrationsRef.current;

        let activeId: string | null = null;
        let localTime = 0;
        let activeIndex = -1;
        const active = findActiveTimelineItem(currentItems, time, totalDurationRef.current);
        if (active) {
          activeId = active.id;
          activeIndex = active.index;
          localTime = active.localTime;
        } else if (currentItems.length > 0) {
          // 終端付近で active 判定が欠ける瞬間（丸め誤差/更新順序差）を吸収し、
          // 最終アイテムの最終フレームを優先して描画する。
          const END_FALLBACK_TOLERANCE_SEC = 0.2;
          if (time >= totalDurationRef.current - END_FALLBACK_TOLERANCE_SEC) {
            const lastIndex = currentItems.length - 1;
            const lastItem = currentItems[lastIndex];
            activeId = lastItem.id;
            activeIndex = lastIndex;
            localTime = Math.max(0, lastItem.duration - 0.001);
          }
        }
        const holdAudioThisFrame = isActivePlaying && audioResumeWaitFramesRef.current > 0;
        const isNearTimelineStart =
          currentItems.length > 0 &&
          time <= 0.05;
        const activePreviewAudioSourceCount = (() => {
          if (!isActivePlaying || holdAudioThisFrame) {
            return 0;
          }

          let count = 0;
          if (activeIndex !== -1) {
            const activeItem = currentItems[activeIndex];
            if (activeItem?.type === 'video' && !activeItem.isMuted && activeItem.volume > 0) {
              count += 1;
            }
          }

          if (currentBgm && currentBgm.volume > 0 && time >= currentBgm.delay) {
            const trackTime = time - currentBgm.delay + currentBgm.startPoint;
            if (trackTime >= 0 && trackTime <= currentBgm.duration) {
              count += 1;
            }
          }

          for (const clip of currentNarrations) {
            if (clip.isMuted || clip.volume <= 0) {
              continue;
            }
            const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
            const trimEnd = Number.isFinite(clip.trimEnd)
              ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
              : clip.duration;
            const playableDuration = Math.max(0, trimEnd - trimStart);
            const clipTime = time - clip.startTime;
            if (clipTime >= 0 && clipTime <= playableDuration) {
              count += 1;
            }
          }

          return count;
        })();

        // シーク終端対策: time が totalDuration 以上で activeId が見つからない場合、
        // 最後のクリップの最終フレームを表示する（黒画面防止）
        // 末尾補間を含むアクティブ判定は findActiveTimelineItem 側で処理

        // アクティブな動画が未準備の場合はキャンバスをクリアせず、
        // 直前フレームを保持してブラックアウトを防止
        let holdFrame = false;
        if (activeId && activeIndex !== -1) {
          const activeItem = currentItems[activeIndex];
          if (activeItem.type === 'video') {
            const activeEl = mediaElementsRef.current[activeId] as HTMLVideoElement | undefined;
            if (!activeEl) {
              holdFrame = true;
            } else {
              const targetTime = (activeItem.trimStart || 0) + localTime;
              const isLastTimelineItem = activeIndex === currentItems.length - 1;
              const isNearTimelineEnd =
                totalDurationRef.current > 0 &&
                time >= totalDurationRef.current - 0.05;
              const safeEndTime = (activeItem.trimStart || 0) + Math.max(0, activeItem.duration - 0.001);
              const shouldForceEndFrameAlign =
                !isActivePlaying &&
                isLastTimelineItem &&
                isNearTimelineEnd;
              const exportSyncThreshold = getPreviewVideoSyncThreshold(previewPlatformPolicy, {
                isExporting: _isExporting,
                hasExportPlayFailure: false,
              });
              const hasExportPlayFailure = _isExporting && !!exportPlayFailedRef.current[activeId];
              const needsCorrection =
                _isExporting &&
                isActivePlaying &&
                !isSeekingRef.current &&
                !activeEl.seeking &&
                !activeEl.paused &&
                !hasExportPlayFailure &&
                Math.abs(activeEl.currentTime - targetTime) > exportSyncThreshold;

              if (shouldForceEndFrameAlign && activeEl.readyState >= 1 && !activeEl.seeking) {
                const endAlignThreshold = 0.0001;
                const desired = Math.min(targetTime, safeEndTime);
                const drift = Math.abs(activeEl.currentTime - desired);
                const isAhead = activeEl.currentTime > desired + endAlignThreshold;
                if (drift > endAlignThreshold || isAhead) {
                  activeEl.currentTime = desired;
                }
              }

              // readyState 0: 未ロード → クールダウン付きload()で復旧試行
              if (activeEl.readyState === 0 && !activeEl.error) {
                const now = Date.now();
                const lastAttempt = videoRecoveryAttemptsRef.current[activeId] || 0;
                if (now - lastAttempt > 2000) {
                  videoRecoveryAttemptsRef.current[activeId] = now;
                  try { activeEl.load(); } catch (e) { /* ignore */ }
                }
              }
              const hasFrame =
                activeEl.readyState >= 2 &&
                activeEl.videoWidth > 0 &&
                activeEl.videoHeight > 0 &&
                !activeEl.seeking;

              // 終端付近でビデオが自然終了(ended)した、または自然終了直前の場合、
              // play() が position 0 へのシークを発動して seeking=true にし、
              // 描画チェック(readyState>=2 && !seeking)が失敗して黒フレームが出る。
              // これを防ぐため、終端付近では ended/自然終了直前を holdFrame 扱いにする。
              const shouldHoldForVideoEnd = shouldHoldVideoFrameAtClipEnd({
                clipLocalTime: localTime,
                clipDuration: activeItem.duration,
                trimStart: activeItem.trimStart || 0,
                videoCurrentTime: activeEl.currentTime,
                videoEnded: activeEl.ended,
              });

              if (!hasFrame || needsCorrection || shouldHoldForVideoEnd) {
                holdFrame = true;
                // ブラックアウト防止発動をログ
                logInfo('RENDER', 'フレーム保持発動', {
                  videoId: activeId,
                  readyState: activeEl.readyState,
                  seeking: activeEl.seeking,
                  ended: activeEl.ended,
                  videoCT: Math.round(activeEl.currentTime * 10000) / 10000,
                  videoDur: activeEl.duration,
                  currentTime: time,
                  needsCorrection,
                  shouldHoldForVideoEnd,
                });
              }
            }
          } else if (activeItem.type === 'image') {
            const activeEl = mediaElementsRef.current[activeId] as HTMLImageElement | undefined;
            const isImageReady =
              !!activeEl &&
              activeEl.complete &&
              activeEl.naturalWidth > 0 &&
              activeEl.naturalHeight > 0;
            if (!isImageReady) {
              holdFrame = true;
            }
          }
        }

        // 終端到達直後に active 判定が一瞬取れないケースでも、黒クリアせず直前フレームを保持する。
        const shouldHoldAtTimelineEnd =
          !activeId &&
          currentItems.length > 0 &&
          totalDurationRef.current > 0 &&
          time >= totalDurationRef.current - 0.0005;

        // 非アクティブ再生（終端ファイナライズ・イベントコールバック・遅延描画）かつ
        // 終端付近のとき、黒クリアを抑止して直前フレームを保持する。
        // これにより stopAll() 後の遅延 renderFrame や handleSeeked 競合でも黒画面を防止。
        const shouldGuardNearEnd =
          !isActivePlaying &&
          currentItems.length > 0 &&
          totalDurationRef.current > 0 &&
          time >= totalDurationRef.current - 0.1;

        // 終端ファイナライズ済みの場合、後続の遅延 renderFrame による黒クリアを完全に抑止する。
        const shouldGuardAfterFinalize = endFinalizedRef.current && !isActivePlaying;

        const shouldForceStartClear = isNearTimelineStart && (
          _isExporting || (!isActivePlaying && !isPlayingRef.current)
        );
        const shouldClearCanvas = shouldForceStartClear
          || (!holdFrame && !shouldHoldAtTimelineEnd && !shouldGuardNearEnd && !shouldGuardAfterFinalize);

        if (shouldClearCanvas) {
          // 診断ログ: 終端付近で黒クリアが実行される場合、状態を記録
          if (totalDurationRef.current > 0 && time >= totalDurationRef.current - 0.5) {
            logInfo('RENDER', '終端付近で黒クリア実行', {
              time: Math.round(time * 10000) / 10000,
              totalDuration: totalDurationRef.current,
              activeId: activeId ? activeId.substring(0, 8) : null,
              activeIndex,
              holdFrame,
              shouldHoldAtTimelineEnd,
              shouldGuardNearEnd,
              shouldGuardAfterFinalize,
              isActivePlaying,
              endFinalized: endFinalizedRef.current,
            });
          }
          ctx.globalAlpha = 1.0;
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        }

        // Preload: 次のビデオを事前に準備（3秒前から開始）
        if (isActivePlaying && activeIndex !== -1 && activeIndex + 1 < currentItems.length) {
          const nextItem = currentItems[activeIndex + 1];
          if (nextItem.type === 'video') {
            const remainingTime = currentItems[activeIndex].duration - localTime;
            if (remainingTime < 3.0) {
              const nextElement = mediaElementsRef.current[nextItem.id] as HTMLVideoElement;
              if (nextElement) {
                // readyState 0: ロード未開始 → load()で読み込みを開始
                if (nextElement.readyState === 0 && !nextElement.error) {
                  try { nextElement.load(); } catch (e) { /* ignore */ }
                }
                if (nextElement.paused || nextElement.readyState < 2) {
                  const nextStart = nextItem.trimStart || 0;
                  if (Math.abs(nextElement.currentTime - nextStart) > 0.1) {
                    nextElement.currentTime = nextStart;
                  }
                }
              }
            }
          }
        }

        Object.keys(mediaElementsRef.current).forEach((id) => {
          if (id === 'bgm' || id.startsWith('narration:')) return;

          const element = mediaElementsRef.current[id];
          const gainNode = gainNodesRef.current[id];
          const conf = currentItems.find((v) => v.id === id);

          if (!element || !conf) return;

          if (id === activeId) {
            // --- アクティブなメディアの処理 ---
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              const targetTime = (conf.trimStart || 0) + localTime;
              const hasExportPlayFailure = _isExporting && !!exportPlayFailedRef.current[id];
              const syncThreshold = getPreviewVideoSyncThreshold(previewPlatformPolicy, {
                isExporting: _isExporting,
                hasExportPlayFailure,
              });

              // アクティブなビデオIDを更新
              if (isActivePlaying && activeVideoIdRef.current !== id) {
                activeVideoIdRef.current = id;
              }

              // 動画が未読み込み状態の場合はリロードを試みる（クールダウン付き）
              if (videoEl.readyState === 0 && !videoEl.error) {
                const now = Date.now();
                const lastAttempt = videoRecoveryAttemptsRef.current[id] || 0;
                if (now - lastAttempt > 2000) {
                  videoRecoveryAttemptsRef.current[id] = now;
                  try { videoEl.load(); } catch (e) { /* ignore */ }
                }
              }

              // シーク中（スライダー操作中）の処理
              const isUserSeeking = isSeekingRef.current;
              const isVideoSeeking = videoEl.seeking;

              if (isActivePlaying && !isUserSeeking) {
                // 再生中かつユーザーがシーク操作していない場合
                // 終端付近でビデオが自然終了(ended)している場合は、
                // sync と play() を抑止する。play() on ended はブラウザが
                // position 0 へシークし seeking=true になるため、
                // 直後の描画チェックが失敗して黒フレームが発生する。
                const shouldHoldVideoAtClipEnd = shouldHoldVideoFrameAtClipEnd({
                  clipLocalTime: localTime,
                  clipDuration: conf.duration,
                  trimStart: conf.trimStart || 0,
                  videoCurrentTime: videoEl.currentTime,
                  videoEnded: videoEl.ended,
                });

                const shouldUseExportFallbackSeek =
                  _isExporting &&
                  hasExportPlayFailure &&
                  videoEl.paused &&
                  !isVideoSeeking &&
                  !shouldHoldVideoAtClipEnd &&
                  Math.abs(videoEl.currentTime - targetTime) > 0.04;
                if (shouldUseExportFallbackSeek) {
                  const nowMs = Date.now();
                  const lastSeekAtMs = exportFallbackSeekAtRef.current[id] || 0;
                  // シークし過ぎると seeking 状態が連続し描画が止まるため、実行間隔を制御する。
                  if (nowMs - lastSeekAtMs >= 140) {
                    exportFallbackSeekAtRef.current[id] = nowMs;
                    videoEl.currentTime = targetTime;
                  }
                }

                // 大きなズレがあれば補正（ended不要時のみ）
                if (
                  !isVideoSeeking &&
                  !shouldHoldVideoAtClipEnd &&
                  !hasExportPlayFailure &&
                  Math.abs(videoEl.currentTime - targetTime) > syncThreshold
                ) {
                  videoEl.currentTime = targetTime;
                }
                // 一時停止していれば再生開始
                // readyState >= 1 (HAVE_METADATA) で play() を許可。
                // ブラウザはplay()呼び出しをトリガーにバッファリングを開始し、
                // データ準備完了後に再生する。readyState >= 2 を要求すると
                // paused→バッファ停滞→readyState上がらず のデッドロックが発生する。
                // ただし ended 状態のビデオへの play() は position 0 への
                // シークを発動するため、終端付近では抑止する。
                if (
                  videoEl.paused &&
                  videoEl.readyState >= 1 &&
                  !shouldHoldVideoAtClipEnd &&
                  !hasExportPlayFailure
                ) {
                  videoEl.play().then(() => {
                    if (_isExporting) {
                      delete exportPlayFailedRef.current[id];
                      delete exportFallbackSeekAtRef.current[id];
                    }
                  }).catch((err) => {
                    if (_isExporting && !exportPlayFailedRef.current[id]) {
                      exportPlayFailedRef.current[id] = true;
                      exportFallbackSeekAtRef.current[id] = 0;
                      logWarn('RENDER', 'エクスポート中の動画再生開始に失敗。シーク同期フォールバックへ切替', {
                        videoId: id,
                        error: err instanceof Error ? err.message : String(err),
                      });
                    }
                  });
                }
              } else if (!isActivePlaying && !isUserSeeking) {
                // 停止中かつユーザーがシーク操作していない場合
                if (!videoEl.paused) {
                  videoEl.pause();
                }
              }
              // isUserSeeking中はビデオの再生/停止を変更しない（syncVideoToTimeに任せる）
            } else {
              // 画像がアクティブな場合、activeVideoIdRefをクリア
              if (isActivePlaying && activeVideoIdRef.current !== null) {
                activeVideoIdRef.current = null;
              }
            }

            // 描画
            const isVideo = conf.type === 'video';
            const videoEl = element as HTMLVideoElement;
            const imgEl = element as HTMLImageElement;
            // ビデオの場合: readyState >= 2（HAVE_CURRENT_DATA）を基本とし、
            // seeking中はフレームが不確定なため描画をスキップし、前フレームを保持
            const isVideoReady = isVideo
              ? videoEl.readyState >= 2 && !videoEl.seeking
              : false;
            const isReady = isVideo ? isVideoReady : imgEl.complete;

            if (isReady) {
              let elemW = isVideo ? videoEl.videoWidth : imgEl.naturalWidth;
              let elemH = isVideo ? videoEl.videoHeight : imgEl.naturalHeight;
              if (elemW && elemH) {
                const scaleFactor = conf.scale || 1.0;
                const userX = conf.positionX || 0;
                const userY = conf.positionY || 0;

                const baseScale = Math.min(CANVAS_WIDTH / elemW, CANVAS_HEIGHT / elemH);

                ctx.save();
                ctx.translate(CANVAS_WIDTH / 2 + userX, CANVAS_HEIGHT / 2 + userY);
                ctx.scale(baseScale * scaleFactor, baseScale * scaleFactor);

                let alpha = 1.0;
                const fadeInDur = conf.fadeInDuration || 1.0;
                const fadeOutDur = conf.fadeOutDuration || 1.0;

                if (conf.fadeIn && localTime < fadeInDur) {
                  alpha = localTime / fadeInDur;
                } else if (conf.fadeOut && localTime > conf.duration - fadeOutDur) {
                  const remaining = conf.duration - localTime;
                  alpha = remaining / fadeOutDur;
                }

                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                ctx.drawImage(element as CanvasImageSource, -elemW / 2, -elemH / 2, elemW, elemH);
                ctx.restore();
                ctx.globalAlpha = 1.0;
              }
            }

            if (conf.type === 'video') {
              const videoMediaEl = element as HTMLMediaElement;
              let hasAudioNode = !!sourceNodesRef.current[id];
              const currentGainNode = gainNodesRef.current[id];
              if (isActivePlaying) {
                let vol = holdAudioThisFrame ? 0 : (conf.isMuted ? 0 : conf.volume);
                const fadeInDur = conf.fadeInDuration || 1.0;
                const fadeOutDur = conf.fadeOutDuration || 1.0;

                if (conf.fadeIn && localTime < fadeInDur) {
                  vol *= localTime / fadeInDur;
                } else if (conf.fadeOut && localTime > conf.duration - fadeOutDur) {
                  const remaining = conf.duration - localTime;
                  vol *= remaining / fadeOutDur;
                }

                if (
                  !hasAudioNode &&
                  getPreviewAudioOutputMode(previewPlatformPolicy, {
                    hasAudioNode: false,
                    isExporting: _isExporting,
                    audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                    desiredVolume: vol,
                    sourceType: 'video',
                  }) === 'webaudio'
                ) {
                  hasAudioNode = ensureAudioNodeForElement(id, videoMediaEl);
                  if (hasAudioNode && !_isExporting) {
                    requestPreviewAudioRouteRefreshRef.current();
                  }
                }

                // 音量の急激な変化を防ぐ
                const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, videoMediaEl, {
                  hasAudioNode,
                  desiredVolume: vol,
                  audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                  isExporting: _isExporting,
                });
                const effectiveGain = outputMode === 'native' ? 0 : vol;
                if (currentGainNode && audioCtxRef.current) {
                  const currentGain = currentGainNode.gain.value;
                  if (Math.abs(currentGain - effectiveGain) > 0.01) {
                    currentGainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.05);
                  }
                }
              } else {
                applyPreviewAudioOutputState(previewPlatformPolicy, videoMediaEl, {
                  hasAudioNode,
                  desiredVolume: 0,
                  audibleSourceCount: 0,
                  isExporting: _isExporting,
                });
                if (currentGainNode && audioCtxRef.current) {
                  currentGainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
                }
              }
            }
          } else {
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              if (!videoEl.paused) {
                videoEl.pause();
              }
              applyPreviewAudioOutputState(previewPlatformPolicy, videoEl, {
                hasAudioNode: !!sourceNodesRef.current[id],
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
            }
            if (conf.type === 'video' && gainNode && audioCtxRef.current) {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
            }
          }
        });

        // キャプション描画（複数同時表示対応）
        const currentCaptions = captionsRef.current;
        const currentCaptionSettings = captionSettingsRef.current;
        if (currentCaptionSettings.enabled && currentCaptions.length > 0) {
          const activeCaptions = currentCaptions.filter(
            (c) => time >= c.startTime && time < c.endTime
          );
          for (const activeCaption of activeCaptions) {
            // フォントサイズ（個別設定優先）
            const fontSizeMap = { small: 32, medium: 48, large: 64, xlarge: 80 };
            const effectiveFontSizeKey = activeCaption.overrideFontSize ?? currentCaptionSettings.fontSize;
            const fontSize = fontSizeMap[effectiveFontSizeKey];

            // フォントファミリー（個別設定優先）
            const fontFamilyMap = {
              gothic: 'sans-serif',
              mincho: '"游明朝", "Yu Mincho", "ヒラギノ明朝 ProN", "Hiragino Mincho ProN", serif',
            };
            const effectiveFontStyle = activeCaption.overrideFontStyle ?? currentCaptionSettings.fontStyle;
            const fontFamily = fontFamilyMap[effectiveFontStyle];

            // 位置（個別設定優先）
            const effectivePosition = activeCaption.overridePosition ?? currentCaptionSettings.position;
            const padding = 50; // 画面端からの固定マージン（サイズ依存を廃止し、大文字でも端に寄せる）
            let y: number;
            if (effectivePosition === 'top') {
              y = padding + fontSize / 2;
            } else if (effectivePosition === 'center') {
              y = CANVAS_HEIGHT / 2;
            } else {
              y = CANVAS_HEIGHT - padding - fontSize / 2;
            }

            // フェードイン・フェードアウトのアルファ値計算
            const captionDuration = activeCaption.endTime - activeCaption.startTime;
            const captionLocalTime = time - activeCaption.startTime;

            // フェード設定を取得（個別設定 > 一括設定）
            // overrideFadeIn/Out: 'on' | 'off' | undefined
            // undefined の場合は一括設定を参照
            const useFadeIn = activeCaption.overrideFadeIn !== undefined
              ? activeCaption.overrideFadeIn === 'on'
              : currentCaptionSettings.bulkFadeIn;
            const useFadeOut = activeCaption.overrideFadeOut !== undefined
              ? activeCaption.overrideFadeOut === 'on'
              : currentCaptionSettings.bulkFadeOut;

            // フェード時間を取得（個別設定 > 一括設定）
            const fadeInDur = activeCaption.overrideFadeIn === 'on' && activeCaption.overrideFadeInDuration !== undefined
              ? activeCaption.overrideFadeInDuration
              : (currentCaptionSettings.bulkFadeInDuration || 1.0);
            const fadeOutDur = activeCaption.overrideFadeOut === 'on' && activeCaption.overrideFadeOutDuration !== undefined
              ? activeCaption.overrideFadeOutDuration
              : (currentCaptionSettings.bulkFadeOutDuration || 1.0);

            // フェードイン・フェードアウトのアルファ値を個別に計算
            let fadeInAlpha = 1.0;
            let fadeOutAlpha = 1.0;

            if (useFadeIn && captionLocalTime < fadeInDur) {
              fadeInAlpha = captionLocalTime / fadeInDur;
            }
            if (useFadeOut && captionLocalTime > captionDuration - fadeOutDur) {
              const remaining = captionDuration - captionLocalTime;
              fadeOutAlpha = remaining / fadeOutDur;
            }

            // 両方のアルファ値を乗算して最終的な透明度を計算
            const alpha = Math.max(0, Math.min(1, fadeInAlpha * fadeOutAlpha));

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.font = `bold ${fontSize}px ${fontFamily}`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const blurStrength = Math.max(0, currentCaptionSettings.blur);
            const centerX = CANVAS_WIDTH / 2;
            const drawCaptionGlyph = (
              x: number,
              yPos: number,
              localAlpha: number,
              options?: { stroke?: boolean; fill?: boolean }
            ) => {
              const clamped = Math.max(0, Math.min(1, localAlpha));
              if (clamped <= 0) return;
              ctx.globalAlpha = alpha * clamped;
              const drawStroke = options?.stroke ?? true;
              const drawFill = options?.fill ?? true;
              if (drawStroke) {
                ctx.strokeStyle = currentCaptionSettings.strokeColor;
                ctx.lineWidth = currentCaptionSettings.strokeWidth * 2;
                ctx.lineJoin = 'round';
                ctx.strokeText(activeCaption.text, x, yPos);
              }
              if (drawFill) {
                ctx.fillStyle = currentCaptionSettings.fontColor;
                ctx.fillText(activeCaption.text, x, yPos);
              }
            };

            if (shouldUseCaptionBlurFallback(previewPlatformPolicy, blurStrength)) {
              // iOS Safari では text + filter が安定しないため、
              // 複数オフセット描画で文字全体を拡散し、中心成分をぼかし強度に応じて減衰させる。
              const blurNorm = Math.min(1, blurStrength / 5);
              const ringCount = Math.max(3, Math.round(blurStrength * 3.5));
              const samplesPerRing = 18;
              const maxRadius = Math.max(1.5, blurStrength * 2.6);
              const totalSamples = ringCount * samplesPerRing;
              const prevComposite = ctx.globalCompositeOperation;

              // 色味が灰色化しないよう、拡散層は加算合成で色を保持する。
              ctx.globalCompositeOperation = 'lighter';

              for (let ring = 1; ring <= ringCount; ring++) {
                const radius = (ring / ringCount) * maxRadius;
                const ringWeight = Math.max(0.3, 1 - ((ring - 1) / Math.max(1, ringCount - 1)) * 0.55);
                const sampleAlpha = ((0.95 + blurNorm * 0.55) * ringWeight) / totalSamples;
                for (let i = 0; i < samplesPerRing; i++) {
                  const angle = (Math.PI * 2 * i) / samplesPerRing;
                  const offsetX = Math.cos(angle) * radius;
                  const offsetY = Math.sin(angle) * radius;
                  drawCaptionGlyph(centerX + offsetX, y + offsetY, sampleAlpha, { stroke: false, fill: true });
                }
              }

              ctx.globalCompositeOperation = prevComposite;

              // 中心成分: ぼかし強度に応じて減衰。縁取りはより強く減衰させる。
              const coreFillAlpha = Math.max(0.35, 0.88 - blurNorm * 0.45);
              const coreStrokeAlpha = Math.max(0, 0.9 - blurNorm * 1.4);

              if (coreFillAlpha > 0.01) {
                drawCaptionGlyph(centerX, y, coreFillAlpha, { stroke: false, fill: true });
              }
              if (coreStrokeAlpha > 0.01) {
                drawCaptionGlyph(centerX, y, coreStrokeAlpha, { stroke: true, fill: false });
              }
              ctx.restore();
              continue;
            }

            // 通常ブラウザは Canvas filter をそのまま利用
            ctx.filter = blurStrength > 0 ? `blur(${blurStrength}px)` : 'none';
            drawCaptionGlyph(centerX, y, 1);
            ctx.restore();
          }
        }

        // Audio Tracks
        const processAudioTrack = (track: AudioTrack | null, trackId: 'bgm') => {
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          let gainNode = gainNodesRef.current[trackId];
          let hasAudioNode = !!sourceNodesRef.current[trackId];

          if (track && element) {
            // iOS WebAudio モード: createMediaElementSource 済みの BGM 要素に対して
            // pause()/play() サイクルを避ける。iOS Safari は同サイクルで play() を
            // 不安定に reject し、途切れの原因になる。代わりに GainNode のみで制御する。
            const avoidPausePlay = hasAudioNode
              && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
              && !_isExporting;

            if (isActivePlaying) {
              if (time < track.delay) {
                applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                  hasAudioNode,
                  desiredVolume: 0,
                  audibleSourceCount: 0,
                  isExporting: _isExporting,
                });
                if (gainNode && audioCtxRef.current) {
                  gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.01);
                }
                if (!avoidPausePlay && !element.paused) element.pause();
              } else {
                let vol = track.volume;
                const trackTime = time - track.delay + track.startPoint;
                const playDuration = time - track.delay;

                if (trackTime <= track.duration) {
                  // シーク中は再生を開始しない（正確な位置からの再生を保証）
                  const needsSeek = Math.abs(element.currentTime - trackTime) > (avoidPausePlay ? 2.0 : 0.5);

                  if (needsSeek) {
                    if (avoidPausePlay) {
                      // iOS WebAudio: pause() せず currentTime のみ設定。
                      // pause → play サイクルを回避する。
                      element.currentTime = trackTime;
                    } else {
                      // シーク実行前に一時停止して位置を同期
                      if (!element.paused) {
                        element.pause();
                      }
                      element.currentTime = trackTime;
                    }
                  }

                  if (avoidPausePlay) {
                    // iOS WebAudio: pause() は呼ばない。
                    // element が paused のままなら play() を 1 回だけ試みる。
                    if (element.paused && !element.seeking && element.readyState >= 2) {
                      element.play().catch(() => { });
                    }
                  } else if (holdAudioThisFrame) {
                    // 可視復帰直後の1フレームだけ音声再開を待機して、
                    // 映像側の再開タイミングを先行させる。
                    if (!element.paused) {
                      element.pause();
                    }
                  } else if (!element.seeking && element.readyState >= 2 && element.paused) {
                    // シーク中でなく、readyStateが十分であれば再生開始
                    element.play().catch(() => { });
                  }

                  const fadeInDur = track.fadeInDuration || 1.0;
                  const fadeOutDur = track.fadeOutDuration || 1.0;

                  if (track.fadeIn && playDuration < fadeInDur) {
                    vol *= playDuration / fadeInDur;
                  }
                  if (track.fadeOut && time > totalDurationRef.current - fadeOutDur) {
                    const remaining = totalDurationRef.current - time;
                    vol *= Math.max(0, remaining / fadeOutDur);
                  }

                  // シーク中は音量を0にして音飛びを防ぐ
                  if (element.seeking || (!avoidPausePlay && holdAudioThisFrame)) {
                    vol = 0;
                  }

                  if (
                    !hasAudioNode &&
                    getPreviewAudioOutputMode(previewPlatformPolicy, {
                      hasAudioNode: false,
                      isExporting: _isExporting,
                      audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                      desiredVolume: vol,
                      sourceType: 'audio',
                    }) === 'webaudio'
                  ) {
                    hasAudioNode = ensureAudioNodeForElement(trackId, element);
                    if (hasAudioNode && !_isExporting) {
                      requestPreviewAudioRouteRefreshRef.current();
                    }
                    gainNode = gainNodesRef.current[trackId];
                  }

                  // 音量の急激な変化を防ぐ
                  const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                    hasAudioNode,
                    desiredVolume: vol,
                    audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                    isExporting: _isExporting,
                  });
                  const effectiveGain = outputMode === 'native' ? 0 : vol;
                  if (gainNode && audioCtxRef.current) {
                    const currentGain = gainNode.gain.value;
                    if (Math.abs(currentGain - effectiveGain) > 0.01) {
                      gainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.1);
                    }
                  }
                } else {
                  applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                    hasAudioNode,
                    desiredVolume: 0,
                    audibleSourceCount: 0,
                    isExporting: _isExporting,
                  });
                  if (gainNode && audioCtxRef.current) {
                    gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
                  }
                  if (!avoidPausePlay && !element.paused) element.pause();
                }
              }
            } else {
              applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                hasAudioNode,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
              if (gainNode && audioCtxRef.current) {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
              }
              if (!element.paused) element.pause();

              const trackTime = time - track.delay + track.startPoint;
              if (trackTime >= 0 && trackTime <= track.duration) {
                if (Math.abs(element.currentTime - trackTime) > 0.1) {
                  element.currentTime = trackTime;
                }
              }
            }
          }
        };

        const processNarrationClip = (clip: NarrationClip) => {
          const trackId = `narration:${clip.id}`;
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          let gainNode = gainNodesRef.current[trackId];
          let hasAudioNode = !!sourceNodesRef.current[trackId];

          if (!element) return;

          const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
          const trimEnd = Number.isFinite(clip.trimEnd) ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd)) : clip.duration;
          const playableDuration = Math.max(0, trimEnd - trimStart);
          const clipTime = time - clip.startTime;
          const sourceTime = trimStart + clipTime;
          const inRange = clipTime >= 0 && clipTime <= playableDuration;

          // iOS WebAudio モード: ナレーションも pause() を避ける
          const avoidNarPause = hasAudioNode
            && previewPlatformPolicy.muteNativeMediaWhenAudioRouted
            && !_isExporting;

          if (isActivePlaying) {
            if (!inRange) {
              applyPreviewAudioOutputState(previewPlatformPolicy, element, {
                hasAudioNode,
                desiredVolume: 0,
                audibleSourceCount: 0,
                isExporting: _isExporting,
              });
              if (gainNode && audioCtxRef.current) {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
              }
              if (!avoidNarPause && !element.paused) element.pause();
              return;
            }

            const needsSeek = Math.abs(element.currentTime - sourceTime) > (avoidNarPause ? 2.0 : 0.5);
            if (needsSeek) {
              if (avoidNarPause) {
                element.currentTime = sourceTime;
              } else {
                if (!element.paused) {
                  element.pause();
                }
                element.currentTime = sourceTime;
              }
            }

            if (avoidNarPause) {
              if (element.paused && !element.seeking && element.readyState >= 2) {
                element.play().catch(() => { });
              }
            } else if (holdAudioThisFrame) {
              if (!element.paused) {
                element.pause();
              }
            } else if (!element.seeking && element.readyState >= 2 && element.paused) {
              element.play().catch(() => { });
            }

            let vol = clip.isMuted ? 0 : clip.volume;
            if (element.seeking || holdAudioThisFrame) {
              vol = 0;
            }

            if (
              !hasAudioNode &&
              getPreviewAudioOutputMode(previewPlatformPolicy, {
                hasAudioNode: false,
                isExporting: _isExporting,
                audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
                desiredVolume: vol,
                sourceType: 'audio',
              }) === 'webaudio'
            ) {
              hasAudioNode = ensureAudioNodeForElement(trackId, element);
              if (hasAudioNode && !_isExporting) {
                requestPreviewAudioRouteRefreshRef.current();
              }
              gainNode = gainNodesRef.current[trackId];
            }

            const outputMode = applyPreviewAudioOutputState(previewPlatformPolicy, element, {
              hasAudioNode,
              desiredVolume: vol,
              audibleSourceCount: vol > 0 ? activePreviewAudioSourceCount : 0,
              isExporting: _isExporting,
            });
            const effectiveGain = outputMode === 'native' ? 0 : vol;
            if (gainNode && audioCtxRef.current) {
              const currentGain = gainNode.gain.value;
              if (Math.abs(currentGain - effectiveGain) > 0.01) {
                gainNode.gain.setTargetAtTime(effectiveGain, audioCtxRef.current.currentTime, 0.1);
              }
            }
          } else {
            applyPreviewAudioOutputState(previewPlatformPolicy, element, {
              hasAudioNode,
              desiredVolume: 0,
              audibleSourceCount: 0,
              isExporting: _isExporting,
            });
            if (gainNode && audioCtxRef.current) {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
            }
            if (!element.paused) element.pause();

            if (inRange && Math.abs(element.currentTime - sourceTime) > 0.1) {
              element.currentTime = sourceTime;
            }
          }
        };

        processAudioTrack(currentBgm, 'bgm');
        currentNarrations.forEach((clip) => processNarrationClip(clip));

        if (isActivePlaying && audioResumeWaitFramesRef.current > 0) {
          audioResumeWaitFramesRef.current -= 1;
        }
      } catch (e) {
        console.error('Render Error:', e);
      }
    },
    [captions, captionSettings, ensureAudioNodeForElement, logInfo, previewPlatformPolicy]
  );

  // --- 状態同期: Zustandの状態をRefに同期 ---
  // 目的: renderFrame等の非同期処理で最新の状態を参照できるようにする
  useEffect(() => {
    mediaItemsRef.current = mediaItems;
    totalDurationRef.current = totalDuration;
  }, [mediaItems, totalDuration]);

  // --- 再描画トリガー: メディア構成変更時のキャンバス更新 ---
  // 目的: メディアの追加・削除・リロード時にプレビューを更新
  // 補足: 削除で空になった場合も最後のフレームを残さないよう必ず再描画する
  useEffect(() => {
    if (isPlaying || isProcessing) return;

    const hasMedia = mediaItems.length > 0;
    const targetTime = hasMedia
      ? Math.max(0, Math.min(currentTimeRef.current, totalDuration))
      : 0;

    if (Math.abs(currentTimeRef.current - targetTime) > 0.001) {
      currentTimeRef.current = targetTime;
      setCurrentTime(targetTime);
    }

    // メディアがある場合のみ少し待って描画（要素準備待ち）
    const timeoutId = setTimeout(() => {
      renderFrame(targetTime, false);
    }, hasMedia ? 100 : 0);

    return () => clearTimeout(timeoutId);
  }, [mediaItems.length, totalDuration, reloadKey, isPlaying, isProcessing, renderFrame, setCurrentTime]);

  // --- BGM状態の同期 ---
  // 目的: BGMトラックの最新状態をRefに保持
  useEffect(() => {
    bgmRef.current = bgm;
  }, [bgm]);

  // --- ナレーション状態の同期 ---
  // 目的: ナレーショントラックの最新状態をRefに保持
  useEffect(() => {
    narrationsRef.current = narrations;
  }, [narrations]);

  // --- コンポーネントアンマウント時のクリーンアップ ---
  // 目的: メモリリークを防止し、リソースを適切に解放
  useEffect(() => {
    return () => {
      // Cancel animation frame
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
      }

      // Stop and close AudioContext
      if (audioCtxRef.current) {
        try {
          audioCtxRef.current.close();
        } catch (e) {
          console.error('Error closing AudioContext:', e);
        }
        audioCtxRef.current = null;
      }

      // Stop MediaRecorder
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        try {
          recorderRef.current.stop();
        } catch (e) {
          /* ignore */
        }
        recorderRef.current = null;
      }

      // Pause all media elements
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          try {
            (el as HTMLMediaElement).pause();
          } catch (e) {
            /* ignore */
          }
        }
      });

      Object.values(pendingAudioDetachTimersRef.current).forEach((timer) => {
        clearTimeout(timer);
      });
      pendingAudioDetachTimersRef.current = {};
      sourceElementsRef.current = {};
    };
  }, []);

  // タブ復帰時の自動リフレッシュ
  useEffect(() => {
    const pauseAllMediaElements = () => {
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          try {
            (el as HTMLMediaElement).pause();
          } catch {
            // ignore
          }
        }
      });
    };

    const resyncMediaElementsToCurrentTime = () => {
      const t = currentTimeRef.current;
      let accTime = 0;
      let activeVideoId: string | null = null;

      for (const item of mediaItemsRef.current) {
        const el = mediaElementsRef.current[item.id];
        if (item.type === 'video' && el) {
          const videoEl = el as HTMLVideoElement;
          if (t >= accTime && t < accTime + item.duration) {
            const localTime = t - accTime;
            const targetTime = (item.trimStart || 0) + localTime;
            if (!videoEl.seeking && videoEl.readyState >= 1 && Math.abs(videoEl.currentTime - targetTime) > 0.03) {
              try {
                videoEl.currentTime = targetTime;
              } catch {
                // ignore
              }
            }
            activeVideoId = item.id;
          } else if (!videoEl.paused) {
            try {
              videoEl.pause();
            } catch {
              // ignore
            }
          }
        }
        accTime += item.duration;
      }
      activeVideoIdRef.current = activeVideoId;

      const resyncAudioTrack = (track: AudioTrack | null, trackId: 'bgm') => {
        const el = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
        if (!track || !el) return;

        const trackTime = t - track.delay + track.startPoint;
        const inRange = trackTime >= 0 && trackTime <= track.duration;

        if (!inRange) {
          if (!el.paused) {
            try { el.pause(); } catch { /* ignore */ }
          }
          return;
        }

        // 微小ズレまで補正すると復帰直後にデコード再同期が過剰に走り、
        // 聴感上の音切れを招くため、有意なズレのみ補正する。
        const drift = Math.abs(el.currentTime - trackTime);
        if (drift > 0.08 && !el.seeking && el.readyState >= 1) {
          try {
            el.currentTime = trackTime;
          } catch {
            // ignore
          }
        }
      };

      const resyncNarrationClip = (clip: NarrationClip) => {
        const trackId = `narration:${clip.id}`;
        const el = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
        if (!el) return;

        const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
        const trimEnd = Number.isFinite(clip.trimEnd) ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd)) : clip.duration;
        const playableDuration = Math.max(0, trimEnd - trimStart);
        const clipTime = t - clip.startTime;
        const trackTime = trimStart + clipTime;
        const inRange = clipTime >= 0 && clipTime <= playableDuration;

        if (!inRange) {
          if (!el.paused) {
            try { el.pause(); } catch { /* ignore */ }
          }
          return;
        }

        const drift = Math.abs(el.currentTime - trackTime);
        if (drift > 0.08 && !el.seeking && el.readyState >= 1) {
          try {
            el.currentTime = trackTime;
          } catch {
            // ignore
          }
        }
      };

      resyncAudioTrack(bgmRef.current, 'bgm');
      narrationsRef.current.forEach((clip) => resyncNarrationClip(clip));
    };

    const restoreTimelineClockAfterHidden = (): boolean => {
      const hiddenAt = hiddenStartedAtRef.current;
      if (hiddenAt === null) return false;
      hiddenStartedAtRef.current = null;

      const hiddenDurationMs = Math.max(0, Date.now() - hiddenAt);
      if (hiddenDurationMs <= 0) return false;

      // 再生/エクスポートとも Date.now ベースなので、
      // 非アクティブ時間分を差し戻して停止/早送りを防ぐ
      if (isPlayingRef.current || isProcessing) {
        startTimeRef.current += hiddenDurationMs;
      }
      return true;
    };

    const refreshAfterReturn = () => {
      if (document.visibilityState !== 'visible') return;

      // visibilitychange / focus / pageshow が短時間に連続発火しうるため、
      // 復帰処理の重複実行を抑止する。
      const nowPerf = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (nowPerf - lastVisibilityRefreshAtRef.current < previewPlatformPolicy.visibilityRecoveryDebounceMs) return;
      lastVisibilityRefreshAtRef.current = nowPerf;

      const resumedFromHidden = restoreTimelineClockAfterHidden();

      const ctx = audioCtxRef.current;
      if (ctx) {
        const state = ctx.state as AudioContextState | 'interrupted';
        if (shouldResumeAudioContextOnVisibilityReturn(previewPlatformPolicy, state)) {
          ctx.resume()
            .then(() => {
              logInfo('AUDIO', '可視復帰時にAudioContextを再開', { from: state, to: ctx.state });
            })
            .catch((err) => {
              logWarn('AUDIO', '可視復帰時のAudioContext再開に失敗（次のユーザー操作で再試行）', {
                state,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }
      }

      const shouldKeepRunning = isPlayingRef.current || isProcessing;
      if (resumedFromHidden && shouldKeepRunning) {
        audioResumeWaitFramesRef.current = Math.max(audioResumeWaitFramesRef.current, 1);
      }

      const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));

      if (!shouldKeepRunning) {
        cancelPendingSeekPlaybackPrepare();
        cancelPendingPausedSeekWait();
        needsResyncAfterVisibilityRef.current = false;
      } else if (needsResyncAfterVisibilityRef.current) {
        resyncMediaElementsToCurrentTime();
        needsResyncAfterVisibilityRef.current = false;
      }

      requestAnimationFrame(() => {
        if (!shouldKeepRunning) {
          renderPausedPreviewFrameAtTimeRef.current(latestTime);
          return;
        }
        renderFrame(latestTime, shouldKeepRunning, isProcessing);
      });

      // 実行中（再生/エクスポート）に load() すると再生状態を壊しやすいので、停止中のみ再読み込みする
      if (!shouldKeepRunning) {
        Object.values(mediaElementsRef.current).forEach((el) => {
          if (
            (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') &&
            (el as HTMLMediaElement).readyState < 2
          ) {
            try {
              (el as HTMLMediaElement).load();
            } catch (e) {
              /* ignore */
            }
          }
        });
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenStartedAtRef.current = Date.now();
        cancelPendingSeekPlaybackPrepare();
        cancelPendingPausedSeekWait();
        if (isPlayingRef.current || isProcessing) {
          needsResyncAfterVisibilityRef.current = true;
          pauseAllMediaElements();
          // 通常再生時はタブ切替で明示的に一時停止状態へ遷移させる
          // （復帰時に自動再開せず、ユーザー操作で再開できるようにする）
          if (!isProcessing) {
            isPlayingRef.current = false;
            pause();
          }
        }
        return;
      }
      if (document.visibilityState === 'visible') {
        refreshAfterReturn();
      }
    };
    const handleWindowBlur = () => {
      if (hiddenStartedAtRef.current === null) {
        hiddenStartedAtRef.current = Date.now();
      }
      // blur が visibilitychange(hidden) より先に来る環境でも、
      // 復帰後に古い seek/canplay callback が割り込まないよう待機状態を落とす。
      cancelPendingSeekPlaybackPrepare();
      cancelPendingPausedSeekWait();
    };
    const handleWindowFocus = () => {
      refreshAfterReturn();
    };
    const handlePageShow = () => {
      refreshAfterReturn();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('pageshow', handlePageShow);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, [renderFrame, logInfo, logWarn, isProcessing, pause, previewPlatformPolicy, cancelPendingPausedSeekWait, cancelPendingSeekPlaybackPrepare]);

  // --- Audio Context ---
  const getAudioContext = useCallback(() => {
    if (!audioCtxRef.current) {
      const AC = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      audioCtxRef.current = ctx;
      masterDestRef.current = ctx.createMediaStreamDestination();
    }
    return audioCtxRef.current;
  }, []);

  // --- Gemini API Helpers ---
  const pcmToWav = useCallback((pcmData: ArrayBuffer, sampleRate: number): ArrayBuffer => {
    const numChannels = 1;
    const bitsPerSample = 16;
    const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const dataSize = pcmData.byteLength;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeString = (v: DataView, offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        v.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataSize, true);

    const pcmView = new Uint8Array(pcmData);
    const wavView = new Uint8Array(buffer, 44);
    wavView.set(pcmView);

    return buffer;
  }, []);

  const generateScript = useCallback(async () => {
    const trimmedPrompt = aiPrompt.trim();
    if (!trimmedPrompt) return;
    if (offlineMode) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('APIキーが設定されていません。右上の歯車アイコンから設定してください。');
      return;
    }
    setAiLoading(true);
    try {
      const modelsToTry = [GEMINI_SCRIPT_MODEL, ...GEMINI_SCRIPT_FALLBACK_MODELS]
        .filter((model, idx, arr) => arr.indexOf(model) === idx);
      const lengthTargetByMode: Record<NarrationScriptLength, string> = {
        short: '約5秒（20〜35文字）',
        medium: '約10秒（35〜60文字）',
        long: '約20秒（100〜140文字）',
      };
      const selectedLengthTarget = lengthTargetByMode[aiScriptLength];

      const systemInstruction = [
        'あなたは日本語の動画ナレーション原稿を作るプロです。',
        '出力は読み上げる本文のみ、1段落、1つだけ返してください。',
        '挨拶・見出し・箇条書き・注釈・引用符・絵文字は禁止です。',
        'テーマに沿って、短尺動画で使える自然な口語文にしてください。',
        '選択された長さ（短め=約5秒 / 中くらい=約10秒 / 長め=約20秒）を優先してください。',
        `文字数は${selectedLengthTarget}を目安にし、聞き取りやすい短文中心にしてください。`,
      ].join('\n');

      const userPrompt = [
        `テーマ: ${trimmedPrompt}`,
        '用途: 短い動画のナレーション',
        `希望する長さ: ${selectedLengthTarget}`,
        '出力: ナレーション本文のみ',
      ].join('\n');

      type ScriptPart = { text?: string };
      type ScriptCandidate = { content?: { parts?: ScriptPart[] } };
      type ScriptResponse = { candidates?: ScriptCandidate[] };

      const normalizeNarrationScript = (rawText: string): string => {
        const withoutFence = rawText
          .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z]*\n?/g, '').replace(/```/g, ''));
        const flattened = withoutFence
          .replace(/\r?\n+/g, ' ')
          .replace(/^(原稿案|ナレーション|台本)\s*[:：]\s*/i, '')
          .replace(/\s{2,}/g, ' ')
          .trim();
        return flattened.replace(/^[「『"']+|[」』"']+$/g, '').trim();
      };

      let lastErrorMessage = 'スクリプトの生成に失敗しました';
      for (let i = 0; i < modelsToTry.length; i++) {
        const model = modelsToTry[i];
        const hasNextModel = i < modelsToTry.length - 1;

        const response = await fetch(`${GEMINI_API_BASE_URL}/${model}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: systemInstruction }],
            },
            contents: [
              {
                parts: [{ text: userPrompt }],
              },
            ],
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({} as { error?: { message?: string } }));
          const errorMessage = errorData.error?.message || `HTTP ${response.status}: ${response.statusText}`;
          lastErrorMessage = errorMessage;
          const isModelUnavailable = /no longer available|not found|404|model.+(available|found)/i.test(errorMessage);
          if (hasNextModel && isModelUnavailable) {
            console.warn('Script model unavailable. Retrying with fallback model.', { model, errorMessage });
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as ScriptResponse;
        const rawText = (data.candidates ?? [])
          .flatMap((candidate) => candidate.content?.parts ?? [])
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .join('\n')
          .trim();
        const script = normalizeNarrationScript(rawText);

        if (script) {
          setAiScript(script);
          if (model !== GEMINI_SCRIPT_MODEL) {
            showToast('スクリプト生成モデルを自動切替して生成しました。');
          }
          return;
        }

        lastErrorMessage = 'スクリプトの生成結果が空です';
        if (hasNextModel) {
          console.warn('Script text was empty. Retrying with fallback model.', { model });
          continue;
        }
      }

      throw new Error(lastErrorMessage);
    } catch (e) {
      console.error('Script generation error:', e);
      if (e instanceof TypeError && e.message.includes('fetch')) {
        // ネットワーク系エラーは下の共通ハンドリングへフォールスルー
      } else if (e instanceof Error) {
        // Quota/Limitエラーの判定
        const lowerMsg = e.message.toLowerCase();
        if (lowerMsg.includes('quota') || lowerMsg.includes('limit') || lowerMsg.includes('429')) {
          setError('スクリプト生成のリミットに達しました。しばらく待ってから再試行してください。');
        } else {
          setError(`スクリプト生成エラー: ${e.message}`);
        }
      } else {
        setError('スクリプト生成に失敗しました');
      }
    } finally {
      setAiLoading(false);
    }
  }, [aiPrompt, aiScriptLength, offlineMode, setAiLoading, setAiScript, setError, showToast]);

  const generateSpeech = useCallback(async () => {
    if (!aiScript) return;
    if (offlineMode) return;
    const apiKey = getApiKey();
    if (!apiKey) {
      setError('APIキーが設定されていません。右上の歯車アイコンから設定してください。');
      return;
    }
    setAiLoading(true);
    try {
      const transcript = aiScript.trim();
      const styleText = aiVoiceStyle.trim();
      const normalizedStyleText = styleText
        // 先頭/末尾に括弧が入力されていても二重括弧にならないように整形
        .replace(/^[\s()（）]+/, '')
        .replace(/[\s()（）]+$/, '');
      const styleDirectiveText = normalizedStyleText ? `（${normalizedStyleText}）` : '';
      const styledText = `${styleDirectiveText}${transcript}`;
      const styledPrompt = normalizedStyleText
        ? [
            'Generate Japanese TTS audio.',
            'The leading parenthesized style directive is NOT part of narration and must never be spoken.',
            'Speak only the narration body that follows the directive.',
            'Do not add extra words.',
            `Input: ${styledText}`,
          ].join('\n')
        : `Say the following Japanese text:\n${transcript}`;
      const plainPrompt = `Say the following Japanese text:\n${transcript}`;
      const strictPrompt = `TTS the following text exactly as written. Do not add any extra words.\n${transcript}`;

      const requestTts = (text: string) =>
        fetch(`${GEMINI_API_BASE_URL}/${GEMINI_TTS_MODEL}:generateContent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          referrerPolicy: 'no-referrer',
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              responseModalities: ['AUDIO'],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName: aiVoice },
                },
              },
            },
          }),
        });

      const readTtsErrorMessage = async (res: Response): Promise<string> => {
        const errorData = await res.json().catch(() => ({} as { error?: { message?: string } }));
        return errorData.error?.message || `HTTP ${res.status}: ${res.statusText}`;
      };

      type TtsInlineData = { data?: string; mimeType?: string };
      type TtsPart = { text?: string; inlineData?: TtsInlineData; inline_data?: TtsInlineData };
      type TtsCandidate = { finishReason?: string; content?: { parts?: TtsPart[] } };
      type TtsResponse = { candidates?: TtsCandidate[]; promptFeedback?: { blockReason?: string } };
      type TtsAttempt = {
        label: 'style' | 'plain' | 'strict';
        prompt: string;
        usedStyle: boolean;
      };

      const parseTtsResponse = (data: TtsResponse) => {
        const candidates = Array.isArray(data.candidates) ? data.candidates : [];
        const parts = candidates.flatMap((candidate) => (Array.isArray(candidate.content?.parts) ? candidate.content.parts : []));
        const inlineData = parts
          .map((part) => part.inlineData ?? part.inline_data)
          .find((candidateInlineData): candidateInlineData is TtsInlineData & { data: string } =>
            typeof candidateInlineData?.data === 'string' && candidateInlineData.data.length > 0
          );
        const hasTextPart = parts.some((part) => typeof part.text === 'string' && part.text.trim().length > 0);
        const finishReason = candidates.map((candidate) => candidate.finishReason).find((reason) => !!reason);
        return {
          inlineData,
          hasTextPart,
          finishReason,
          blockReason: data.promptFeedback?.blockReason,
          partsCount: parts.length,
        };
      };

      const attempts: TtsAttempt[] = styleText
        ? [
            { label: 'style', prompt: styledPrompt, usedStyle: true },
            { label: 'plain', prompt: plainPrompt, usedStyle: false },
          ]
        : [
            { label: 'plain', prompt: plainPrompt, usedStyle: false },
            { label: 'strict', prompt: strictPrompt, usedStyle: false },
          ];

      let resolvedInlineData: (TtsInlineData & { data: string }) | null = null;
      let resolvedAttempt: TtsAttempt | null = null;
      let lastFinishReason: string | undefined;
      let lastBlockReason: string | undefined;
      let lastHttpError: string | undefined;

      for (let i = 0; i < attempts.length; i++) {
        const attempt = attempts[i];
        const hasNext = i < attempts.length - 1;
        const response = await requestTts(attempt.prompt);

        if (!response.ok) {
          const errorMessage = await readTtsErrorMessage(response);
          lastHttpError = errorMessage;
          const retryableHttpError = /model tried to generate text|only be used for tts|response modalities/i.test(errorMessage);
          if (hasNext && retryableHttpError) {
            console.warn('TTS attempt failed and will retry with fallback prompt/model.', {
              label: attempt.label,
              errorMessage,
            });
            continue;
          }
          throw new Error(errorMessage);
        }

        const data = (await response.json()) as TtsResponse;
        const parsed = parseTtsResponse(data);
        if (parsed.inlineData) {
          resolvedInlineData = parsed.inlineData;
          resolvedAttempt = attempt;
          lastFinishReason = parsed.finishReason;
          lastBlockReason = parsed.blockReason;
          break;
        }

        lastFinishReason = parsed.finishReason;
        lastBlockReason = parsed.blockReason;
        if (hasNext) {
          console.warn('TTS attempt returned no inline audio data. Retrying with fallback.', {
            label: attempt.label,
            finishReason: parsed.finishReason,
            blockReason: parsed.blockReason,
            hasTextPart: parsed.hasTextPart,
            partsCount: parsed.partsCount,
          });
          continue;
        }
      }

      if (!resolvedInlineData) {
        if (lastHttpError) {
          throw new Error(lastHttpError);
        }
        if (lastBlockReason) {
          throw new Error(`音声生成がブロックされました: ${lastBlockReason}`);
        }
        const reasonSuffix = lastFinishReason ? ` (${lastFinishReason})` : '';
        throw new Error(`音声データを取得できませんでした${reasonSuffix}`);
      }

      if (styleText && resolvedAttempt && !resolvedAttempt.usedStyle) {
        showToast('声の調子指定は適用できなかったため、通常の読み上げで生成しました。', 5000);
      }

      const binaryString = window.atob(resolvedInlineData.data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const normalizedMimeType = resolvedInlineData.mimeType?.toLowerCase() || '';
      const payloadIsWav = normalizedMimeType.includes('audio/wav') || normalizedMimeType.includes('audio/x-wav');
      const wavBuffer = payloadIsWav ? bytes.buffer : pcmToWav(bytes.buffer, TTS_SAMPLE_RATE);
      const wavBlob = new Blob([wavBuffer], { type: 'audio/wav' });
      const blobUrl = URL.createObjectURL(wavBlob);

      const audio = new Audio(blobUrl);
      audio.onloadedmetadata = () => {
        const voiceLabel = VOICE_OPTIONS.find((v) => v.id === aiVoice)?.label || 'AI音声';
        const currentNarrationName = editingNarrationId
          ? narrations.find((item) => item.id === editingNarrationId)?.file.name
          : null;
        const narrationFile = new File(
          [wavBlob],
          resolveAiNarrationFileName({
            currentName: currentNarrationName,
            voiceLabel,
          }),
          { type: 'audio/wav' },
        );
        if (editingNarrationId) {
          replaceNarrationAudio(editingNarrationId, {
            file: narrationFile,
            url: blobUrl,
            blobUrl,
            duration: audio.duration,
            sourceType: 'ai',
            isAiEditable: true,
            aiScript,
            aiVoice,
            aiVoiceStyle,
          });
          updateNarrationMeta(editingNarrationId, {
            aiScript,
            aiVoice,
            aiVoiceStyle,
          });
          setEditingNarrationId(null);
        } else {
          addNarration(
            createNarrationClip({
              file: narrationFile,
              url: blobUrl,
              blobUrl,
              duration: audio.duration,
              startTime: currentTimeRef.current,
              sourceType: 'ai',
              aiScript,
              aiVoice,
              aiVoiceStyle,
            })
          );
        }
        closeAiModal();
        clearError();
      };
      audio.onerror = () => {
        URL.revokeObjectURL(blobUrl);
        setError('生成された音声の読み込みに失敗しました');
        setAiLoading(false);
      };
    } catch (e) {
      console.error('Speech generation error:', e);
      if (e instanceof TypeError && e.message.includes('fetch')) {
        setError('ネットワークエラー: インターネット接続を確認してください');
      } else if (e instanceof Error) {
        // Quota/Limitエラーの判定
        const lowerMsg = e.message.toLowerCase();
        if (lowerMsg.includes('quota') || lowerMsg.includes('limit') || lowerMsg.includes('429')) {
          setError('音声生成のリミットに達しました。しばらく待ってから再試行してください。');
        } else {
          setError(`音声生成エラー: ${e.message}`);
        }
      } else {
        setError('音声生成に失敗しました');
      }
    } finally {
      setAiLoading(false);
    }
  }, [
    aiScript,
    aiVoice,
    aiVoiceStyle,
    editingNarrationId,
    pcmToWav,
    replaceNarrationAudio,
    updateNarrationMeta,
    addNarration,
    closeAiModal,
    clearError,
    showToast,
    setError,
    setAiLoading,
    narrations,
    offlineMode,
  ]);

  // --- アップロード処理 ---
  const processUploadedMediaFiles = useCallback((files: File[]) => {
    if (files.length === 0) return;
    const ctx = getAudioContext();
    if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
      ctx.resume().catch(console.error);
    }
    clearExport();
    addMediaItems(files);
    files.forEach(file => {
      logInfo('MEDIA', `メディア追加: ${file.name}`, {
        type: file.type.startsWith('video/') ? 'video' : 'image',
        fileName: file.name,
        fileSize: file.size,
      });
    });
  }, [getAudioContext, clearExport, addMediaItems, logInfo]);

  const handleMediaUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      try {
        const files = Array.from(e.target.files || []);
        e.target.value = '';
        processUploadedMediaFiles(files);
      } catch (err) {
        setError('メディアの読み込みエラー');
        logError('MEDIA', 'メディア読み込みエラー', { error: String(err) });
      }
    },
    [processUploadedMediaFiles, setError, logError]
  );

  const handleOpenMediaPicker = useCallback(async () => {
    if (!supportsShowOpenFilePicker) return;

    try {
      const files = await openFilesWithPicker({
        multiple: true,
        types: [
          {
            description: '動画・画像',
            accept: {
              'video/*': ['.mp4', '.mov', '.m4v', '.webm'],
              'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.heic', '.heif'],
            },
          },
        ],
      });
      processUploadedMediaFiles(files);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return;
      }
      setError('メディアの読み込みエラー');
      logError('MEDIA', 'メディアピッカー起動エラー', { error: String(err) });
    }
  }, [supportsShowOpenFilePicker, processUploadedMediaFiles, setError, logError]);

  const handleMediaElementLoaded = useCallback(
    (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => {
      if (element.tagName === 'VIDEO') {
        const videoEl = element as HTMLVideoElement;
        const duration = videoEl.duration;
        if (!isNaN(duration) && duration !== Infinity) {
          setVideoDuration(id, duration);
          // ビデオロード完了をログ
          logInfo('MEDIA', `ビデオロード完了: ${id.substring(0, 8)}...`, {
            duration: Math.round(duration * 10) / 10,
            readyState: videoEl.readyState,
            videoWidth: videoEl.videoWidth,
            videoHeight: videoEl.videoHeight
          });
        }
      }
    },
    [setVideoDuration, logInfo]
  );

  const waitForVideoMetadata = useCallback(
    async (item: MediaItem, timeoutMs: number = 5000): Promise<boolean> => {
      if (item.type !== 'video') return true;

      let videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
      if (!videoEl) {
        for (let i = 0; i < 10; i++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          if (videoEl) break;
        }
      }

      if (!videoEl) {
        logWarn('MEDIA', '動画要素の取得に失敗', { id: item.id.substring(0, 8) });
        return false;
      }

      const syncDurationFromElement = (): boolean => {
        const duration = videoEl.duration;
        if (Number.isFinite(duration) && duration > 0) {
          setVideoDuration(item.id, duration);
          return true;
        }
        return false;
      };

      if (syncDurationFromElement()) {
        return true;
      }

      if (videoEl.readyState === 0 && !videoEl.error) {
        try {
          videoEl.load();
        } catch {
          // ignore
        }
      }

      return await new Promise<boolean>((resolve) => {
        let settled = false;

        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          videoEl.removeEventListener('loadedmetadata', onReady);
          videoEl.removeEventListener('durationchange', onReady);
          videoEl.removeEventListener('canplay', onReady);
          videoEl.removeEventListener('error', onError);
          resolve(ok);
        };

        const onReady = () => {
          if (syncDurationFromElement()) {
            settle(true);
          }
        };

        const onError = () => settle(false);

        const timeoutId = setTimeout(() => settle(false), timeoutMs);
        videoEl.addEventListener('loadedmetadata', onReady);
        videoEl.addEventListener('durationchange', onReady);
        videoEl.addEventListener('canplay', onReady);
        videoEl.addEventListener('error', onError);

        onReady();
      });
    },
    [logWarn, setVideoDuration]
  );

  const ensureVideoMetadataReady = useCallback(
    async (targets: MediaItem[], fromTime: number): Promise<boolean> => {
      if (targets.length === 0) return true;

      logInfo('MEDIA', '再生前に動画メタデータ読み込み待機', {
        fromTime,
        videoCount: targets.length,
        ids: targets.map((v) => v.id.substring(0, 8)),
      });

      const results = await Promise.all(targets.map((item) => waitForVideoMetadata(item)));
      const allReady = results.every(Boolean);

      const latest = useMediaStore.getState();
      mediaItemsRef.current = latest.mediaItems;
      totalDurationRef.current = latest.totalDuration;

      if (!allReady) {
        logWarn('MEDIA', '動画メタデータの読み込み待機がタイムアウト', {
          fromTime,
          failedIds: targets
            .filter((_, index) => !results[index])
            .map((item) => item.id.substring(0, 8)),
        });
      }

      return allReady;
    },
    [logInfo, logWarn, waitForVideoMetadata]
  );

  const detachAudioNode = useCallback((id: string) => {
    if (sourceNodesRef.current[id]) {
      try {
        sourceNodesRef.current[id].disconnect();
      } catch {
        // ignore
      }
      delete sourceNodesRef.current[id];
    }
    if (gainNodesRef.current[id]) {
      try {
        gainNodesRef.current[id].disconnect();
      } catch {
        // ignore
      }
      delete gainNodesRef.current[id];
    }
    delete sourceElementsRef.current[id];
  }, []);

  function ensureAudioNodeForElement(id: string, mediaEl: HTMLMediaElement): boolean {
    const currentSourceEl = sourceElementsRef.current[id];
    const hasExistingAudioNode = !!sourceNodesRef.current[id] && !!gainNodesRef.current[id];

    if (hasExistingAudioNode && currentSourceEl === mediaEl) {
      return true;
    }

    if (hasExistingAudioNode && currentSourceEl && currentSourceEl !== mediaEl) {
      detachAudioNode(id);
    }

    try {
      const ctx = getAudioContext();
      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        ctx.resume().catch(() => { });
      }

      const source = ctx.createMediaElementSource(mediaEl);
      const gain = ctx.createGain();
      source.connect(gain);

      const initialTarget =
        audioRoutingModeRef.current === 'export' && masterDestRef.current
          ? masterDestRef.current
          : ctx.destination;
      gain.connect(initialTarget);
      gain.gain.setValueAtTime(1, ctx.currentTime);

      sourceNodesRef.current[id] = source;
      gainNodesRef.current[id] = gain;
      sourceElementsRef.current[id] = mediaEl;
      return true;
    } catch (e) {
      console.warn(`Audio node creation failed for ${id}:`, e);
      return false;
    }
  }

  const refreshPreviewAudioRoute = useCallback(async () => {
    if (!shouldReinitializeAudioRoute(previewPlatformPolicy, false)) {
      return;
    }

    const ctx = audioCtxRef.current;
    if (!ctx) {
      return;
    }

    try {
      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        await ctx.resume();
      }

      if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
        return;
      }

      await ctx.suspend();
      await ctx.resume();
      audioResumeWaitFramesRef.current = Math.max(audioResumeWaitFramesRef.current, 1);
      logInfo('AUDIO', 'iOS Safari preview 音声ルートを再初期化', {
        state: ctx.state,
      });
    } catch (err) {
      logWarn('AUDIO', 'iOS Safari preview 音声ルート再初期化に失敗', {
        error: err instanceof Error ? err.message : String(err),
        state: ctx.state,
      });
    }
  }, [logInfo, logWarn, previewPlatformPolicy]);

  const requestPreviewAudioRouteRefresh = useCallback(() => {
    if (!shouldReinitializeAudioRoute(previewPlatformPolicy, false)) {
      return;
    }

    if (previewAudioRouteRefreshInFlightRef.current) {
      return;
    }

    const refreshPromise = refreshPreviewAudioRoute().finally(() => {
      if (previewAudioRouteRefreshInFlightRef.current === refreshPromise) {
        previewAudioRouteRefreshInFlightRef.current = null;
      }
    });
    previewAudioRouteRefreshInFlightRef.current = refreshPromise;
  }, [previewPlatformPolicy, refreshPreviewAudioRoute]);

  useEffect(() => {
    requestPreviewAudioRouteRefreshRef.current = requestPreviewAudioRouteRefresh;
  }, [requestPreviewAudioRouteRefresh]);

  const preparePreviewAudioNodesForTime = useCallback((time: number): boolean => {
    if (!previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
      return false;
    }

    const currentItems = mediaItemsRef.current;
    const currentBgm = bgmRef.current;
    const currentNarrations = narrationsRef.current;
    const candidates: Array<{
      id: string;
      desiredVolume: number;
      element: HTMLMediaElement;
      sourceType: 'video' | 'audio';
    }> = [];

    const active = findActiveTimelineItem(currentItems, time, totalDurationRef.current);
    if (active && active.index !== -1) {
      const activeItem = currentItems[active.index];
      if (activeItem?.type === 'video' && !activeItem.isMuted && activeItem.volume > 0) {
        const element = mediaElementsRef.current[activeItem.id] as HTMLVideoElement | undefined;
        if (element) {
          let vol = activeItem.volume;
          const fadeInDur = activeItem.fadeInDuration || 1.0;
          const fadeOutDur = activeItem.fadeOutDuration || 1.0;

          if (activeItem.fadeIn && active.localTime < fadeInDur) {
            vol *= active.localTime / fadeInDur;
          } else if (activeItem.fadeOut && active.localTime > activeItem.duration - fadeOutDur) {
            const remaining = activeItem.duration - active.localTime;
            vol *= remaining / fadeOutDur;
          }

          if (vol > 0) {
            candidates.push({
              id: activeItem.id,
              desiredVolume: vol,
              element,
              sourceType: 'video',
            });
          }
        }
      }
    }

    if (currentBgm && currentBgm.volume > 0 && time >= currentBgm.delay) {
      const element = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
      const trackTime = time - currentBgm.delay + currentBgm.startPoint;
      const playDuration = time - currentBgm.delay;
      if (element && trackTime >= 0 && trackTime <= currentBgm.duration) {
        let vol = currentBgm.volume;
        const fadeInDur = currentBgm.fadeInDuration || 1.0;
        const fadeOutDur = currentBgm.fadeOutDuration || 1.0;

        if (currentBgm.fadeIn && playDuration < fadeInDur) {
          vol *= playDuration / fadeInDur;
        }
        if (currentBgm.fadeOut && time > totalDurationRef.current - fadeOutDur) {
          const remaining = totalDurationRef.current - time;
          vol *= Math.max(0, remaining / fadeOutDur);
        }

        if (vol > 0) {
          candidates.push({
            id: 'bgm',
            desiredVolume: vol,
            element,
            sourceType: 'audio',
          });
        }
      }
    }

    for (const clip of currentNarrations) {
      if (clip.isMuted || clip.volume <= 0) {
        continue;
      }

      const trackId = `narration:${clip.id}`;
      const element = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
      if (!element) {
        continue;
      }

      const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
      const trimEnd = Number.isFinite(clip.trimEnd)
        ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
        : clip.duration;
      const playableDuration = Math.max(0, trimEnd - trimStart);
      const clipTime = time - clip.startTime;

      if (clipTime >= 0 && clipTime <= playableDuration) {
        candidates.push({
          id: trackId,
          desiredVolume: clip.volume,
          element,
          sourceType: 'audio',
        });
      }
    }

    const routingPlan = getPreviewAudioRoutingPlan(previewPlatformPolicy, {
      isExporting: false,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        hasAudioNode: !!sourceNodesRef.current[candidate.id],
        desiredVolume: candidate.desiredVolume,
        sourceType: candidate.sourceType,
      })),
    });

    routingPlan.forEach((decision, index) => {
      if (decision.outputMode !== 'webaudio' || decision.hasAudioNode) {
        return;
      }
      ensureAudioNodeForElement(decision.id, candidates[index].element);
    });

    return routingPlan.some((decision) => decision.outputMode === 'webaudio');
  }, [ensureAudioNodeForElement, previewPlatformPolicy]);

  const preparePreviewAudioNodesForUpcomingVideos = useCallback((fromTime: number) => {
    if (!previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
      return;
    }

    const probeTimes = getFutureVideoAudioProbeTimes(mediaItemsRef.current, fromTime);
    probeTimes.forEach((probeTime) => {
      preparePreviewAudioNodesForTime(probeTime);
    });
  }, [preparePreviewAudioNodesForTime, previewPlatformPolicy]);

  const handleMediaRefAssign = useCallback(
    (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement | null) => {
      if (element) {
        const pendingTimer = pendingAudioDetachTimersRef.current[id];
        if (pendingTimer) {
          clearTimeout(pendingTimer);
          delete pendingAudioDetachTimersRef.current[id];
        }

        mediaElementsRef.current[id] = element;

        if (element.tagName === 'VIDEO' || element.tagName === 'AUDIO') {
          const mediaEl = element as HTMLMediaElement;

          // 同じidでDOM要素が入れ替わった場合のみ、既存ノードを破棄して再生成する。
          if (sourceElementsRef.current[id] && sourceElementsRef.current[id] !== mediaEl) {
            detachAudioNode(id);
          }

          if (false && !sourceNodesRef.current[id]) {
            try {
              const ctx = getAudioContext();
              // iOS Safariでは interrupted になることがあるため running 以外は復帰を試みる
              if ((ctx.state as AudioContextState | 'interrupted') !== 'running') {
                ctx.resume().catch(() => { });
              }
              const source = ctx.createMediaElementSource(element as HTMLMediaElement);
              const gain = ctx.createGain();
              source.connect(gain);
              gain.connect(ctx.destination);
              gain.gain.setValueAtTime(1, ctx.currentTime);
              sourceNodesRef.current[id] = source;
              gainNodesRef.current[id] = gain;
              sourceElementsRef.current[id] = mediaEl;
            } catch (e) {
              // MediaElementAudioSourceNodeの作成エラーはログに出力
              console.warn(`Audio node creation failed for ${id}:`, e);
            }
          }

          // iOS Safari では複数メディア同時再生時にネイティブ音声経路の競合が起きるため、
          // WebAudio 経路が確立できた要素のみネイティブ出力をミュートする。
          resetNativeMediaAudioState(mediaEl);
        }
      } else {
        delete mediaElementsRef.current[id];

        // callback ref の差し替え時に一時的に null が来ることがあるため、解放は遅延実行する。
        const timer = setTimeout(() => {
          delete pendingAudioDetachTimersRef.current[id];
          if (!mediaElementsRef.current[id]) {
            detachAudioNode(id);
          }
        }, 0);
        pendingAudioDetachTimersRef.current[id] = timer;
      }
    },
    [detachAudioNode, getAudioContext]
  );

  const handleSeeked = useCallback(() => {
    // ビデオのseekedイベントハンドラ
    // このハンドラはMediaResourceLoaderからすべてのビデオに対して共通で呼ばれるため、
    // 特定のビデオIDを知ることができない。
    // シーク中ビデオの追跡はrenderFrame内で各ビデオのseeking状態を監視して行う。
    requestAnimationFrame(() => renderFrame(
      currentTimeRef.current,
      isPlayingRef.current && !isSeekingRef.current && !isSeekPlaybackPreparingRef.current
    ));
  }, [renderFrame]);

  const handleVideoLoadedData = useCallback(() => {
    // loadeddata is not seek completion; keep current playback mode when redrawing.
    requestAnimationFrame(() => renderFrame(
      currentTimeRef.current,
      isPlayingRef.current && !isSeekingRef.current && !isSeekPlaybackPreparingRef.current
    ));
  }, [renderFrame]);

  // --- 動画トリミング更新ハンドラ ---
  // 目的: トリミングスライダー操作時に動画のカット位置を変更
  // 注意: 対象動画のみシークし、他の動画には影響しない
  const handleUpdateVideoTrim = useCallback(
    (id: string, type: 'start' | 'end', value: string) => {
      let val = parseFloat(value);
      if (isNaN(val)) val = 0;

      // ストアを更新
      updateVideoTrim(id, type, val);

      // 対象動画の再生位置をトリミング位置に合わせる
      const item = mediaItems.find((v) => v.id === id);
      if (item) {
        const el = mediaElementsRef.current[id] as HTMLVideoElement;
        if (el && el.tagName === 'VIDEO' && !el.seeking) {
          const newStart = type === 'start' ? Math.max(0, Math.min(val, item.trimEnd - 0.1)) : item.trimStart;
          const newEnd = type === 'end' ? Math.min(item.originalDuration, Math.max(val, item.trimStart + 0.1)) : item.trimEnd;
          const seekTime = type === 'start' ? newStart : Math.max(newStart, newEnd - 0.1);
          if (Number.isFinite(seekTime)) {
            el.currentTime = Math.max(0, Math.min(item.originalDuration, seekTime));
          }
        }
      }
    },
    [updateVideoTrim, mediaItems]
  );

  // --- 画像表示時間更新ハンドラ ---
  // 目的: 画像クリップの表示時間を変更
  const handleUpdateImageDuration = useCallback((id: string, newDuration: string) => {
    let val = parseFloat(newDuration);
    if (isNaN(val) || val < 0.5) val = 0.5;
    updateImageDuration(id, val);
  }, [updateImageDuration]);

  // --- スケール更新ハンドラ ---
  // 目的: メディアの拡大率を変更
  const handleUpdateMediaScale = useCallback((id: string, value: string | number) => {
    let val = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(val)) val = 1.0;
    updateScale(id, val);
  }, [updateScale]);

  // --- 位置更新ハンドラ ---
  // 目的: メディアの表示位置（X/Y座標）を変更
  const handleUpdateMediaPosition = useCallback((id: string, axis: 'x' | 'y', value: string) => {
    let val = parseFloat(value);
    if (isNaN(val)) val = 0;
    updatePosition(id, axis, val);
  }, [updatePosition]);

  // --- 設定リセットハンドラ ---
  // 目的: スケールまたは位置を初期値にリセット
  const handleResetMediaSetting = useCallback((id: string, type: 'scale' | 'x' | 'y') => {
    resetTransform(id, type);
  }, [resetTransform]);

  // --- メディア順序変更ハンドラ ---
  // 目的: クリップの再生順序を上下に移動
  const handleMoveMedia = useCallback(
    (idx: number, dir: 'up' | 'down') => {
      moveMediaItem(idx, dir);
    },
    [moveMediaItem]
  );

  // --- メディア削除ハンドラ ---
  // 目的: クリップを削除し、関連するオーディオノードを解放
  const handleRemoveMedia = useCallback((id: string) => {
    const pendingTimer = pendingAudioDetachTimersRef.current[id];
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      delete pendingAudioDetachTimersRef.current[id];
    }

    // オーディオノードを解放
    if (sourceNodesRef.current[id]) {
      try {
        sourceNodesRef.current[id].disconnect();
      } catch (e) {
        /* ignore */
      }
      delete sourceNodesRef.current[id];
    }
    if (gainNodesRef.current[id]) {
      try {
        gainNodesRef.current[id].disconnect();
      } catch (e) {
        /* ignore */
      }
      delete gainNodesRef.current[id];
    }
    delete sourceElementsRef.current[id];

    removeMediaItem(id);
    delete mediaElementsRef.current[id];
  }, [removeMediaItem]);

  // --- トランスフォームパネル開閉ハンドラ ---
  // 目的: スケール・位置設定UIの表示/非表示を切り替え
  const handleToggleTransformPanel = useCallback((id: string) => {
    toggleTransformPanel(id);
  }, [toggleTransformPanel]);

  // ==========================================================
  // オーディオトラック（BGM・ナレーション）ハンドラ
  // ==========================================================

  // --- BGMアップロードハンドラ ---
  // 目的: BGMファイルを読み込みストアに設定
  const handleBgmUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    clearExport();
    const url = URL.createObjectURL(file);
    const audio = new Audio(url);
    audio.onloadedmetadata = () => {
      setBgm({
        file,
        url,
        startPoint: 0,
        delay: 0,
        volume: 1.0,
        fadeIn: false,
        fadeOut: false,
        fadeInDuration: 2.0,
        fadeOutDuration: 2.0,
        duration: audio.duration,
        isAi: false,
      });
    };
  }, [setBgm, clearExport]);

  // --- ナレーションアップロードハンドラ ---
  // 目的: ナレーションファイルを読み込みストアに設定
  const handleNarrationUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    e.target.value = '';
    clearExport();

    const startTimeAtUpload = currentTimeRef.current;
    const loadNarrationMeta = (file: File): Promise<{ file: File; url: string; duration: number }> =>
      new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);

        audio.onloadedmetadata = () => {
          const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
          resolve({ file, url, duration });
        };

        audio.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`音声メタデータ読み込み失敗: ${file.name}`));
        };
      });

    void (async () => {
      let failedCount = 0;

      for (const file of files) {
        try {
          const { url, duration } = await loadNarrationMeta(file);
          addNarration(
            createNarrationClip({
              file,
              url,
              duration,
              startTime: startTimeAtUpload,
              sourceType: 'file',
            })
          );
        } catch {
          failedCount += 1;
        }
      }

      if (failedCount > 0) {
        showToast(`ナレーション${failedCount}件の読み込みに失敗しました`);
      }
    })();
  }, [addNarration, clearExport, showToast]);

  // --- BGM/ナレーション開始位置更新ハンドラ ---
  // 目的: オーディオトラックの再生開始位置（ファイル内の位置）を変更
  const handleUpdateBgmStart = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateBgmStartPoint(numVal);
  }, [updateBgmStartPoint]);

  // --- BGM/ナレーション遅延更新ハンドラ ---
  // 目的: オーディオトラックの開始遅延（動画開始からの秒数）を変更
  const handleUpdateBgmDelay = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateBgmDelay(numVal);
  }, [updateBgmDelay]);

  // --- BGM/ナレーション音量更新ハンドラ ---
  // 目的: オーディオトラックの音量を変更
  const handleUpdateBgmVolume = useCallback((val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateBgmVolume(numVal);
  }, [updateBgmVolume]);

  const handleUpdateNarrationStart = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateNarrationStartTime(id, numVal);
  }, [updateNarrationStartTime]);

  const handleSetNarrationStartToCurrent = useCallback((id: string) => {
    updateNarrationStartTime(id, currentTimeRef.current);
  }, [updateNarrationStartTime]);

  const handleUpdateNarrationVolume = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateNarrationVolume(id, numVal);
  }, [updateNarrationVolume]);

  const handleToggleNarrationMute = useCallback((id: string) => {
    toggleNarrationMute(id);
  }, [toggleNarrationMute]);

  const handleUpdateNarrationTrimStart = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateNarrationTrim(id, 'start', numVal);
  }, [updateNarrationTrim]);

  const handleUpdateNarrationTrimEnd = useCallback((id: string, val: string) => {
    const numVal = parseFloat(val);
    if (isNaN(numVal)) return;
    updateNarrationTrim(id, 'end', numVal);
  }, [updateNarrationTrim]);

  const handleSaveNarration = useCallback(async (id: string) => {
    const clip = narrations.find((item) => item.id === id);
    if (!clip) return;

    const sourceUrl = clip.blobUrl || clip.url;
    if (!sourceUrl) {
      showToast('保存できる音声が見つかりませんでした');
      return;
    }

    const rawName = clip.file instanceof File ? clip.file.name : clip.file.name;
    const filename = preserveOriginalFileName(rawName, 'narration.wav');

    const inferredMimeType = clip.file instanceof File && clip.file.type
      ? clip.file.type
      : 'audio/wav';
    try {
      const result = await saveObjectUrlWithClientFileStrategy({
        sourceUrl,
        descriptor: {
          filename,
          mimeType: inferredMimeType,
          description: '音声ファイル',
        },
        supportsShowSaveFilePicker,
      });

      if (result.strategy === 'file-picker') {
        window.alert('音声の保存が完了しました。');
        showToast('音声の保存が完了しました');
        return;
      }

      window.alert('音声の保存を開始しました。完了はブラウザの通知をご確認ください。');
      showToast('音声の保存を開始しました。完了はブラウザの通知をご確認ください。', 5000);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        showToast('音声の保存をキャンセルしました');
        return;
      }
      setError('音声の保存に失敗しました');
    }
  }, [narrations, setError, showToast, supportsShowSaveFilePicker]);

  const handleCloseAiModal = useCallback(() => {
    setEditingNarrationId(null);
    closeAiModal();
  }, [closeAiModal]);

  // ==========================================================
  // コアエンジン（再生制御・リソース管理）
  // ==========================================================

  // --- 全停止処理 ---
  // 目的: すべての再生を停止し、状態をリセット
  // 注意: ループID、シーク状態、アニメーションフレーム、メディア要素を全て解放
  const stopAll = useCallback(() => {
    logDebug('SYSTEM', 'stopAll呼び出し', { previousLoopId: loopIdRef.current, isPlayingRef: isPlayingRef.current });

    // ループIDをインクリメントして古いループを無効化
    loopIdRef.current += 1;
    isPlayingRef.current = false;
    audioResumeWaitFramesRef.current = 0;
    activeVideoIdRef.current = null;
    setLoading(false);

    // シーク関連の状態をリセット
    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;
    seekingVideosRef.current.clear();
    pendingSeekRef.current = null;
    exportPlayFailedRef.current = {};
    exportFallbackSeekAtRef.current = {};

    // 保留中のシーク処理タイマーをクリア
    if (pendingSeekTimeoutRef.current) {
      clearTimeout(pendingSeekTimeoutRef.current);
      pendingSeekTimeoutRef.current = null;
    }
    cancelPendingSeekPlaybackPrepare();
    detachGlobalSeekEndListeners();
    cancelPendingPausedSeekWait();

    // アニメーションフレームをキャンセル
    if (reqIdRef.current) {
      cancelAnimationFrame(reqIdRef.current);
      reqIdRef.current = null;
    }

    // メディア要素を停止（シンプルにpauseを呼ぶ）
    Object.values(mediaElementsRef.current).forEach((el) => {
      if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
        try {
          const mediaEl = el as HTMLMediaElement;
          mediaEl.pause();
          resetNativeMediaAudioState(mediaEl);
        } catch (e) {
          /* ignore */
        }
      }
    });

    const ctx = audioCtxRef.current;
    if (ctx) {
      Object.values(gainNodesRef.current).forEach((node) => {
        try {
          node.gain.cancelScheduledValues(ctx.currentTime);
        } catch (e) {
          /* ignore */
        }
      });
    }

    const hasActiveRecorder = !!(recorderRef.current && recorderRef.current.state !== 'inactive');
    if (hasActiveRecorder) {
      recorderRef.current!.stop();
    } else {
      // 再生停止など、録画セッションが存在しないケースのみ強制停止を実行
      stopWebCodecsExport();
    }
  }, [setLoading, stopWebCodecsExport, cancelPendingPausedSeekWait, detachGlobalSeekEndListeners, cancelPendingSeekPlaybackPrepare]);

  // --- Helper: 一時停止付きで関数を実行 ---
  // 目的: 編集操作時に必ず一時停止を実行してから元の処理を行う
  // 依存関係: stopAll (実行停止用), pause (UI更新用)
  const withPause = useCallback(<T extends any[]>(fn: (...args: T) => void) => {
    return (...args: T) => {
      stopAll();
      pause();
      fn(...args);
    };
  }, [stopAll, pause]);

  const pausePreviewBeforeHeaderModal = useCallback(() => {
    if (isProcessing || !isPlayingRef.current) return;
    stopAll();
    pause();
  }, [isProcessing, stopAll, pause]);

  const handleAddAiNarration = useCallback(() => {
    if (offlineMode) return;
    stopAll();
    pause();
    setEditingNarrationId(null);
    setAiScript('');
    setAiPrompt('');
    setAiScriptLength('medium');
    openAiModal();
  }, [offlineMode, openAiModal, pause, setAiPrompt, setAiScript, stopAll]);

  const handleEditAiNarration = useCallback((id: string) => {
    if (offlineMode) return;
    const target = narrations.find((clip) => clip.id === id);
    if (!target || !target.isAiEditable) return;
    const currentScript = target.aiScript ?? '';
    const inferredLength: NarrationScriptLength =
      currentScript.length <= 70 ? 'short' : currentScript.length <= 120 ? 'medium' : 'long';
    stopAll();
    pause();
    setEditingNarrationId(id);
    setAiPrompt('');
    setAiScript(currentScript);
    setAiScriptLength(inferredLength);
    setAiVoice(target.aiVoice ?? 'Aoede');
    setAiVoiceStyle(target.aiVoiceStyle ?? '');
    openAiModal();
  }, [narrations, offlineMode, openAiModal, pause, setAiPrompt, setAiScript, setAiVoice, setAiVoiceStyle, stopAll]);

  const handleOpenSettingsModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setShowSettings(true);
  }, [pausePreviewBeforeHeaderModal]);

  const handleOpenProjectManagerModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setShowProjectManager(true);
  }, [pausePreviewBeforeHeaderModal]);

  const handleOpenAppHelpModal = useCallback(() => {
    pausePreviewBeforeHeaderModal();
    setActiveHelpSection('app');
  }, [pausePreviewBeforeHeaderModal]);

  // --- 全クリア処理 ---
  // 目的: 全てのメディア・オーディオ・キャプションを削除し初期状態に戻す
  const handleClearAll = useCallback(() => {
    if (mediaItems.length === 0 && !bgm && narrations.length === 0) return;

    // 確認ダイアログを表示
    const confirmed = window.confirm('すべてのメディア、BGM、ナレーションをクリアします。よろしいですか？');
    if (!confirmed) return;

    stopAll();
    pause();
    setProcessing(false);
    Object.values(sourceNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    Object.values(gainNodesRef.current).forEach((n) => {
      try {
        n.disconnect();
      } catch (e) {
        /* ignore */
      }
    });
    sourceNodesRef.current = {};
    gainNodesRef.current = {};
    sourceElementsRef.current = {};
    Object.values(pendingAudioDetachTimersRef.current).forEach((timer) => clearTimeout(timer));
    pendingAudioDetachTimersRef.current = {};

    mediaItemsRef.current = [];
    mediaElementsRef.current = {};
    bgmRef.current = null;
    narrationsRef.current = [];

    // Zustand stores clear
    clearAllMedia();
    clearAllAudio();
    resetCaptions();
    resetUI();
    setReloadKey(0);

    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      }
    }
  }, [mediaItems, bgm, narrations, stopAll, clearAllMedia, clearAllAudio, resetCaptions, resetUI]);

  const configureAudioRouting = useCallback((isExporting: boolean) => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const dest = masterDestRef.current;
    audioRoutingModeRef.current = isExporting ? 'export' : 'preview';

    Object.keys(gainNodesRef.current).forEach((id) => {
      const gain = gainNodesRef.current[id];
      try {
        // 一旦すべての接続を解除
        gain.disconnect();

        if (isExporting && dest) {
          // エクスポート先（録音用ノード）へ接続（PC/Android の TrackProcessor 用）
          // iOS Safari では OfflineAudioContext で音声をプリレンダリングするため、
          // リアルタイムのオーディオルーティングは不要だが、
          // masterDest への接続は維持する（フォールバック用）
          gain.connect(dest);
        } else {
          // 通常再生時はスピーカーへ接続
          gain.connect(ctx.destination);
        }
      } catch (e) {
        /* ignore */
      }
    });
  }, []);

  // --- 再生ループ ---
  // 目的: 再生中にフレームを継続的に描画
  // 注意: loopIdを監視し、古いループは自動的に終了
  const loop = useCallback(
    (isExportMode: boolean, myLoopId: number) => {
      // このループが無効化されていたら終了
      if (myLoopId !== loopIdRef.current) {
        logDebug('RENDER', 'ループ終了（loopId不一致）', { myLoopId, currentLoopId: loopIdRef.current });
        return;
      }

      if (mediaItemsRef.current.length === 0) {
        logWarn('RENDER', 'ループ終了（メディアなし）', {});
        stopAll();
        return;
      }

      // 再生状態でなければ終了
      if (!isPlayingRef.current && !isExportMode) {
        logWarn('RENDER', 'ループ終了（再生状態でない）', { isPlayingRef: isPlayingRef.current, isExportMode });
        return;
      }

      // 非アクティブ中はエクスポート進行を止める（hidden時間は可視復帰時に補正）
      if (isExportMode && typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
        return;
      }

      const now = Date.now();
      const elapsed = (now - startTimeRef.current) / 1000;
      const clampedElapsed = Math.min(elapsed, totalDurationRef.current);

      if (clampedElapsed >= totalDurationRef.current) {
        if (!isExportMode) {
          const endTime = totalDurationRef.current;
          const finalizeAtEnd = () => {
            if (myLoopId !== loopIdRef.current) return;
            endFinalizedRef.current = true;
            renderFrame(endTime, false, false);
            setCurrentTime(endTime);
            currentTimeRef.current = endTime;
            stopAll();
            pause();
            // useEffect の遅延 renderFrame（100ms後）をカバーした後、ガードを自動解除
            setTimeout(() => { endFinalizedRef.current = false; }, 300);
          };

          // 終端フレームを先に確定描画してから停止し、黒フラッシュを防ぐ。
          const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
          if (lastItem?.type === 'video') {
            const videoEl = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
            if (videoEl) {
              if (videoEl.readyState === 0 && !videoEl.error) {
                try { videoEl.load(); } catch { /* ignore */ }
              }
              if (videoEl.readyState >= 1 && !videoEl.seeking) {
                const targetTime = (lastItem.trimStart || 0) + Math.max(0, lastItem.duration - 0.001);
                const endAlignThreshold = 0.0001;
                const drift = Math.abs(videoEl.currentTime - targetTime);
                const isAhead = videoEl.currentTime > targetTime + endAlignThreshold;
                if (drift > endAlignThreshold || isAhead) {
                  videoEl.currentTime = targetTime;
                }
              }
              // 停止→再生直後の経路では終端到達時に seek が残る場合があるため、
              // シーク完了を短時間待ってから最終フレームを確定する。
              if (videoEl.seeking || videoEl.readyState < 2) {
                let settled = false;
                let timeoutId: ReturnType<typeof setTimeout> | null = null;
                let maybeFinish: () => void = () => { };
                const onReady = () => {
                  maybeFinish();
                };
                const cleanup = () => {
                  videoEl.removeEventListener('seeked', onReady);
                  videoEl.removeEventListener('loadeddata', onReady);
                  videoEl.removeEventListener('canplay', onReady);
                  if (timeoutId) {
                    clearTimeout(timeoutId);
                    timeoutId = null;
                  }
                };
                const finish = () => {
                  if (settled) return;
                  settled = true;
                  cleanup();
                  finalizeAtEnd();
                };
                maybeFinish = () => {
                  if (settled) return;
                  if (myLoopId !== loopIdRef.current) {
                    settled = true;
                    cleanup();
                    return;
                  }
                  if (!videoEl.seeking && videoEl.readyState >= 2) {
                    finish();
                  }
                };
                videoEl.addEventListener('seeked', onReady);
                videoEl.addEventListener('loadeddata', onReady);
                videoEl.addEventListener('canplay', onReady);
                timeoutId = setTimeout(() => {
                  finish();
                }, 220);
                requestAnimationFrame(maybeFinish);
                return;
              }
            }
          }
          finalizeAtEnd();
          return;
        }
        stopAll();
        return;
      }
      setCurrentTime(clampedElapsed);
      currentTimeRef.current = clampedElapsed;
      renderFrame(clampedElapsed, true, isExportMode);
      reqIdRef.current = requestAnimationFrame(() => loop(isExportMode, myLoopId));
    },
    [stopAll, pause, setCurrentTime, renderFrame, logDebug, logWarn]
  );

  // --- エンジン起動処理 ---
  // 目的: 再生またはエクスポートを開始
  // 処理: AudioContext復帰→メディア準備→ループ開始
  const startEngine = useCallback(
    async (fromTime: number, isExportMode: boolean) => {
      logInfo('AUDIO', 'エンジン起動開始', { fromTime, isExportMode });

      const ctx = getAudioContext();
      const stateBeforeResume = ctx.state as AudioContextState | 'interrupted';
      logDebug('AUDIO', 'AudioContext状態', { state: stateBeforeResume });
      if (stateBeforeResume !== 'running') {
        let attemptState: AudioContextState | 'interrupted' = stateBeforeResume;
        for (let attempt = 1; attempt <= previewPlatformPolicy.audioContextResumeRetryCount; attempt++) {
          try {
            await ctx.resume();
          } catch (err) {
            logWarn('AUDIO', `AudioContext再開に失敗（${attempt}回目）`, {
              state: attemptState,
              error: err instanceof Error ? err.message : String(err),
            });
          }

          attemptState = ctx.state as AudioContextState | 'interrupted';
          if (attemptState === 'running') {
            break;
          }
        }

        logInfo('AUDIO', 'AudioContext再開処理後の状態', {
          before: stateBeforeResume,
          after: ctx.state,
        });
      }

      // iOS Safari では外部再生復帰後に state が running でも無音化する場合があるため、
      // ユーザー操作起点の再生開始時に一度 suspend/resume で音声経路を再初期化する。
      if (shouldReinitializeAudioRoute(previewPlatformPolicy, isExportMode)) {
        try {
          if ((ctx.state as AudioContextState | 'interrupted') === 'running') {
            await ctx.suspend();
            await ctx.resume();
            logInfo('AUDIO', 'iOS Safari 音声経路を再初期化', { state: ctx.state });
          }
        } catch (err) {
          logWarn('AUDIO', 'iOS Safari 音声経路再初期化に失敗', {
            error: err instanceof Error ? err.message : String(err),
            state: ctx.state,
          });
        }
      }

      // 既存のループとメディアを停止（これでloopIdRefがインクリメントされる）
      stopAll();

      // 新しいループIDを取得
      const myLoopId = loopIdRef.current;
      logDebug('RENDER', 'ループID取得', { myLoopId });

      // 状態をリセットしてから新しい状態を設定
      if (isExportMode) {
        setProcessing(true);
        setExportPreparationStep(1);
      } else {
        setProcessing(false);
        setExportPreparationStep(null);
        isPlayingRef.current = false;
        pause();
      }
      clearExport();

      // 終端ファイナライズガードをクリア（新しい再生セッション開始）
      endFinalizedRef.current = false;

      configureAudioRouting(isExportMode);

      // メディア要素の準備
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el.tagName === 'VIDEO' || el.tagName === 'AUDIO') {
          const mediaEl = el as HTMLMediaElement;

          // readyStateが0の場合はloadを呼ぶ
          if (mediaEl.readyState === 0) {
            try {
              mediaEl.load();
            } catch (e) {
              /* ignore */
            }
          }
        }
      });

      if (!isExportMode) {
        const blockingVideos = collectPlaybackBlockingVideos(mediaItemsRef.current, fromTime);
        if (blockingVideos.length > 0) {
          let playbackReady = false;
          setLoading(true);
          try {
            playbackReady = await ensureVideoMetadataReady(blockingVideos, fromTime);
          } finally {
            setLoading(false);
          }

          // 待機中に stopAll された場合は中断
          if (myLoopId !== loopIdRef.current) {
            return;
          }

          if (!playbackReady) {
            setError('動画の読み込みが完了していません。数秒待ってから再生してください。');
            pause();
            return;
          }
        }

        // iOS Safari の AudioContext 再初期化 (suspend/resume) は startEngine 冒頭で
        // 既に実行済み。ここで再度 refreshPreviewAudioRoute() を呼ぶと、
        // ① 2回目の suspend/resume で音声経路が不安定化する
        // ② audioResumeWaitFramesRef=1 → holdAudioThisFrame=true で
        //    ループ初回フレームで全音源が pause() される
        // いずれも再生中の途切れの原因になるため、ノード作成のみ行う。
        preparePreviewAudioNodesForTime(fromTime);

        // iOS WebAudio モード: 全ビデオ要素のオーディオノードを事前作成する。
        // 再生中にクリップが切り替わった際の ensureAudioNodeForElement →
        // requestPreviewAudioRouteRefresh (suspend/resume) を防ぎ、
        // BGM への音声経路中断を回避する。
        preparePreviewAudioNodesForUpcomingVideos(fromTime);

        isPlayingRef.current = true;
        play();
      }

      if (isExportMode) {
        setCurrentTime(fromTime);
        currentTimeRef.current = fromTime;
        mediaItemsRef.current.forEach((item) => {
          if (item.type !== 'video') return;
          const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          if (!videoEl) return;
          try {
            if (videoEl.readyState === 0 && !videoEl.error) {
              videoEl.load();
            }
            const targetTime = Number.isFinite(item.trimStart) ? Math.max(0, item.trimStart) : 0;
            if (Math.abs(videoEl.currentTime - targetTime) > 0.01) {
              videoEl.currentTime = targetTime;
            }
          } catch (e) {
            /* ignore */
          }
        });

        // エクスポート前にオーディオ要素のプリロードとシーク準備を行う
        // BGMとナレーションの開始位置（startPoint）へのシークを事前に完了させる
        const audioPreloadPromises: Promise<void>[] = [];

        const prepareAudioTrack = (track: AudioTrack | null, trackId: string): Promise<void> => {
          return new Promise((resolve) => {
            const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
            if (!track || !element) {
              resolve();
              return;
            }

            // 開始位置にシーク
            const targetTime = track.startPoint;

            // readyStateが低い場合はロード待機
            if (element.readyState < 2) {
              const handleCanPlay = () => {
                element.removeEventListener('canplay', handleCanPlay);
                // シークが必要な場合
                if (targetTime > 0 && Math.abs(element.currentTime - targetTime) > 0.1) {
                  const handleSeeked = () => {
                    element.removeEventListener('seeked', handleSeeked);
                    logDebug('AUDIO', `${trackId}プリロード完了（シーク後）`, { targetTime, actualTime: element.currentTime });
                    resolve();
                  };
                  element.addEventListener('seeked', handleSeeked, { once: true });
                  element.currentTime = targetTime;
                } else {
                  logDebug('AUDIO', `${trackId}プリロード完了`, { targetTime });
                  resolve();
                }
              };
              element.addEventListener('canplay', handleCanPlay, { once: true });
              element.load();

              // タイムアウト保険（5秒）
              setTimeout(() => {
                element.removeEventListener('canplay', handleCanPlay);
                logWarn('AUDIO', `${trackId}プリロードタイムアウト`, { readyState: element.readyState });
                resolve();
              }, 5000);
            } else {
              // 既にロード済みの場合はシークのみ
              if (targetTime > 0 && Math.abs(element.currentTime - targetTime) > 0.1) {
                const handleSeeked = () => {
                  element.removeEventListener('seeked', handleSeeked);
                  logDebug('AUDIO', `${trackId}シーク完了`, { targetTime, actualTime: element.currentTime });
                  resolve();
                };
                element.addEventListener('seeked', handleSeeked, { once: true });
                element.currentTime = targetTime;

                // タイムアウト保険（2秒）
                setTimeout(() => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                }, 2000);
              } else {
                resolve();
              }
            }
          });
        };

        // BGMとナレーションのプリロードを並列実行
        const currentBgm = bgmRef.current;
        const currentNarrations = narrationsRef.current;
        if (currentBgm) {
          audioPreloadPromises.push(prepareAudioTrack(currentBgm, 'bgm'));
        }
        currentNarrations.forEach((clip) => {
          const trackId = `narration:${clip.id}`;
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          if (!element) return;
          audioPreloadPromises.push(
            new Promise((resolve) => {
              const targetTime = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
              if (element.readyState < 2) {
                const handleCanPlay = () => {
                  element.removeEventListener('canplay', handleCanPlay);
                  if (Math.abs(element.currentTime - targetTime) > 0.1) {
                    const handleSeeked = () => {
                      element.removeEventListener('seeked', handleSeeked);
                      resolve();
                    };
                    element.addEventListener('seeked', handleSeeked, { once: true });
                    element.currentTime = targetTime;
                  } else {
                    resolve();
                  }
                };
                element.addEventListener('canplay', handleCanPlay, { once: true });
                element.load();
                setTimeout(() => {
                  element.removeEventListener('canplay', handleCanPlay);
                  resolve();
                }, 5000);
              } else if (Math.abs(element.currentTime - targetTime) > 0.1) {
                const handleSeeked = () => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                };
                element.addEventListener('seeked', handleSeeked, { once: true });
                element.currentTime = targetTime;
                setTimeout(() => {
                  element.removeEventListener('seeked', handleSeeked);
                  resolve();
                }, 2000);
              } else {
                resolve();
              }
            })
          );
        });

        // オーディオプリロード完了を待機
        if (audioPreloadPromises.length > 0) {
          logInfo('AUDIO', 'オーディオプリロード開始', {
            bgm: !!currentBgm,
            narrationCount: currentNarrations.length,
          });
          await Promise.all(audioPreloadPromises);
          logInfo('AUDIO', 'オーディオプリロード完了');
        }

        // エクスポート開始前に先頭フレームを確実に準備する。
        // これを行わないと、開始トリムがある動画で先頭フレームが未確定のまま黒フレーム化しやすい。
        const firstItem = mediaItemsRef.current[0];
        if (firstItem?.type === 'video') {
          const firstVideo = mediaElementsRef.current[firstItem.id] as HTMLVideoElement | undefined;
          if (firstVideo) {
            const targetTime = firstItem.trimStart || 0;
            try {
              if (firstVideo.readyState === 0) {
                firstVideo.load();
              }
              if (Math.abs(firstVideo.currentTime - targetTime) > 0.01) {
                firstVideo.currentTime = targetTime;
              }
            } catch {
              // ignore
            }

            await new Promise<void>((resolve) => {
              let done = false;
              const finish = () => {
                if (done) return;
                done = true;
                clearTimeout(timeoutId);
                firstVideo.removeEventListener('loadeddata', onReady);
                firstVideo.removeEventListener('canplay', onReady);
                firstVideo.removeEventListener('seeked', onReady);
                resolve();
              };
              const onReady = () => {
                const drift = Math.abs(firstVideo.currentTime - targetTime);
                if (firstVideo.readyState >= 2 && !firstVideo.seeking && drift <= 0.05) {
                  finish();
                  return;
                }
                // 目標時刻に未到達のまま ready 判定される環境があるため、待機中も再シークを試行する。
                if (!firstVideo.seeking && firstVideo.readyState >= 1 && drift > 0.05) {
                  try {
                    firstVideo.currentTime = targetTime;
                  } catch {
                    // ignore
                  }
                }
              };
              const timeoutId = setTimeout(finish, 4000);
              firstVideo.addEventListener('loadeddata', onReady);
              firstVideo.addEventListener('canplay', onReady);
              firstVideo.addEventListener('seeked', onReady);
              onReady();
            });
          }
        }

        await new Promise((r) => setTimeout(r, 200));
        renderFrame(0, false, true);
        await new Promise((r) => setTimeout(r, 100));
      } else {
        // 通常再生モード: 開始位置でフレームを描画してビデオ位置を同期
        setCurrentTime(fromTime);
        currentTimeRef.current = fromTime;

        // preparePreviewAudioNodesForTime は上で既に実行済み。
        // iOS WebAudio モードでは shouldPrimeActiveVideo = false で、
        // 動画の先行 play() をスキップする（BGM と同時に renderFrame で開始させる）。
        const iosWebAudioMode = previewPlatformPolicy.muteNativeMediaWhenAudioRouted
          && sourceNodesRef.current['bgm'];
        const shouldPrimeActiveVideo = !iosWebAudioMode;
        let t = 0;
        for (const item of mediaItemsRef.current) {
          if (fromTime >= t && fromTime < t + item.duration) {
            if (item.type === 'video') {
              const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
              if (videoEl) {
                const localTime = fromTime - t;
                const targetTime = (item.trimStart || 0) + localTime;
                videoEl.currentTime = targetTime;
                activeVideoIdRef.current = item.id;
                // 再生を開始
                if (shouldPrimeActiveVideo) {
                  videoEl.play().catch(() => { });
                }
              }
            }
            break;
          }
          t += item.duration;
        }

        // iOS WebAudio モード: BGM の play() を startEngine 内で明示的に呼ぶ。
        // renderFrame の processAudioTrack に任せると、iOS Safari の
        // play() が不安定に reject され pause/play サイクルで途切れが発生する。
        if (iosWebAudioMode) {
          const currentBgm = bgmRef.current;
          if (currentBgm) {
            const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
            if (bgmEl) {
              const trackTime = Math.max(0, fromTime - currentBgm.delay + currentBgm.startPoint);
              if (fromTime >= currentBgm.delay && trackTime <= currentBgm.duration) {
                bgmEl.currentTime = trackTime;
                bgmEl.play().catch(() => { });
              }
            }
          }
        }

        // 非アクティブビデオをtrimStart位置にリセットし、
        // 再生中のクリップ切替時に大きなシークが不要になるようにする。
        // （handleSeekEnd → proceedWithPlayback と同等のリセットで、
        //   「停止→再生」と「シーク→再生」の動作差を解消する）
        resetInactiveVideos();

        renderFrame(fromTime, false);

        // メディア要素のシーク完了を待つ
        await new Promise((r) => setTimeout(r, 50));
      }

      // awaitの間にstopAllが呼ばれていたら中止
      if (myLoopId !== loopIdRef.current) {
        return;
      }

      startTimeRef.current = Date.now() - fromTime * 1000;

      if (isExportMode && canvasRef.current && masterDestRef.current) {
        startWebCodecsExport(
          canvasRef,
          masterDestRef,
          (url, ext) => {
            setExportUrl(url);
            setExportExt(ext as 'mp4' | 'webm');
            setProcessing(false);
            setExportPreparationStep(null);
            pause();
            // エンジン停止（再生ループを止める）
            stopAll();
          },
          (message) => {
            setProcessing(false);
            setExportPreparationStep(null);
            pause();
            stopAll();
            setError(message);
          },
          {
            mediaItems: mediaItemsRef.current,
            bgm: bgmRef.current,
            narrations: narrationsRef.current,
            totalDuration: totalDurationRef.current,
            getPlaybackTimeSec: () => currentTimeRef.current,
            onPreparationStepChange: setExportPreparationStep,
            // 音声プリレンダリング完了後に再生ループを開始
            // iOS Safari ではリアルタイム音声抽出に数秒かかるため、
            // その完了を待ってからビデオキャプチャ用の再生を始める。
            // 開始時刻情報（startTimeRef）を初期化し直して、
            // 事前処理に要した時間が終了判定に混ざらないようにする。
            onAudioPreRenderComplete: () => {
              startTimeRef.current = Date.now() - fromTime * 1000;
              loop(isExportMode, myLoopId);
            },
          }
        );
      } else {
        loop(isExportMode, myLoopId);
      }
    },
    [getAudioContext, stopAll, setProcessing, setLoading, play, clearExport, configureAudioRouting, ensureVideoMetadataReady, setCurrentTime, setExportUrl, setExportExt, pause, renderFrame, loop, setError, logWarn, logInfo, logDebug, previewPlatformPolicy, preparePreviewAudioNodesForTime, preparePreviewAudioNodesForUpcomingVideos]
  );

  // --- シークバー操作ハンドラ ---
  // 目的: ユーザーがシークバーをドラッグした時にプレビューを更新
  // 設計: スロットリングで過剰なビデオシークを防止し、カクつきを軽減
  const handleSeekStart = useCallback(() => {
    cancelPendingSeekPlaybackPrepare();
    cancelPendingPausedSeekWait();
    if (isSeekingRef.current) return;

    wasPlayingBeforeSeekRef.current = isPlayingRef.current;
    isSeekingRef.current = true;
    attachGlobalSeekEndListeners();

    if (isPlayingRef.current) {
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
      }
      if (playbackTimeoutRef.current) {
        clearTimeout(playbackTimeoutRef.current);
        playbackTimeoutRef.current = null;
      }
      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && el.tagName === 'VIDEO') {
          try { (el as HTMLVideoElement).pause(); } catch (e) { /* ignore */ }
        }
      });
    }
  }, [attachGlobalSeekEndListeners, cancelPendingPausedSeekWait, cancelPendingSeekPlaybackPrepare]);

  const handleSeekChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const t = parseFloat(e.target.value);
      const now = Date.now();
      endFinalizedRef.current = false;

      // シークセッション外で発火した change（Android の遅延イベント含む）は、
      // 現在の再生状態を維持したまま位置だけ同期する。
      if (!isSeekingRef.current) {
        setCurrentTime(t);
        currentTimeRef.current = t;

        if (isPlayingRef.current) {
          startTimeRef.current = now - t * 1000;
        }

        pendingSeekRef.current = null;
        if (pendingSeekTimeoutRef.current) {
          clearTimeout(pendingSeekTimeoutRef.current);
          pendingSeekTimeoutRef.current = null;
        }

        syncVideoToTime(t, { force: true });
        renderFrame(t, isPlayingRef.current && !isSeekPlaybackPreparingRef.current);
        return;
      }

      seekSettleGenerationRef.current += 1;
      cancelPendingSeekPlaybackPrepare();
      cancelPendingPausedSeekWait();

      // UI更新は常に即座に実行
      setCurrentTime(t);
      currentTimeRef.current = t;

      // スロットリング: ビデオシークは間隔を空けて実行
      const timeSinceLastSeek = now - lastSeekTimeRef.current;
      if (timeSinceLastSeek < SEEK_THROTTLE_MS) {
        // 保留中のシークを記録し、タイマーで後から処理
        pendingSeekRef.current = t;
        if (!pendingSeekTimeoutRef.current) {
          pendingSeekTimeoutRef.current = setTimeout(() => {
            pendingSeekTimeoutRef.current = null;
            if (pendingSeekRef.current !== null) {
              const pendingT = pendingSeekRef.current;
              pendingSeekRef.current = null;
              lastSeekTimeRef.current = Date.now();
              syncVideoToTime(pendingT);
              renderFrame(pendingT, false);
            }
          }, SEEK_THROTTLE_MS - timeSinceLastSeek);
        }
        // キャンバスだけは更新（画像の場合など）
        renderFrame(t, false);
        return;
      }

      lastSeekTimeRef.current = now;
      pendingSeekRef.current = null;
      if (pendingSeekTimeoutRef.current) {
        clearTimeout(pendingSeekTimeoutRef.current);
        pendingSeekTimeoutRef.current = null;
      }

      // ビデオ位置を同期してフレーム描画
      syncVideoToTime(t);
      renderFrame(t, false);
    },
    [setCurrentTime, renderFrame, cancelPendingPausedSeekWait, cancelPendingSeekPlaybackPrepare]
  );

  // --- ビデオ位置同期ヘルパー ---
  // 目的: 指定時刻に対応するビデオの再生位置を設定
  const syncVideoToTime = useCallback((t: number, options?: { force?: boolean }) => {
    const force = options?.force ?? false;
    const seekThreshold = force ? 0.01 : 0.1;
    let accTime = 0;
    for (const item of mediaItemsRef.current) {
      if (t >= accTime && t < accTime + item.duration) {
        if (item.type === 'video') {
          const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
          if (videoEl) {
            // readyState 0: 未ロード → load()でデータ取得を開始
            if (videoEl.readyState === 0 && !videoEl.error) {
              try { videoEl.load(); } catch (e) { /* ignore */ }
            }
            if (videoEl.readyState >= 1) {
              const localTime = t - accTime;
              const targetTime = (item.trimStart || 0) + localTime;
              const drift = Math.abs(videoEl.currentTime - targetTime);
              if (drift > seekThreshold && (force || !videoEl.seeking)) {
                videoEl.currentTime = targetTime;
              }
            }
          }
          activeVideoIdRef.current = item.id;
        } else {
          activeVideoIdRef.current = null;
        }
        return;
      }
      accTime += item.duration;
    }

    // シーク終端対策: t が totalDuration 以上の場合、最後のクリップの最終フレームに同期
    const items = mediaItemsRef.current;
    if (items.length > 0 && t >= totalDurationRef.current) {
      const lastItem = items[items.length - 1];
      if (lastItem.type === 'video') {
        const videoEl = mediaElementsRef.current[lastItem.id] as HTMLVideoElement;
        if (videoEl) {
          if (videoEl.readyState === 0 && !videoEl.error) {
            try { videoEl.load(); } catch (e) { /* ignore */ }
          }
          if (videoEl.readyState >= 1) {
            const targetTime = (lastItem.trimStart || 0) + Math.max(0, lastItem.duration - 0.001);
            const drift = Math.abs(videoEl.currentTime - targetTime);
            const endAlignThreshold = 0.0001;
            const shouldForceEndAlign = force || t >= totalDurationRef.current - 0.05;
            if (shouldForceEndAlign) {
              const isAhead = videoEl.currentTime > targetTime + endAlignThreshold;
              if (!videoEl.seeking && (drift > endAlignThreshold || isAhead)) {
                videoEl.currentTime = targetTime;
              }
            } else if (drift > seekThreshold && (force || !videoEl.seeking)) {
              videoEl.currentTime = targetTime;
            }
          }
        }
        activeVideoIdRef.current = lastItem.id;
      } else {
        activeVideoIdRef.current = null;
      }
      return;
    }

    activeVideoIdRef.current = null;
  }, []);

  // --- シークバー操作完了ハンドラ ---
  // 目的: シークバーのドラッグ終了時に再生を再開（必要な場合）
  const renderPausedPreviewFrameAtTime = useCallback((targetTime: number) => {
    const clampedTime = Math.max(0, Math.min(targetTime, totalDurationRef.current));
    const drawSettledFrame = (timeToDraw: number) => {
      syncVideoToTime(timeToDraw, { force: true });
      renderFrame(timeToDraw, false);
    };

    let activeVideoEl: HTMLVideoElement | null = null;
    let accTime = 0;
    for (const item of mediaItemsRef.current) {
      if (clampedTime >= accTime && clampedTime < accTime + item.duration) {
        if (item.type === 'video') {
          const el = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
          activeVideoEl = el ?? null;
        }
        break;
      }
      accTime += item.duration;
    }

    if (!activeVideoEl && mediaItemsRef.current.length > 0 && clampedTime >= totalDurationRef.current) {
      const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
      if (lastItem.type === 'video') {
        const el = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
        activeVideoEl = el ?? null;
      }
    }

    cancelPendingPausedSeekWait();

    if (activeVideoEl?.readyState === 0 && !activeVideoEl.error) {
      try {
        activeVideoEl.load();
      } catch {
        // ignore
      }
    }

    syncVideoToTime(clampedTime, { force: true });

    if (activeVideoEl && (activeVideoEl.seeking || activeVideoEl.readyState < 2)) {
      const settleGeneration = seekSettleGenerationRef.current;

      const drawIfFresh = () => {
        if (settleGeneration !== seekSettleGenerationRef.current) return;
        const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
        drawSettledFrame(latestTime);
      };

      const cleanupWait = () => {
        activeVideoEl?.removeEventListener('seeked', onPrepared);
        activeVideoEl?.removeEventListener('loadeddata', onPrepared);
        activeVideoEl?.removeEventListener('canplay', onPrepared);
        if (pendingPausedSeekWaitRef.current?.cleanup === cleanupWait) {
          pendingPausedSeekWaitRef.current = null;
        }
        if (playbackTimeoutRef.current) {
          clearTimeout(playbackTimeoutRef.current);
          playbackTimeoutRef.current = null;
        }
      };

      const onPrepared = () => {
        if (activeVideoEl?.seeking) return;
        if ((activeVideoEl?.readyState ?? 0) < 2) return;
        cleanupWait();
        drawIfFresh();
      };

      pendingPausedSeekWaitRef.current = { cleanup: cleanupWait };
      activeVideoEl.addEventListener('seeked', onPrepared);
      activeVideoEl.addEventListener('loadeddata', onPrepared);
      activeVideoEl.addEventListener('canplay', onPrepared);
      playbackTimeoutRef.current = setTimeout(() => {
        cleanupWait();
        drawIfFresh();
      }, 500);
      onPrepared();
      return;
    }

    drawSettledFrame(clampedTime);
  }, [cancelPendingPausedSeekWait, renderFrame, syncVideoToTime]);

  renderPausedPreviewFrameAtTimeRef.current = renderPausedPreviewFrameAtTime;

  const handleSeekEnd = useCallback(() => {
    // pointerup/mouseup/touchend が重複発火するため、
    // シーク中でない再入は無視して待機中の復帰処理を壊さない。
    if (!isSeekingRef.current) {
      return;
    }
    cancelPendingSeekPlaybackPrepare();
    detachGlobalSeekEndListeners();
    // 保留中のタイマーをクリア
    if (pendingSeekTimeoutRef.current) {
      clearTimeout(pendingSeekTimeoutRef.current);
      pendingSeekTimeoutRef.current = null;
    }

    // 再生待機タイムアウトと停止待ちリスナーをクリア
    cancelPendingPausedSeekWait();

    // シーク中フラグをクリア
    seekingVideosRef.current.clear();

    let t = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
    const wasPlaying = wasPlayingBeforeSeekRef.current;

    // 保留中のシークがあれば最終処理
    if (pendingSeekRef.current !== null) {
      const pendingT = Math.max(0, Math.min(pendingSeekRef.current, totalDurationRef.current));
      pendingSeekRef.current = null;
      t = pendingT;
      currentTimeRef.current = pendingT;
      setCurrentTime(pendingT);
      syncVideoToTime(pendingT, { force: true });
    }

    // シーク状態を先にリセット（重要: 以降のrenderFrameで正しく動作させるため）
    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;

    // シーク前に再生中だった場合は再開
    if (wasPlaying) {
      isSeekPlaybackPreparingRef.current = true;
      const seekGeneration = seekSettleGenerationRef.current;

      const findActiveVideoAtTime = (targetTimelineTime: number): HTMLVideoElement | null => {
        let accTime = 0;
        for (const item of mediaItemsRef.current) {
          if (targetTimelineTime >= accTime && targetTimelineTime < accTime + item.duration) {
            if (item.type === 'video') {
              return (mediaElementsRef.current[item.id] as HTMLVideoElement | undefined) ?? null;
            }
            return null;
          }
          accTime += item.duration;
        }

        if (mediaItemsRef.current.length > 0 && targetTimelineTime >= totalDurationRef.current) {
          const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
          if (lastItem.type === 'video') {
            return (mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined) ?? null;
          }
        }
        return null;
      };

      // 再生再開のための内部関数
      const proceedWithPlayback = () => {
        if (seekGeneration !== seekSettleGenerationRef.current || isSeekingRef.current) {
          return;
        }
        const playbackTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
        isSeekPlaybackPreparingRef.current = false;
        startTimeRef.current = Date.now() - playbackTime * 1000;
        isPlayingRef.current = true;

        // iOS WebAudio モード判定: startEngine と同じパターンで、
        // BGM が WebAudio ノード済みの場合にビデオの先行 play() をスキップする。
        // iOS Safari はビデオの play() と BGM の play() が競合して
        // シングルメディア制約により BGM が無音化するケースがある。
        const iosWebAudioMode = previewPlatformPolicy.muteNativeMediaWhenAudioRouted
          && sourceNodesRef.current['bgm'];
        const shouldPrimeActiveVideo = !iosWebAudioMode;

        // iOS WebAudio モード: BGM/ナレーションの play() をビデオより先に呼ぶ。
        // ビデオの play() はレンダーループに委ねることで、iOS Safari の
        // シングルメディア競合による BGM 無音化を防ぐ。
        if (previewPlatformPolicy.muteNativeMediaWhenAudioRouted) {
          // WebAudio ノードを準備（まだ作成されていない場合に備える）
          preparePreviewAudioNodesForTime(playbackTime);

          const currentBgm = bgmRef.current;
          if (currentBgm) {
            const bgmEl = mediaElementsRef.current.bgm as HTMLAudioElement | undefined;
            if (bgmEl && sourceNodesRef.current['bgm']) {
              const trackTime = Math.max(0, playbackTime - currentBgm.delay + currentBgm.startPoint);
              if (playbackTime >= currentBgm.delay && trackTime <= currentBgm.duration) {
                if (Math.abs(bgmEl.currentTime - trackTime) > 0.5) {
                  bgmEl.currentTime = trackTime;
                }
                if (bgmEl.paused) {
                  bgmEl.play().catch(() => { });
                }
              }
            }
          }

          const currentNarrations = narrationsRef.current;
          for (const clip of currentNarrations) {
            if (clip.isMuted || clip.volume <= 0) continue;
            const trackId = `narration:${clip.id}`;
            const narEl = mediaElementsRef.current[trackId] as HTMLAudioElement | undefined;
            if (!narEl || !sourceNodesRef.current[trackId]) continue;
            const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
            const trimEnd = Number.isFinite(clip.trimEnd)
              ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
              : clip.duration;
            const playableDuration = Math.max(0, trimEnd - trimStart);
            const clipTime = playbackTime - clip.startTime;
            if (clipTime >= 0 && clipTime <= playableDuration) {
              const sourceTime = trimStart + clipTime;
              if (Math.abs(narEl.currentTime - sourceTime) > 0.5) {
                narEl.currentTime = sourceTime;
              }
              if (narEl.paused) {
                narEl.play().catch(() => { });
              }
            }
          }
        }

        // アクティブなビデオを特定して再生開始
        let accTime = 0;
        for (const item of mediaItemsRef.current) {
          if (playbackTime >= accTime && playbackTime < accTime + item.duration) {
            if (item.type === 'video') {
              const videoEl = mediaElementsRef.current[item.id] as HTMLVideoElement;
              if (videoEl) {
                const localTime = playbackTime - accTime;
                const targetTime = (item.trimStart || 0) + localTime;

                // 位置を正確に設定
                if (Math.abs(videoEl.currentTime - targetTime) > 0.05) {
                  videoEl.currentTime = targetTime;
                }
                activeVideoIdRef.current = item.id;

                // iOS WebAudio モードではビデオの先行 play() をスキップし、
                // レンダーループ内で BGM と同時に開始させる（startEngine と同じ方式）。
                if (shouldPrimeActiveVideo) {
                  // 準備完了なら即再生、そうでなければ待機
                  if (videoEl.readyState >= 2 && !videoEl.seeking) {
                    videoEl.play().catch(() => { });
                  } else {
                    const playWhenReady = () => {
                      if (isPlayingRef.current && videoEl.paused) {
                        videoEl.play().catch(() => { });
                      }
                    };
                    // canplay (readyState >= 3) を使用。canplaythrough は長い動画で
                    // 発火しない場合があるため。
                    videoEl.addEventListener('canplay', playWhenReady, { once: true });
                    playbackTimeoutRef.current = setTimeout(() => {
                      playbackTimeoutRef.current = null;
                      // readyState >= 1 でplay()を許可（ブラウザがバッファリングを開始する）
                      if (isPlayingRef.current && videoEl.paused && videoEl.readyState >= 1) {
                        videoEl.play().catch(() => { });
                      }
                    }, 1000);
                  }
                }
              }
            } else {
              activeVideoIdRef.current = null;
            }
            break;
          }
          accTime += item.duration;
        }

        // 非アクティブなビデオをリセット
        resetInactiveVideos();

        // ループ再開
        const currentLoopId = loopIdRef.current;
        reqIdRef.current = requestAnimationFrame(() => loop(false, currentLoopId));
      };

      // 再生中シーク復帰: 先に位置を合わせ、対象が動画なら準備完了を短時間待ってから再開
      syncVideoToTime(t, { force: true });
      const activeVideoEl = findActiveVideoAtTime(t);
      if (activeVideoEl) {
        const prepareStartedAt = Date.now();
        const minPrepareMs = 220;
        const maxPrepareMs = 900;
        let finished = false;
        let pollTimer: ReturnType<typeof setInterval> | null = null;
        let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
        let maybeResume: () => void = () => { };

        const onPrepared = () => {
          maybeResume();
        };

        const cleanupPrepareWait = () => {
          if (pollTimer) {
            clearInterval(pollTimer);
            pollTimer = null;
          }
          if (fallbackTimer) {
            clearTimeout(fallbackTimer);
            fallbackTimer = null;
          }
          activeVideoEl.removeEventListener('seeked', onPrepared);
          activeVideoEl.removeEventListener('loadeddata', onPrepared);
          activeVideoEl.removeEventListener('canplay', onPrepared);
          activeVideoEl.removeEventListener('error', onPrepared);
          if (cancelSeekPlaybackPrepareRef.current === cleanupPrepareWait) {
            cancelSeekPlaybackPrepareRef.current = null;
          }
        };

        const finishPrepareWait = (shouldResume: boolean) => {
          if (finished) return;
          finished = true;
          cleanupPrepareWait();
          isSeekPlaybackPreparingRef.current = false;
          if (shouldResume) {
            proceedWithPlayback();
          }
        };

        maybeResume = () => {
          if (finished) return;
          if (seekGeneration !== seekSettleGenerationRef.current || isSeekingRef.current) {
            finishPrepareWait(false);
            return;
          }
          const elapsed = Date.now() - prepareStartedAt;
          const isReady = activeVideoEl.readyState >= 2 && !activeVideoEl.seeking;
          if (!isReady && elapsed < maxPrepareMs) return;
          if (elapsed < minPrepareMs) return;
          finishPrepareWait(true);
        };

        activeVideoEl.addEventListener('seeked', onPrepared);
        activeVideoEl.addEventListener('loadeddata', onPrepared);
        activeVideoEl.addEventListener('canplay', onPrepared);
        activeVideoEl.addEventListener('error', onPrepared);
        pollTimer = setInterval(maybeResume, 40);
        fallbackTimer = setTimeout(maybeResume, maxPrepareMs + 50);
        cancelSeekPlaybackPrepareRef.current = cleanupPrepareWait;
        maybeResume();
        return;
      }

      // シーク中でなければ即座に再生開始
      isSeekPlaybackPreparingRef.current = false;
      proceedWithPlayback();
    } else {
      isSeekPlaybackPreparingRef.current = false;
      const drawSettledFrame = (targetTime: number) => {
        syncVideoToTime(targetTime, { force: true });
        renderFrame(targetTime, false);
      };

      let activeVideoEl: HTMLVideoElement | null = null;
      let accTime = 0;
      for (const item of mediaItemsRef.current) {
        if (t >= accTime && t < accTime + item.duration) {
          if (item.type === 'video') {
            const el = mediaElementsRef.current[item.id] as HTMLVideoElement | undefined;
            activeVideoEl = el ?? null;
          }
          break;
        }
        accTime += item.duration;
      }

      if (!activeVideoEl && mediaItemsRef.current.length > 0 && t >= totalDurationRef.current) {
        const lastItem = mediaItemsRef.current[mediaItemsRef.current.length - 1];
        if (lastItem.type === 'video') {
          const el = mediaElementsRef.current[lastItem.id] as HTMLVideoElement | undefined;
          activeVideoEl = el ?? null;
        }
      }

      if (activeVideoEl && activeVideoEl.seeking) {
        const settleGeneration = seekSettleGenerationRef.current;
        const drawIfFresh = () => {
          if (settleGeneration !== seekSettleGenerationRef.current) return;
          const latestTime = Math.max(0, Math.min(currentTimeRef.current, totalDurationRef.current));
          drawSettledFrame(latestTime);
        };
        const onSeeked = () => {
          activeVideoEl?.removeEventListener('seeked', onSeeked);
          pendingPausedSeekWaitRef.current = null;
          if (playbackTimeoutRef.current) {
            clearTimeout(playbackTimeoutRef.current);
            playbackTimeoutRef.current = null;
          }
          drawIfFresh();
        };
        pendingPausedSeekWaitRef.current = {
          cleanup: () => {
            activeVideoEl?.removeEventListener('seeked', onSeeked);
          },
        };
        activeVideoEl.addEventListener('seeked', onSeeked, { once: true });
        playbackTimeoutRef.current = setTimeout(() => {
          activeVideoEl?.removeEventListener('seeked', onSeeked);
          pendingPausedSeekWaitRef.current = null;
          playbackTimeoutRef.current = null;
          drawIfFresh();
        }, 500);
        return;
      }

      // 再生していなかった場合は現在位置でフレームを再描画
      drawSettledFrame(t);
    }
  }, [setCurrentTime, renderFrame, loop, resetInactiveVideos, syncVideoToTime, cancelPendingPausedSeekWait, detachGlobalSeekEndListeners, cancelPendingSeekPlaybackPrepare]);

  useEffect(() => {
    handleSeekEndCallbackRef.current = handleSeekEnd;
  }, [handleSeekEnd]);

  // --- 再生/一時停止トグル ---
  // 目的: 再生中なら停止、停止中なら再生を開始
  // 注意: 200msのデバウンスで連続クリックを防止
  const togglePlay = useCallback(() => {
    // デバウンス: 200ms以内の連続クリックを無視
    const now = Date.now();
    if (now - lastToggleTimeRef.current < 200) {
      return;
    }
    lastToggleTimeRef.current = now;

    if (isPlaying) {
      stopAll();
      pause();
    } else {
      let startT = currentTime;
      if (startT >= totalDuration - 0.1 || startT < 0) startT = 0;
      startEngine(startT, false);
    }
  }, [isPlaying, currentTime, totalDuration, stopAll, pause, startEngine]);

  // --- 停止ハンドラ ---
  // 目的: 再生を停止し、時刻を0にリセットしてリソースをリロード
  // --- 停止ハンドラ ---
  // 目的: 再生を停止し、時刻を0にリセット（リソースのリロードは行わない）
  // 改善: 以前はhandleReloadResourcesを呼んでいたが、DOM破棄により動画切り替え時にクラッシュするため
  //       安全な停止・巻き戻し処理に変更
  const handleStop = useCallback(() => {
    stopAll();
    pause();
    seekSettleGenerationRef.current += 1;
    cancelPendingSeekPlaybackPrepare();
    cancelPendingPausedSeekWait();
    detachGlobalSeekEndListeners();
    isSeekingRef.current = false;
    wasPlayingBeforeSeekRef.current = false;
    setExportPreparationStep(null);
    setCurrentTime(0);
    currentTimeRef.current = 0;
    endFinalizedRef.current = false;

    // エクスポート後の保存ボタンをクリアして書き出しボタンに戻す
    clearExport();

    // [TV] 全メディアを安全に巻き戻し (DOM要素を維持したままリセット)
    // 各ビデオをtrimStart位置にリセット（0ではなく実際の開始位置へ）
    for (const item of mediaItemsRef.current) {
      const el = mediaElementsRef.current[item.id];
      if (el && el.tagName === 'VIDEO') {
        try {
          const videoEl = el as HTMLVideoElement;
          videoEl.pause();
          videoEl.currentTime = item.trimStart || 0;
        } catch (e) {
          /* ignore */
        }
      }
    }
    // BGM/ナレーションは0に戻す
    const audioTrackIds = [
      'bgm',
      ...narrationsRef.current.map((clip) => `narration:${clip.id}`),
    ];
    audioTrackIds.forEach((trackId) => {
      const el = mediaElementsRef.current[trackId];
      if (el && (el.tagName === 'AUDIO')) {
        try {
          const audioEl = el as HTMLAudioElement;
          audioEl.pause();
          audioEl.currentTime = 0;
        } catch (e) {
          /* ignore */
        }
      }
    });

    // 0秒時点を描画
    // 少し遅延させて確実にシーク反映させる
    renderPausedPreviewFrameAtTime(0);
  }, [
    stopAll,
    pause,
    setCurrentTime,
    clearExport,
    cancelPendingPausedSeekWait,
    cancelPendingSeekPlaybackPrepare,
    detachGlobalSeekEndListeners,
    renderPausedPreviewFrameAtTime,
  ]);

  // --- Helper: 停止付きで関数を実行 ---
  // 目的: BGM/ナレーション追加時など、完全に停止して先頭に戻してから実行したい場合に使用
  const withStop = useCallback(<T extends any[]>(fn: (...args: T) => void) => {
    return (...args: T) => {
      handleStop();
      fn(...args);
    };
  }, [handleStop]);

  // --- エクスポート開始ハンドラ ---
  // 目的: 動画ファイルとして書き出しを開始
  const handleExport = useCallback(() => {
    startEngine(0, true);
  }, [startEngine]);

  // --- ダウンロードハンドラ ---
  // 目的: ダウンロード完了時にユーザーへ通知する
  const handleDownload = useCallback(async () => {
    if (!exportUrl) return;

    const ext = exportExt || 'mp4';
    const filename = `turtle_video_${Date.now()}.${ext}`;
    const mimeType = ext === 'webm' ? 'video/webm' : 'video/mp4';
    const fileDescription = ext === 'webm' ? 'WebM 動画' : 'MP4 動画';
    try {
      const result = await saveObjectUrlWithClientFileStrategy({
        sourceUrl: exportUrl,
        descriptor: {
          filename,
          mimeType,
          description: fileDescription,
        },
        supportsShowSaveFilePicker,
      });

      if (result.strategy === 'file-picker') {
        window.alert('ダウンロードが完了しました。');
        showToast('ダウンロードが完了しました');
        return;
      }

      showToast('ダウンロードを開始しました。完了はブラウザの通知をご確認ください。', 5000);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        showToast('ダウンロードをキャンセルしました');
        return;
      }
      setError('ダウンロードに失敗しました');
    }
  }, [exportUrl, exportExt, setError, showToast, supportsShowSaveFilePicker]);

  // --- 時刻フォーマットヘルパー ---
  // 目的: 秒数を「分:秒」形式の文字列に変換
  const formatTime = useCallback((s: number): string => {
    if (!s || isNaN(s)) return '0:00';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }, []);

  // --- キャプチャハンドラ ---
  // 目的: プレビューの現在のフレームをPNG画像として保存
  // 再生中の場合は一時停止してからキャプチャする
  const handleCapture = useCallback(async () => {
    // メディアがない場合は何もしない
    if (mediaItems.length === 0) return;
    // エクスポート中はキャプチャ不可
    if (isProcessing) return;

    // 再生中の場合は一時停止
    const wasPlaying = isPlayingRef.current;
    if (wasPlaying) {
      stopAll();
      pause();
    }

    // Canvasからキャプチャ
    const canvas = canvasRef.current;
    if (!canvas) {
      showToast('キャプチャに失敗しました');
      return;
    }

    const timestamp = formatTime(currentTimeRef.current).replace(':', 'm') + 's';
    const filename = `turtle_capture_${timestamp}_${Date.now()}`;
    const success = await captureCanvasAsImage(canvas, filename);

    if (success) {
      showToast('キャプチャを保存しました');
    } else {
      showToast('キャプチャに失敗しました');
    }
  }, [mediaItems.length, isProcessing, stopAll, pause, showToast, formatTime]);

  const openSectionHelp = useCallback((section: SectionHelpKey) => {
    setActiveHelpSection(section);
  }, []);

  const closeSectionHelp = useCallback(() => {
    setActiveHelpSection(null);
  }, []);

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 font-sans pb-24 select-none relative">
      <Toast message={toastMessage} onClose={clearToast} />

      {/* 隠しリソースローダー */}
      <MediaResourceLoader
        key={reloadKey}
        mediaItems={mediaItems}
        bgm={bgm}
        narrations={narrations}
        onElementLoaded={handleMediaElementLoaded}
        onRefAssign={handleMediaRefAssign}
        onSeeked={handleSeeked}
        onVideoLoadedData={handleVideoLoadedData}
      />

      {/* AI Modal */}
      <AiModal
        isOpen={showAiModal}
        onClose={handleCloseAiModal}
        aiPrompt={aiPrompt}
        aiScript={aiScript}
        aiScriptLength={aiScriptLength}
        aiVoice={aiVoice}
        aiVoiceStyle={aiVoiceStyle}
        isAiLoading={isAiLoading}
        voiceOptions={VOICE_OPTIONS}
        onPromptChange={setAiPrompt}
        onScriptChange={setAiScript}
        onScriptLengthChange={setAiScriptLength}
        onVoiceChange={setAiVoice}
        onVoiceStyleChange={setAiVoiceStyle}
        onGenerateScript={generateScript}
        onGenerateSpeech={generateSpeech}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
      />

      {/* SaveLoad Modal */}
      <SaveLoadModal
        isOpen={showProjectManager}
        onClose={() => setShowProjectManager(false)}
        onToast={(msg, type) => {
          if (type === 'error') {
            setError(msg);
          } else {
            showToast(msg);
          }
        }}
      />

      {/* Section Help Modal */}
      <SectionHelpModal
        isOpen={activeHelpSection !== null}
        section={activeHelpSection}
        onClose={closeSectionHelp}
      />

      {/* Header */}
      <Header
        onOpenSettings={handleOpenSettingsModal}
        onOpenProjectManager={handleOpenProjectManagerModal}
        onOpenAppHelp={handleOpenAppHelpModal}
      />

      <div className="max-w-md md:max-w-3xl lg:max-w-6xl mx-auto p-4 lg:p-6">
        <ErrorMessage message={errorMsg} count={errorCount} onClose={clearError} />

        <div className="mt-4 lg:grid lg:grid-cols-[1fr_585px] lg:gap-8">
          {/* 左カラム: 編集コントロール（モバイルでは通常の縦並び） */}
          <div className="space-y-6">
            {/* 1. CLIPS */}
            <ClipsSection
              mediaItems={mediaItems}
              mediaTimelineRanges={mediaTimelineRanges}
              isClipsLocked={isClipsLocked}
              mediaElements={mediaElementsRef.current as Record<string, HTMLVideoElement | HTMLImageElement>}
              onToggleClipsLock={withPause(toggleClipsLock)}
              onMediaUpload={withPause(handleMediaUpload)}
              onOpenMediaPicker={withPause(handleOpenMediaPicker)}
              supportsShowOpenFilePicker={supportsShowOpenFilePicker}
              onMoveMedia={withPause(handleMoveMedia)}
              onRemoveMedia={withPause(handleRemoveMedia)}
              onToggleMediaLock={withPause(toggleItemLock)}
              onToggleTransformPanel={withPause(handleToggleTransformPanel)}
              onUpdateVideoTrim={withPause(handleUpdateVideoTrim)}
              onUpdateImageDuration={withPause(handleUpdateImageDuration)}
              onUpdateMediaScale={withPause(handleUpdateMediaScale)}
              onUpdateMediaPosition={withPause(handleUpdateMediaPosition)}
              onResetMediaSetting={withPause(handleResetMediaSetting)}
              onUpdateMediaVolume={updateVolume}
              onToggleMediaMute={toggleMute}
              onToggleMediaFadeIn={withPause(toggleFadeIn)}
              onToggleMediaFadeOut={withPause(toggleFadeOut)}
              onUpdateFadeInDuration={withPause(updateFadeInDuration)}
              onUpdateFadeOutDuration={withPause(updateFadeOutDuration)}
              onOpenHelp={() => openSectionHelp('clips')}
            />

            {/* 2. BGM SETTINGS */}
            <BgmSection
              bgm={bgm}
              isBgmLocked={isBgmLocked}
              totalDuration={totalDuration}
              onToggleBgmLock={withPause(toggleBgmLock)}
              onBgmUpload={withStop(handleBgmUpload)}
              onRemoveBgm={withPause(removeBgm)}
              onUpdateStartPoint={withPause(handleUpdateBgmStart)}
              onUpdateDelay={withPause(handleUpdateBgmDelay)}
              onUpdateVolume={handleUpdateBgmVolume}
              onToggleFadeIn={withPause(toggleBgmFadeIn)}
              onToggleFadeOut={withPause(toggleBgmFadeOut)}
              onUpdateFadeInDuration={withPause(updateBgmFadeInDuration)}
              onUpdateFadeOutDuration={withPause(updateBgmFadeOutDuration)}
              formatTime={formatTime}
              onOpenHelp={() => openSectionHelp('bgm')}
            />

            {/* 3. NARRATION SETTINGS */}
            <NarrationSection
              narrations={narrations}
              offlineMode={offlineMode}
              isNarrationLocked={isNarrationLocked}
              totalDuration={totalDuration}
              currentTime={currentTime}
              onToggleNarrationLock={withPause(toggleNarrationLock)}
              onAddAiNarration={handleAddAiNarration}
              onEditAiNarration={handleEditAiNarration}
              onNarrationUpload={withStop(handleNarrationUpload)}
              onRemoveNarration={withPause(removeNarration)}
              onMoveNarration={withPause(moveNarration)}
              onSaveNarration={withPause(handleSaveNarration)}
              onUpdateStartTime={withPause(handleUpdateNarrationStart)}
              onSetStartTimeToCurrent={withPause(handleSetNarrationStartToCurrent)}
              onUpdateVolume={handleUpdateNarrationVolume}
              onToggleMute={handleToggleNarrationMute}
              onUpdateTrimStart={withPause(handleUpdateNarrationTrimStart)}
              onUpdateTrimEnd={withPause(handleUpdateNarrationTrimEnd)}
              formatTime={formatTime}
              onOpenHelp={() => openSectionHelp('narration')}
            />

            {/* 4. CAPTIONS */}
            <CaptionSection
              captions={captions}
              settings={captionSettings}
              isLocked={isCaptionLocked}
              totalDuration={totalDuration}
              currentTime={currentTime}
              onToggleLock={withPause(toggleCaptionLock)}
              onAddCaption={withPause(addCaption)}
              onUpdateCaption={withPause(updateCaption)}
              onRemoveCaption={withPause(removeCaption)}
              onMoveCaption={withPause(moveCaption)}
              onSetEnabled={withPause(setCaptionEnabled)}
              onSetFontSize={withPause(setCaptionFontSize)}
              onSetFontStyle={withPause(setCaptionFontStyle)}
              onSetPosition={withPause(setCaptionPosition)}
              onSetBlur={withPause(setCaptionBlur)}
              onSetBulkFadeIn={withPause(setBulkFadeIn)}
              onSetBulkFadeOut={withPause(setBulkFadeOut)}
              onSetBulkFadeInDuration={withPause(setBulkFadeInDuration)}
              onSetBulkFadeOutDuration={withPause(setBulkFadeOutDuration)}
              onOpenHelp={() => openSectionHelp('caption')}
            />

          </div>

          {/* 右カラム: プレビュー（モバイルでは下部に表示、PCではスティッキーサイドバー） */}
          <div className="mt-6 lg:mt-0">
            <div className="lg:sticky lg:top-20">
              {/* 5. PREVIEW */}
              <PreviewSection
                mediaItems={mediaItems}
                bgm={bgm}
                narrations={narrations}
                canvasRef={canvasRef}
                currentTime={currentTime}
                totalDuration={totalDuration}
                isPlaying={isPlaying}
                isProcessing={isProcessing}
                isLoading={isLoading}
                exportPreparationStep={exportPreparationStep}
                exportUrl={exportUrl}
                exportExt={exportExt}
                onSeekChange={handleSeekChange}
                onSeekStart={handleSeekStart}
                onSeekEnd={handleSeekEnd}
                onTogglePlay={togglePlay}
                onStop={handleStop}
                onExport={handleExport}
                onDownload={handleDownload}
                onClearAll={handleClearAll}
                onCapture={handleCapture}
                onOpenHelp={() => openSectionHelp('preview')}
                formatTime={formatTime}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TurtleVideo;
