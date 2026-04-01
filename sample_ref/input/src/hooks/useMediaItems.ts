/**
 * @file useMediaItems.ts
 * @author Turtle Village
 * @description 画像・動画クリップのCRUD操作（追加、削除、並び替え、トリミング、変形など）を管理するカスタムフック。
 */
import { useState, useCallback, useRef } from 'react';
import type { MediaItem } from '../types';

/**
 * useMediaItems - メディアアイテムの状態管理と操作ロジックを提供するフック
 */
export interface UseMediaItemsReturn {
  // State
  mediaItems: MediaItem[];
  setMediaItems: React.Dispatch<React.SetStateAction<MediaItem[]>>;
  mediaItemsRef: React.MutableRefObject<MediaItem[]>;
  totalDuration: number;
  totalDurationRef: React.MutableRefObject<number>;

  // Handlers
  handleMediaUpload: (
    e: React.ChangeEvent<HTMLInputElement>,
    getAudioContext: () => AudioContext,
    clearExportUrl: () => void
  ) => void;
  handleMediaElementLoaded: (
    id: string,
    element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement
  ) => void;
  updateImageDuration: (id: string, newDuration: string) => void;
  updateVideoTrim: (
    id: string,
    type: 'start' | 'end',
    value: string,
    mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>
  ) => void;
  updateMediaScale: (id: string, value: string | number) => void;
  updateMediaPosition: (id: string, axis: 'x' | 'y', value: string) => void;
  toggleTransformPanel: (id: string) => void;
  resetMediaSetting: (id: string, type: 'scale' | 'x' | 'y') => void;
  toggleMediaLock: (id: string) => void;
  updateMediaVolume: (id: string, value: number) => void;
  toggleMediaMute: (id: string) => void;
  toggleMediaFadeIn: (id: string, checked: boolean) => void;
  toggleMediaFadeOut: (id: string, checked: boolean) => void;
  moveMedia: (idx: number, dir: 'up' | 'down') => void;
  removeMedia: (id: string, mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>) => void;
  clearMediaItems: () => void;
  syncMediaItemsRef: () => number;
}

