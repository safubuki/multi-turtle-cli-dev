/**
 * @file MiniPreview.tsx
 * @author Turtle Village
 * @description クリップの調整（移動・拡大）時に、対象クリップのみを個別にプレビュー表示するコンポーネント。パフォーマンスを重視し、メインCanvasとは独立して描画する。
 */
import React, { useRef, useEffect, useCallback } from 'react';
import type { MediaItem } from '../../types';

interface MiniPreviewProps {
  item: MediaItem;
  mediaElement: HTMLVideoElement | HTMLImageElement | null;
}

const MINI_CANVAS_WIDTH = 96;
const MINI_CANVAS_HEIGHT = 54;
const ORIGINAL_WIDTH = 1280;

/**
 * ミニプレビューコンポーネント
 * トランスフォームパネル内に埋め込み表示
 */
const MiniPreview: React.FC<MiniPreviewProps> = ({ item, mediaElement }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number | null>(null);
  const isVisibleRef = useRef<boolean>(false);
  const lastRenderTimeRef = useRef<number>(0);

  // itemの最新状態をRefに保持し、renderFrameの再生成を防ぐ
  const itemRef = useRef(item);

  // 描画関数 (itemへの依存を除去)
  const renderFrame = useCallback((force: boolean = false) => {
    // 画面外なら描画しない
    if (!isVisibleRef.current) return;

    const currentItem = itemRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !mediaElement) return;

    // ビデオ再生中のFPS制限 (約15fps = 66ms間隔)
    if (!force && currentItem.type === 'video') {
      const now = Date.now();
      if (now - lastRenderTimeRef.current < 66) {
        return;
      }
      lastRenderTimeRef.current = now;
    }

    // 背景をクリア
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MINI_CANVAS_WIDTH, MINI_CANVAS_HEIGHT);

    // スケール比率 (プレビュー枠サイズ / オリジナルサイズ)
    const previewRatio = MINI_CANVAS_WIDTH / ORIGINAL_WIDTH;

    // メディアの元サイズを取得
    let elemW = 0;
    let elemH = 0;
    if (currentItem.type === 'video') {
      const video = mediaElement as HTMLVideoElement;
      elemW = video.videoWidth;
      elemH = video.videoHeight;
    } else {
      const img = mediaElement as HTMLImageElement;
      elemW = img.naturalWidth;
      elemH = img.naturalHeight;
    }

    if (elemW > 0 && elemH > 0) {
      // アスペクト比を維持するための基本スケール (object-contain相当)
      const baseScale = Math.min(MINI_CANVAS_WIDTH / elemW, MINI_CANVAS_HEIGHT / elemH);

      // トランスフォーム適用
      ctx.save();

      // 位置計算: プレビュー比率に合わせて縮小
      const userX = currentItem.positionX * previewRatio;
      const userY = currentItem.positionY * previewRatio;

      // 中心基準で移動とスケール
      ctx.translate(MINI_CANVAS_WIDTH / 2 + userX, MINI_CANVAS_HEIGHT / 2 + userY);
      ctx.scale(baseScale * currentItem.scale, baseScale * currentItem.scale);

      // メディアを描画 (中心基準なので -w/2, -h/2)
      try {
        if (currentItem.type === 'video') {
          const video = mediaElement as HTMLVideoElement;
          if (video.readyState >= 2) {
            ctx.drawImage(video, -elemW / 2, -elemH / 2, elemW, elemH);
          }
        } else {
          ctx.drawImage(mediaElement, -elemW / 2, -elemH / 2, elemW, elemH);
        }
      } catch {
        // 描画エラーは無視
      }

      ctx.restore();
    }

    // 境界線を描画（プレビュー範囲を示す）
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, MINI_CANVAS_WIDTH, MINI_CANVAS_HEIGHT);
  }, [mediaElement]); // itemへの依存を削除

  useEffect(() => {
    itemRef.current = item;
    // プロパティ変更時は即時反映 (force=true)
    requestAnimationFrame(() => renderFrame(true));
  }, [item, renderFrame]);

  // アニメーションループ管理
  const startLoop = useCallback(() => {
    if (animationRef.current) cancelAnimationFrame(animationRef.current);

    const loop = () => {
      renderFrame(false); // 通常ループは throttled
      animationRef.current = requestAnimationFrame(loop);
    };
    loop();
  }, [renderFrame]);

  const stopLoop = useCallback(() => {
    if (animationRef.current) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
  }, []);

  // Intersection Observer 設定 (可視判定)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        isVisibleRef.current = entry.isIntersecting;

        if (entry.isIntersecting) {
          // 画面内に入った時
          renderFrame(true); // 即座に1回描画

          // 動画が再生中ならループ開始
          if (itemRef.current.type === 'video' && mediaElement) {
            const video = mediaElement as HTMLVideoElement;
            if (!video.paused && !video.ended) {
              startLoop();
            }
          }
        } else {
          // 画面外に出た時はループ停止
          stopLoop();
        }
      });
    }, {
      threshold: 0.1 // 10%見えたら描画開始
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      stopLoop();
    };
  }, [mediaElement, renderFrame, startLoop, stopLoop]); // item.typeへの依存も除去（ref参照のため）

  // 動画イベントリスナー設定
  useEffect(() => {
    // itemRef.current.type のチェックはここではなく内部で行うか、
    // mediaElementの型チェックだけで十分とする（画像ならplayイベントは起きない）
    if (!mediaElement || mediaElement.tagName !== 'VIDEO') return;

    const video = mediaElement as HTMLVideoElement;

    const handlePlay = () => {
      if (isVisibleRef.current) startLoop();
    };

    const handlePause = () => {
      stopLoop();
      renderFrame(true); // 停止位置で念のため再描画
    };

    const handleSeeked = () => {
      requestAnimationFrame(() => renderFrame(true)); // シーク後は確実に描画
    };

    const handleLoaded = () => {
      renderFrame(true);
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('seeked', handleSeeked);
    video.addEventListener('loadeddata', handleLoaded);
    video.addEventListener('timeupdate', () => { /* Loopで処理するので不要だが、Loopが止まった場合の保険として何かするならここ */ });

    // 初期状態チェック
    if (!video.paused && isVisibleRef.current) {
      startLoop();
    } else {
      // マウント時に一度描画
      requestAnimationFrame(() => renderFrame(true));
    }

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('seeked', handleSeeked);
      video.removeEventListener('loadeddata', handleLoaded);
      stopLoop();
    };
  }, [mediaElement, startLoop, stopLoop, renderFrame]); // itemへの依存を完全排除

  // プロパティ変更時の再描画 (静止画・動画(停止中)の変形操作への追従)
  // このuseEffectはitemRefのuseEffectに統合されたため削除
  // useEffect(() => {
  //   // プロパティ変更はユーザー操作によるものなので force=true で即時反映
  //   requestAnimationFrame(() => renderFrame(true));
  // }, [item.scale, item.positionX, item.positionY, renderFrame]);

  return (
    <div
      ref={containerRef}
      className="mt-2 rounded-lg overflow-hidden border border-gray-600"
    >
      {/* プレビュー */}
      <div className="relative bg-black">
        <canvas
          ref={canvasRef}
          width={MINI_CANVAS_WIDTH}
          height={MINI_CANVAS_HEIGHT}
          className="block w-full"
        />

        {/* トランスフォーム情報オーバーレイ */}
        <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] text-gray-300 flex justify-between">
          <span>Scale: {(item.scale * 100).toFixed(0)}%</span>
          <span>X: {item.positionX} Y: {item.positionY}</span>
        </div>
      </div>
    </div>
  );
};

export default React.memo(MiniPreview);
