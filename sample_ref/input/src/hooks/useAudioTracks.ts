/**
 * @file useAudioTracks.ts
 * @author Turtle Village
 * @description BGMとナレーションのトラック操作（アップロード、音量、フェード、削除など）を行うカスタムフック。
 */
import { useState, useCallback, useRef } from 'react';
import type { AudioTrack } from '../types';

/**
 * useAudioTracks - BGMとナレーションの状態管理と操作ロジックを提供するフック
 */
export interface UseAudioTracksReturn {
  // State
  bgm: AudioTrack | null;
  setBgm: React.Dispatch<React.SetStateAction<AudioTrack | null>>;
  bgmRef: React.MutableRefObject<AudioTrack | null>;
  narration: AudioTrack | null;
  setNarration: React.Dispatch<React.SetStateAction<AudioTrack | null>>;
  narrationRef: React.MutableRefObject<AudioTrack | null>;

  // Handlers
  handleBgmUpload: (e: React.ChangeEvent<HTMLInputElement>, clearExportUrl: () => void) => void;
  handleNarrationUpload: (e: React.ChangeEvent<HTMLInputElement>, clearExportUrl: () => void) => void;
  updateTrackStart: (type: 'bgm' | 'narration', val: string) => void;
  updateTrackDelay: (type: 'bgm' | 'narration', val: string) => void;
  updateTrackVolume: (type: 'bgm' | 'narration', val: string) => void;
  toggleTrackFadeIn: (type: 'bgm' | 'narration', checked: boolean) => void;
  toggleTrackFadeOut: (type: 'bgm' | 'narration', checked: boolean) => void;
  removeBgm: () => void;
  removeNarration: () => void;
  clearAudioTracks: () => void;
  syncAudioRefs: () => void;
}

export function useAudioTracks(): UseAudioTracksReturn {
  const [bgm, setBgm] = useState<AudioTrack | null>(null);
  const [narration, setNarration] = useState<AudioTrack | null>(null);
  const bgmRef = useRef<AudioTrack | null>(null);
  const narrationRef = useRef<AudioTrack | null>(null);

  // Refの同期
  const syncAudioRefs = useCallback(() => {
    bgmRef.current = bgm;
    narrationRef.current = narration;
  }, [bgm, narration]);

  // BGMアップロード
  const handleBgmUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, clearExportUrl: () => void) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      clearExportUrl();
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
    },
    []
  );

  // ナレーションアップロード
  const handleNarrationUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>, clearExportUrl: () => void) => {
      const file = e.target.files?.[0];
      if (!file) return;
      e.target.value = '';
      clearExportUrl();
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.onloadedmetadata = () => {
        setNarration({
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
    },
    []
  );

  // 開始位置更新
  const updateTrackStart = useCallback(
    (type: 'bgm' | 'narration', val: string) => {
      let numVal = parseFloat(val);
      if (isNaN(numVal)) numVal = 0;

      if (type === 'bgm') {
        setBgm((prev) => {
          if (!prev) return null;
          const safeVal = Math.max(0, Math.min(prev.duration, numVal));
          return { ...prev, startPoint: safeVal };
        });
      } else {
        setNarration((prev) => {
          if (!prev) return null;
          const safeVal = Math.max(0, Math.min(prev.duration, numVal));
          return { ...prev, startPoint: safeVal };
        });
      }
    },
    []
  );

  // 遅延更新
  const updateTrackDelay = useCallback((type: 'bgm' | 'narration', val: string) => {
    let numVal = parseFloat(val);
    if (isNaN(numVal)) numVal = 0;
    const safeVal = Math.max(0, numVal);

    if (type === 'bgm') {
      setBgm((prev) => (prev ? { ...prev, delay: safeVal } : null));
    } else {
      setNarration((prev) => (prev ? { ...prev, delay: safeVal } : null));
    }
  }, []);

  // ボリューム更新
  const updateTrackVolume = useCallback((type: 'bgm' | 'narration', val: string) => {
    let numVal = parseFloat(val);
    if (isNaN(numVal)) numVal = 0;
    if (type === 'bgm') setBgm((prev) => (prev ? { ...prev, volume: numVal } : null));
    if (type === 'narration') setNarration((prev) => (prev ? { ...prev, volume: numVal } : null));
  }, []);

  // フェードイン切替
  const toggleTrackFadeIn = useCallback((type: 'bgm' | 'narration', checked: boolean) => {
    if (type === 'bgm') {
      setBgm((prev) => (prev ? { ...prev, fadeIn: checked } : null));
    } else {
      setNarration((prev) => (prev ? { ...prev, fadeIn: checked } : null));
    }
  }, []);

  // フェードアウト切替
  const toggleTrackFadeOut = useCallback((type: 'bgm' | 'narration', checked: boolean) => {
    if (type === 'bgm') {
      setBgm((prev) => (prev ? { ...prev, fadeOut: checked } : null));
    } else {
      setNarration((prev) => (prev ? { ...prev, fadeOut: checked } : null));
    }
  }, []);

  // BGM削除
  const removeBgm = useCallback(() => {
    if (bgm?.url) {
      URL.revokeObjectURL(bgm.url);
    }
    setBgm(null);
    bgmRef.current = null;
  }, [bgm]);

  // ナレーション削除
  const removeNarration = useCallback(() => {
    if (narration?.url) {
      URL.revokeObjectURL(narration.url);
    }
    setNarration(null);
    narrationRef.current = null;
  }, [narration]);

  // 全クリア
  const clearAudioTracks = useCallback(() => {
    if (bgm?.url) URL.revokeObjectURL(bgm.url);
    if (narration?.url) URL.revokeObjectURL(narration.url);
    setBgm(null);
    setNarration(null);
    bgmRef.current = null;
    narrationRef.current = null;
  }, [bgm, narration]);

  return {
    bgm,
    setBgm,
    bgmRef,
    narration,
    setNarration,
    narrationRef,
    handleBgmUpload,
    handleNarrationUpload,
    updateTrackStart,
    updateTrackDelay,
    updateTrackVolume,
    toggleTrackFadeIn,
    toggleTrackFadeOut,
    removeBgm,
    removeNarration,
    clearAudioTracks,
    syncAudioRefs,
  };
}

export default useAudioTracks;
