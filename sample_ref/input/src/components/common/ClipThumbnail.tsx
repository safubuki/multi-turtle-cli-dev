/**
 * @file ClipThumbnail.tsx
 * @author Turtle Village
 * @description メディアクリップのサムネイルを表示する軽量コンポーネント。
 * 画像はそのまま、動画は先頭フレームをキャプチャして表示する。
 */
import React, { useRef, useEffect, useState } from 'react';
import { getPlatformCapabilities } from '../../utils/platform';

interface ClipThumbnailProps {
  file: File;
  type: 'video' | 'image';
}

const THUMB_WIDTH = 48;
const THUMB_HEIGHT = 28;
const VIDEO_FRAME_WAIT_MS = 80;
const VIDEO_DRAW_RETRY_COUNT = 4;
const IOS_THUMBNAIL_MIN_PREPARE_MS = 180;
const IOS_THUMBNAIL_MAX_PREPARE_MS = 900;
const IOS_THUMBNAIL_PRIME_PLAY_MS = 220;

type FrameAwareVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (...args: unknown[]) => void) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

/**
 * クリップサムネイルコンポーネント
 * ヘッダー付近にメディアの小さなプレビューを表示する
 */
const ClipThumbnail: React.FC<ClipThumbnailProps> = ({ file, type }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    setReady(false);
    const { isIosSafari } = getPlatformCapabilities();

    let cancelled = false;
    let activeVideo: HTMLVideoElement | null = null;
    let detachActiveVideo: (() => void) | null = null;
    const timeoutIds = new Set<number>();
    const intervalIds = new Set<number>();

    const registerTimeout = (id: number): number => {
      timeoutIds.add(id);
      return id;
    };

    const registerInterval = (id: number): number => {
      intervalIds.add(id);
      return id;
    };

    const clearAllTimeouts = () => {
      timeoutIds.forEach((id) => window.clearTimeout(id));
      timeoutIds.clear();
    };

    const clearAllIntervals = () => {
      intervalIds.forEach((id) => window.clearInterval(id));
      intervalIds.clear();
    };

    const url = URL.createObjectURL(file);
    urlRef.current = url;

    const revokeUrl = () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      }
    };

    const wait = (ms: number): Promise<void> =>
      new Promise((resolve) => {
        const timeoutId = registerTimeout(window.setTimeout(() => {
          timeoutIds.delete(timeoutId);
          resolve();
        }, ms));
      });

    const waitForVideoReady = (video: HTMLVideoElement): Promise<void> =>
      new Promise((resolve) => {
        if (cancelled) {
          resolve();
          return;
        }

        const startedAt = Date.now();
        const minPrepareMs = isIosSafari ? IOS_THUMBNAIL_MIN_PREPARE_MS : 0;
        const maxPrepareMs = isIosSafari ? IOS_THUMBNAIL_MAX_PREPARE_MS : 400;
        let settled = false;
        let pollId = 0;
        let timeoutId = 0;

        const finish = () => {
          if (settled) return;
          settled = true;
          video.removeEventListener('seeked', onReady);
          video.removeEventListener('loadeddata', onReady);
          video.removeEventListener('canplay', onReady);
          video.removeEventListener('error', onReady);
          if (pollId) {
            window.clearInterval(pollId);
            intervalIds.delete(pollId);
          }
          if (timeoutId) {
            window.clearTimeout(timeoutId);
            timeoutIds.delete(timeoutId);
          }
          resolve();
        };

        const maybeReady = () => {
          if (cancelled) {
            finish();
            return;
          }
          const elapsed = Date.now() - startedAt;
          const isReady = video.readyState >= 2 && !video.seeking;
          if (!isReady && elapsed < maxPrepareMs) return;
          if (elapsed < minPrepareMs) return;
          finish();
        };

        const onReady = () => {
          maybeReady();
        };

        video.addEventListener('seeked', onReady);
        video.addEventListener('loadeddata', onReady);
        video.addEventListener('canplay', onReady);
        video.addEventListener('error', onReady);
        pollId = registerInterval(window.setInterval(maybeReady, 40));
        timeoutId = registerTimeout(window.setTimeout(maybeReady, maxPrepareMs + 50));
        maybeReady();
      });

    const waitForEvent = (
      target: EventTarget,
      eventName: string,
      timeoutMs: number
    ): Promise<boolean> =>
      new Promise((resolve) => {
        if (cancelled) {
          resolve(false);
          return;
        }

        let settled = false;
        const onEvent = () => finish(true);
        const finish = (result: boolean) => {
          if (settled) return;
          settled = true;
          target.removeEventListener(eventName, onEvent as EventListener);
          window.clearTimeout(timeoutId);
          timeoutIds.delete(timeoutId);
          resolve(result);
        };

        const timeoutId = registerTimeout(window.setTimeout(() => finish(false), timeoutMs));
        target.addEventListener(eventName, onEvent as EventListener, { once: true });
      });

    const drawCentered = (
      source: CanvasImageSource,
      sourceWidth: number,
      sourceHeight: number
    ): boolean => {
      if (sourceWidth <= 0 || sourceHeight <= 0) return false;

      const scale = Math.min(THUMB_WIDTH / sourceWidth, THUMB_HEIGHT / sourceHeight);
      const w = sourceWidth * scale;
      const h = sourceHeight * scale;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);

      try {
        ctx.drawImage(source, (THUMB_WIDTH - w) / 2, (THUMB_HEIGHT - h) / 2, w, h);
        return true;
      } catch {
        return false;
      }
    };

    const drawVideoFallback = () => {
      ctx.fillStyle = '#1f2937';
      ctx.fillRect(0, 0, THUMB_WIDTH, THUMB_HEIGHT);
      ctx.fillStyle = '#9ca3af';
      ctx.beginPath();
      ctx.moveTo(19, 8);
      ctx.lineTo(19, 20);
      ctx.lineTo(30, 14);
      ctx.closePath();
      ctx.fill();
    };

    const waitForDecodedFrame = async (video: FrameAwareVideo): Promise<void> => {
      if (cancelled) return;

      if (typeof video.requestVideoFrameCallback === 'function') {
        await new Promise<void>((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            timeoutIds.delete(timeoutId);
            resolve();
          };

          const callbackId = video.requestVideoFrameCallback?.(() => finish());
          const timeoutId = registerTimeout(window.setTimeout(() => {
            if (typeof callbackId === 'number' && typeof video.cancelVideoFrameCallback === 'function') {
              video.cancelVideoFrameCallback(callbackId);
            }
            finish();
          }, VIDEO_FRAME_WAIT_MS));
        });
        return;
      }

      await wait(VIDEO_FRAME_WAIT_MS);
    };

    const attachVideoForFrameCapture = (video: HTMLVideoElement): (() => void) | null => {
      if (!isIosSafari || typeof document === 'undefined' || !document.body) return null;

      video.setAttribute('aria-hidden', 'true');
      Object.assign(video.style, {
        position: 'fixed',
        top: '0',
        left: '0',
        width: `${THUMB_WIDTH}px`,
        height: `${THUMB_HEIGHT}px`,
        opacity: '0.01',
        pointerEvents: 'none',
        zIndex: '-1000',
        visibility: 'visible',
      });

      document.body.appendChild(video);

      return () => {
        if (video.parentNode) {
          video.parentNode.removeChild(video);
        }
      };
    };

    const primeVideoFrameForCapture = async (video: FrameAwareVideo, seekTime: number): Promise<void> => {
      if (!isIosSafari || cancelled) return;

      const playingPromise = waitForEvent(video, 'playing', IOS_THUMBNAIL_PRIME_PLAY_MS);
      const timeUpdatePromise = waitForEvent(video, 'timeupdate', IOS_THUMBNAIL_PRIME_PLAY_MS);
      try {
        const playResult = video.play();
        if (playResult && typeof (playResult as Promise<void>).catch === 'function') {
          void (playResult as Promise<void>).catch(() => {});
        }
      } catch {
        return;
      }

      await Promise.race([
        playingPromise,
        timeUpdatePromise,
        waitForDecodedFrame(video),
        wait(IOS_THUMBNAIL_PRIME_PLAY_MS),
      ]);

      try {
        video.pause();
      } catch {
        // ignore
      }

      if (cancelled) return;

      if (Math.abs(video.currentTime - seekTime) > 0.08) {
        await seekVideo(video, seekTime);
        await waitForVideoReady(video);
      }

      await waitForDecodedFrame(video);
    };

    const seekVideo = async (video: HTMLVideoElement, time: number): Promise<void> => {
      if (cancelled) return;

      const safeTime = Number.isFinite(time) ? Math.max(0, time) : 0;
      const needsSeek = Math.abs(video.currentTime - safeTime) > 0.03;
      if (!needsSeek) return;

      const seekPromise = waitForEvent(video, 'seeked', 1500);
      try {
        video.currentTime = safeTime;
        await seekPromise;
      } catch {
        // シーク失敗時は次の候補時刻へフォールバック
      }
    };

    const buildSeekCandidates = (duration: number): number[] => {
      if (!Number.isFinite(duration) || duration <= 0) return [0];

      const maxSeek = Math.max(0, duration - 0.05);
      const head = Math.min(1, duration * 0.1, maxSeek);
      const middle = Math.min(duration * 0.5, maxSeek);

      return Array.from(new Set([head, 0, middle].map((value) => Math.max(0, value))));
    };

    if (type === 'image') {
      const img = new Image();
      img.onload = () => {
        if (cancelled) return;
        drawCentered(img, img.naturalWidth, img.naturalHeight);
        setReady(true);
        revokeUrl();
      };
      img.onerror = () => {
        if (cancelled) return;
        drawVideoFallback();
        setReady(true);
        revokeUrl();
      };
      img.src = url;
    } else {
      const loadVideoThumbnail = async () => {
        const video = document.createElement('video') as FrameAwareVideo;
        activeVideo = video;
        video.muted = true;
        video.defaultMuted = true;
        video.preload = 'auto';
        video.playsInline = true;
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.src = url;
        const detachCaptureVideo = attachVideoForFrameCapture(video);
        detachActiveVideo = detachCaptureVideo;

        try {
          video.load();
        } catch {
          // ignore
        }

        const loadedMetadata = video.readyState >= 1 || await waitForEvent(video, 'loadedmetadata', 3000);
        if (!loadedMetadata || cancelled) {
          if (!cancelled) {
            drawVideoFallback();
            setReady(true);
          }
          detachCaptureVideo?.();
          revokeUrl();
          return;
        }

        const seekCandidates = buildSeekCandidates(video.duration);
        let captured = false;

        for (const seekTime of seekCandidates) {
          if (cancelled) break;

          await seekVideo(video, seekTime);
          await waitForVideoReady(video);
          await waitForDecodedFrame(video);
          await primeVideoFrameForCapture(video, seekTime);

          for (let retry = 0; retry < VIDEO_DRAW_RETRY_COUNT; retry++) {
            if (cancelled) break;
            if (drawCentered(video, video.videoWidth, video.videoHeight)) {
              captured = true;
              break;
            }
            await wait(60);
          }

          if (captured) break;
        }

        if (!cancelled) {
          if (!captured) {
            drawVideoFallback();
          }
          setReady(true);
        }
        try {
          video.pause();
        } catch {
          // ignore
        }
        detachCaptureVideo?.();
        detachActiveVideo = null;
        activeVideo = null;
        revokeUrl();
      };

      void loadVideoThumbnail();
    }

    return () => {
      cancelled = true;
      clearAllTimeouts();
      clearAllIntervals();
      try {
        activeVideo?.pause();
      } catch {
        // ignore
      }
      detachActiveVideo?.();
      activeVideo = null;
      detachActiveVideo = null;
      revokeUrl();
    };
  }, [file, type]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMB_WIDTH}
      height={THUMB_HEIGHT}
      className={`rounded shrink-0 border border-gray-600/50 ${ready ? 'opacity-100' : 'opacity-0'}`}
      style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
    />
  );
};

export default React.memo(ClipThumbnail);