export function useMediaItems(): UseMediaItemsReturn {
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const mediaItemsRef = useRef<MediaItem[]>([]);
  const totalDurationRef = useRef(0);
  const [totalDuration, setTotalDuration] = useState(0);

  // State と Ref の同期、総時間計算
  const syncMediaItemsRef = useCallback(() => {
    mediaItemsRef.current = mediaItems;
    const total = mediaItems.reduce(
      (acc, v) => acc + (Number.isFinite(v.duration) ? v.duration : 0),
      0
    );
    setTotalDuration(total);
    totalDurationRef.current = total;
    return total;
  }, [mediaItems]);

  // メディアアップロード
  const handleMediaUpload = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement>,
      getAudioContext: () => AudioContext,
      clearExportUrl: () => void
    ) => {
      try {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        e.target.value = '';
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume().catch(console.error);
        clearExportUrl();
        const newItems: MediaItem[] = files.map((file) => {
          const isImage = file.type.startsWith('image');
          return {
            id: Math.random().toString(36).substr(2, 9),
            file,
            type: isImage ? 'image' : 'video',
            url: URL.createObjectURL(file),
            volume: 1.0,
            isMuted: false,
            fadeIn: false,
            fadeOut: false,
            fadeInDuration: 1.0,
            fadeOutDuration: 1.0,
            duration: isImage ? 5 : 0,
            originalDuration: 0,
            trimStart: 0,
            trimEnd: 0,
            scale: 1.0,
            positionX: 0,
            positionY: 0,
            isTransformOpen: false,
            isLocked: false,
          };
        });
        setMediaItems((prev) => [...prev, ...newItems]);
      } catch (err) {
        console.error('メディアの読み込みエラー', err);
      }
    },
    []
  );

  // メディア要素読み込み完了時のコールバック
  const handleMediaElementLoaded = useCallback(
    (id: string, element: HTMLVideoElement | HTMLImageElement | HTMLAudioElement) => {
      if (element.tagName === 'VIDEO') {
        const videoEl = element as HTMLVideoElement;
        const duration = videoEl.duration;
        if (!isNaN(duration) && duration !== Infinity) {
          setMediaItems((prev) =>
            prev.map((v) => {
              if (v.id === id) {
                const isInitialized = v.originalDuration > 0;
                const newTrimStart = isInitialized ? v.trimStart : 0;
                const newTrimEnd = isInitialized && v.trimEnd > 0 ? v.trimEnd : duration;
                const newDuration = newTrimEnd - newTrimStart;
                return {
                  ...v,
                  originalDuration: duration,
                  trimStart: newTrimStart,
                  trimEnd: newTrimEnd,
                  duration: newDuration > 0 ? newDuration : duration,
                };
              }
              return v;
            })
          );
        }
      }
    },
    []
  );

  // 画像の表示時間更新
  const updateImageDuration = useCallback((id: string, newDuration: string) => {
    let val = parseFloat(newDuration);
    if (isNaN(val) || val < 0.5) val = 0.5;
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, duration: val } : v)));
  }, []);

  // 動画トリミング更新
  const updateVideoTrim = useCallback(
    (
      id: string,
      type: 'start' | 'end',
      value: string,
      mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>
    ) => {
      setMediaItems((prev) =>
        prev.map((item) => {
          if (item.id !== id) return item;
          let val = parseFloat(value);
          if (isNaN(val)) val = 0;
          let newStart = item.trimStart;
          let newEnd = item.trimEnd;
          const max = item.originalDuration;

          if (type === 'start') {
            newStart = Math.min(Math.max(0, val), newEnd - 0.1);
          } else {
            newEnd = Math.max(Math.min(max, val), newStart + 0.1);
          }

          const el = mediaElementsRef.current[id] as HTMLVideoElement;
          if (el && el.tagName === 'VIDEO') {
            const seekTime = type === 'start' ? newStart : Math.max(newStart, newEnd - 0.1);
            if (Number.isFinite(seekTime)) {
              el.currentTime = Math.max(0, Math.min(max, seekTime));
            }
          }

          return { ...item, trimStart: newStart, trimEnd: newEnd, duration: newEnd - newStart };
        })
      );
    },
    []
  );

  // スケール更新
  const updateMediaScale = useCallback((id: string, value: string | number) => {
    let val = typeof value === 'number' ? value : parseFloat(value);
    if (isNaN(val)) val = 1.0;
    val = Math.min(Math.max(val, 0.5), 3.0);
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, scale: val } : v)));
  }, []);

  // 位置更新
  const updateMediaPosition = useCallback((id: string, axis: 'x' | 'y', value: string) => {
    let val = parseFloat(value);
    if (isNaN(val)) val = 0;
    val = Math.min(Math.max(val, -1280), 1280);
    setMediaItems((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          if (axis === 'x') return { ...v, positionX: val };
          if (axis === 'y') return { ...v, positionY: val };
        }
        return v;
      })
    );
  }, []);

  // トランスフォームパネル表示切替
  const toggleTransformPanel = useCallback((id: string) => {
    setMediaItems((prev) =>
      prev.map((v) => (v.id === id ? { ...v, isTransformOpen: !v.isTransformOpen } : v))
    );
  }, []);

  // 設定リセット
  const resetMediaSetting = useCallback((id: string, type: 'scale' | 'x' | 'y') => {
    setMediaItems((prev) =>
      prev.map((v) => {
        if (v.id === id) {
          if (type === 'scale') return { ...v, scale: 1.0 };
          if (type === 'x') return { ...v, positionX: 0 };
          if (type === 'y') return { ...v, positionY: 0 };
        }
        return v;
      })
    );
  }, []);

  // ロック切替
  const toggleMediaLock = useCallback((id: string) => {
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, isLocked: !v.isLocked } : v)));
  }, []);

  // ボリューム更新
  const updateMediaVolume = useCallback((id: string, value: number) => {
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, volume: value } : v)));
  }, []);

  // ミュート切替
  const toggleMediaMute = useCallback((id: string) => {
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, isMuted: !v.isMuted } : v)));
  }, []);

  // フェードイン切替
  const toggleMediaFadeIn = useCallback((id: string, checked: boolean) => {
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, fadeIn: checked } : v)));
  }, []);

  // フェードアウト切替
  const toggleMediaFadeOut = useCallback((id: string, checked: boolean) => {
    setMediaItems((prev) => prev.map((v) => (v.id === id ? { ...v, fadeOut: checked } : v)));
  }, []);

  // 順序移動
  const moveMedia = useCallback(
    (idx: number, dir: 'up' | 'down') => {
      setMediaItems((prev) => {
        const copy = [...prev];
        const target = dir === 'up' ? idx - 1 : idx + 1;
        if (target >= 0 && target < copy.length) {
          [copy[idx], copy[target]] = [copy[target], copy[idx]];
        }
        return copy;
      });
    },
    []
  );

  // メディア削除
  const removeMedia = useCallback(
    (
      id: string,
      mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>
    ) => {
      setMediaItems((prev) => prev.filter((v) => v.id !== id));
      delete mediaElementsRef.current[id];
    },
    []
  );

  // 全クリア
  const clearMediaItems = useCallback(() => {
    mediaItems.forEach((v) => {
      URL.revokeObjectURL(v.url);
    });
    mediaItemsRef.current = [];
    setMediaItems([]);
    setTotalDuration(0);
    totalDurationRef.current = 0;
  }, [mediaItems]);

  return {
    mediaItems,
    setMediaItems,
    mediaItemsRef,
    totalDuration,
    totalDurationRef,
    handleMediaUpload,
    handleMediaElementLoaded,
    updateImageDuration,
    updateVideoTrim,
    updateMediaScale,
    updateMediaPosition,
    toggleTransformPanel,
    resetMediaSetting,
    toggleMediaLock,
    updateMediaVolume,
    toggleMediaMute,
    toggleMediaFadeIn,
    toggleMediaFadeOut,
    moveMedia,
    removeMedia,
    clearMediaItems,
    syncMediaItemsRef,
  };
}

export default useMediaItems;
