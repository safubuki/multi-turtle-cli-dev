/**
 * @file usePlayback.ts
 * @author Turtle Village
 * @description 再生状態（再生中/停止中、現在時刻）、再生速度、ループ制御などを提供するカスタムフック。
 */
import { useState, useRef, useCallback } from 'react';
import type { MediaItem, AudioTrack } from '../types';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

/**
 * usePlayback - 再生制御ロジックを提供するフック
 * renderFrame, play, stop, seek などの機能を含む
 */
export interface UsePlaybackReturn {
  // State
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  currentTime: number;
  setCurrentTime: React.Dispatch<React.SetStateAction<number>>;
  currentTimeRef: React.MutableRefObject<number>;

  // Refs
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  reqIdRef: React.MutableRefObject<number | null>;
  startTimeRef: React.MutableRefObject<number>;

  // Methods
  renderFrame: (
    time: number,
    isActivePlaying: boolean,
    isExporting: boolean,
    mediaItemsRef: React.MutableRefObject<MediaItem[]>,
    bgmRef: React.MutableRefObject<AudioTrack | null>,
    narrationRef: React.MutableRefObject<AudioTrack | null>,
    totalDurationRef: React.MutableRefObject<number>,
    mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>,
    gainNodesRef: React.MutableRefObject<Record<string, GainNode>>,
    audioCtxRef: React.MutableRefObject<AudioContext | null>
  ) => void;
  stopAll: (
    mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>,
    gainNodesRef: React.MutableRefObject<Record<string, GainNode>>,
    audioCtxRef: React.MutableRefObject<AudioContext | null>,
    recorderRef: React.MutableRefObject<MediaRecorder | null>
  ) => void;
  handleSeekChange: (
    e: React.ChangeEvent<HTMLInputElement>,
    stopAll: () => void,
    renderFrame: (time: number, isPlaying: boolean) => void
  ) => void;
  handleSeeked: (renderFrame: (time: number) => void) => void;
}

export function usePlayback(): UsePlaybackReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const currentTimeRef = useRef(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reqIdRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);

  // フレーム描画
  const renderFrame = useCallback(
    (
      time: number,
      isActivePlaying: boolean,
      _isExporting: boolean,
      mediaItemsRef: React.MutableRefObject<MediaItem[]>,
      bgmRef: React.MutableRefObject<AudioTrack | null>,
      narrationRef: React.MutableRefObject<AudioTrack | null>,
      totalDurationRef: React.MutableRefObject<number>,
      mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>,
      gainNodesRef: React.MutableRefObject<Record<string, GainNode>>,
      audioCtxRef: React.MutableRefObject<AudioContext | null>
    ) => {
      try {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const currentItems = mediaItemsRef.current;
        const currentBgm = bgmRef.current;
        const currentNarration = narrationRef.current;

        let t = 0;
        let activeId: string | null = null;
        let localTime = 0;
        let activeIndex = -1;

        for (let i = 0; i < currentItems.length; i++) {
          const item = currentItems[i];
          if (time >= t && time < t + item.duration) {
            activeId = item.id;
            activeIndex = i;
            localTime = time - t;
            break;
          }
          t += item.duration;
        }

        ctx.globalAlpha = 1.0;
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

        // Preload next video
        if (isActivePlaying && activeIndex !== -1 && activeIndex + 1 < currentItems.length) {
          const nextItem = currentItems[activeIndex + 1];
          if (nextItem.type === 'video') {
            const remainingTime = currentItems[activeIndex].duration - localTime;
            if (remainingTime < 1.5) {
              const nextElement = mediaElementsRef.current[nextItem.id] as HTMLVideoElement;
              if (nextElement && (nextElement.paused || nextElement.readyState < 2)) {
                const nextStart = nextItem.trimStart || 0;
                if (Math.abs(nextElement.currentTime - nextStart) > 0.1) {
                  nextElement.currentTime = nextStart;
                }
              }
            }
          }
        }

        // Process media elements
        Object.keys(mediaElementsRef.current).forEach((id) => {
          if (id === 'bgm' || id === 'narration') return;

          const element = mediaElementsRef.current[id];
          const gainNode = gainNodesRef.current[id];
          const conf = currentItems.find((v) => v.id === id);

          if (!element || !conf) return;

          if (id === activeId) {
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              const targetTime = (conf.trimStart || 0) + localTime;

              if (isActivePlaying) {
                if (Math.abs(videoEl.currentTime - targetTime) > 0.8) {
                  videoEl.currentTime = targetTime;
                }
                if (videoEl.paused) videoEl.play().catch(() => { });
              } else {
                if (!videoEl.paused) videoEl.pause();
                if (Math.abs(videoEl.currentTime - targetTime) > 0.01) {
                  videoEl.currentTime = targetTime;
                }
              }
            }

            // Draw
            const isVideo = conf.type === 'video';
            const videoEl = element as HTMLVideoElement;
            const imgEl = element as HTMLImageElement;
            const isReady = isVideo ? videoEl.readyState >= 1 : imgEl.complete;

            if (isReady) {
              const elemW = isVideo ? videoEl.videoWidth : imgEl.naturalWidth;
              const elemH = isVideo ? videoEl.videoHeight : imgEl.naturalHeight;
              if (elemW && elemH) {
                const scaleFactor = conf.scale || 1.0;
                const userX = conf.positionX || 0;
                const userY = conf.positionY || 0;

                const baseScale = Math.min(CANVAS_WIDTH / elemW, CANVAS_HEIGHT / elemH);

                ctx.save();
                ctx.translate(CANVAS_WIDTH / 2 + userX, CANVAS_HEIGHT / 2 + userY);
                ctx.scale(baseScale * scaleFactor, baseScale * scaleFactor);

                let alpha = 1.0;
                if (conf.fadeIn && localTime < 1.0) alpha = localTime;
                else if (conf.fadeOut && localTime > conf.duration - 1.0)
                  alpha = conf.duration - localTime;

                ctx.globalAlpha = Math.max(0, Math.min(1, alpha));
                ctx.drawImage(element as CanvasImageSource, -elemW / 2, -elemH / 2, elemW, elemH);
                ctx.restore();
                ctx.globalAlpha = 1.0;
              }
            }

            // Video audio
            if (conf.type === 'video' && gainNode && audioCtxRef.current) {
              if (isActivePlaying) {
                let vol = conf.isMuted ? 0 : conf.volume;
                if (conf.fadeIn && localTime < 1.0) vol *= localTime;
                else if (conf.fadeOut && localTime > conf.duration - 1.0)
                  vol *= conf.duration - localTime;
                gainNode.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.05);
              } else {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
              }
            }
          } else {
            if (conf.type === 'video') {
              const videoEl = element as HTMLVideoElement;
              if (!videoEl.paused) {
                videoEl.pause();
              }
            }
            if (conf.type === 'video' && gainNode && audioCtxRef.current) {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
            }
          }
        });

        // Audio Tracks
        const processAudioTrack = (track: AudioTrack | null, trackId: string) => {
          const element = mediaElementsRef.current[trackId] as HTMLAudioElement;
          const gainNode = gainNodesRef.current[trackId];

          if (track && element && gainNode && audioCtxRef.current) {
            if (isActivePlaying) {
              if (time < track.delay) {
                gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.01);
                if (!element.paused) element.pause();
              } else {
                let vol = track.volume;
                const trackTime = time - track.delay + track.startPoint;
                const playDuration = time - track.delay;

                if (trackTime <= track.duration) {
                  if (Math.abs(element.currentTime - trackTime) > 0.5) {
                    element.currentTime = trackTime;
                  }
                  if (element.paused) element.play().catch(() => { });

                  const fadeInDur = track.fadeInDuration || 1.0;
                  const fadeOutDur = track.fadeOutDuration || 1.0;

                  if (track.fadeIn && playDuration < fadeInDur) {
                    vol *= playDuration / fadeInDur;
                  }
                  if (track.fadeOut && time > totalDurationRef.current - fadeOutDur) {
                    const remaining = totalDurationRef.current - time;
                    vol *= Math.max(0, remaining / fadeOutDur);
                  }
                  gainNode.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.1);
                } else {
                  gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
                  if (!element.paused) element.pause();
                }
              }
            } else {
              gainNode.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.1);
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

        processAudioTrack(currentBgm, 'bgm');
        processAudioTrack(currentNarration, 'narration');
      } catch (e) {
        console.error('Render Error:', e);
      }
    },
    []
  );

  // 停止
  const stopAll = useCallback(
    (
      mediaElementsRef: React.MutableRefObject<Record<string, HTMLVideoElement | HTMLImageElement | HTMLAudioElement>>,
      gainNodesRef: React.MutableRefObject<Record<string, GainNode>>,
      audioCtxRef: React.MutableRefObject<AudioContext | null>,
      recorderRef: React.MutableRefObject<MediaRecorder | null>
    ) => {
      if (reqIdRef.current) {
        cancelAnimationFrame(reqIdRef.current);
        reqIdRef.current = null;
      }

      setIsPlaying(false);

      Object.values(mediaElementsRef.current).forEach((el) => {
        if (el && (el.tagName === 'VIDEO' || el.tagName === 'AUDIO')) {
          try {
            (el as HTMLMediaElement).pause();
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

      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
    },
    []
  );

  // シーク変更
  const handleSeekChange = useCallback(
    (
      e: React.ChangeEvent<HTMLInputElement>,
      stopAllFn: () => void,
      renderFrameFn: (time: number, isPlaying: boolean) => void
    ) => {
      const t = parseFloat(e.target.value);
      setCurrentTime(t);
      currentTimeRef.current = t;

      if (isPlaying) {
        setIsPlaying(false);
        stopAllFn();
      }

      renderFrameFn(t, false);
    },
    [isPlaying]
  );

  // シーク完了
  const handleSeeked = useCallback(
    (renderFrameFn: (time: number) => void) => {
      requestAnimationFrame(() => renderFrameFn(currentTimeRef.current));
    },
    []
  );

  return {
    isPlaying,
    setIsPlaying,
    currentTime,
    setCurrentTime,
    currentTimeRef,
    canvasRef,
    reqIdRef,
    startTimeRef,
    renderFrame,
    stopAll,
    handleSeekChange,
    handleSeeked,
  };
}

export default usePlayback;
