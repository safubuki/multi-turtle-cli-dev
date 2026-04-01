/**
 * @file canvas.ts
 * @author Turtle Village
 * @description Canvasへの画像・動画の描画、サイズ計算、クリア処理などを行うユーティリティ関数群。
 */

import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../constants';

/**
 * Canvasをクリア（黒で塗りつぶし）
 * @param ctx - CanvasRenderingContext2D
 */
export function clearCanvas(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 1.0;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
}

/**
 * メディア要素のサイズを取得
 * @param element - ビデオまたは画像要素
 * @returns { width, height } または null
 */
export function getMediaDimensions(
  element: HTMLVideoElement | HTMLImageElement
): { width: number; height: number } | null {
  if (element instanceof HTMLVideoElement) {
    const w = element.videoWidth;
    const h = element.videoHeight;
    if (w && h) return { width: w, height: h };
  } else if (element instanceof HTMLImageElement) {
    const w = element.naturalWidth;
    const h = element.naturalHeight;
    if (w && h) return { width: w, height: h };
  }
  return null;
}

/**
 * フィットするスケールを計算
 * @param elementWidth - 要素の幅
 * @param elementHeight - 要素の高さ
 * @param canvasWidth - Canvasの幅
 * @param canvasHeight - Canvasの高さ
 * @returns スケール値
 */
export function calculateFitScale(
  elementWidth: number,
  elementHeight: number,
  canvasWidth: number = CANVAS_WIDTH,
  canvasHeight: number = CANVAS_HEIGHT
): number {
  return Math.min(canvasWidth / elementWidth, canvasHeight / elementHeight);
}

/**
 * フェードアルファ値を計算
 * @param localTime - ローカル再生時間
 * @param duration - 総再生時間
 * @param fadeIn - フェードイン有効
 * @param fadeOut - フェードアウト有効
 * @param fadeDuration - フェード時間（秒）
 * @returns アルファ値 (0〜1)
 */
export function calculateFadeAlpha(
  localTime: number,
  duration: number,
  fadeIn: boolean,
  fadeOut: boolean,
  fadeDuration: number = 1.0
): number {
  let alpha = 1.0;

  if (fadeIn && localTime < fadeDuration) {
    alpha = localTime / fadeDuration;
  } else if (fadeOut && localTime > duration - fadeDuration) {
    alpha = (duration - localTime) / fadeDuration;
  }

  return Math.max(0, Math.min(1, alpha));
}

/**
 * メディア要素をCanvas中央に描画
 * @param ctx - CanvasRenderingContext2D
 * @param element - 描画するビデオまたは画像要素
 * @param options - 描画オプション
 */
export function drawMediaCentered(
  ctx: CanvasRenderingContext2D,
  element: HTMLVideoElement | HTMLImageElement,
  options: {
    scale?: number;
    offsetX?: number;
    offsetY?: number;
    alpha?: number;
  } = {}
): void {
  const { scale = 1.0, offsetX = 0, offsetY = 0, alpha = 1.0 } = options;

  const dims = getMediaDimensions(element);
  if (!dims) return;

  const baseScale = calculateFitScale(dims.width, dims.height);

  ctx.save();
  ctx.translate(CANVAS_WIDTH / 2 + offsetX, CANVAS_HEIGHT / 2 + offsetY);
  ctx.scale(baseScale * scale, baseScale * scale);
  ctx.globalAlpha = alpha;
  ctx.drawImage(element, -dims.width / 2, -dims.height / 2, dims.width, dims.height);
  ctx.restore();
  ctx.globalAlpha = 1.0;
}

/**
 * メディア要素が描画可能か判定
 * @param element - ビデオまたは画像要素
 * @returns 描画可能ならtrue
 */
export function isMediaReady(element: HTMLVideoElement | HTMLImageElement): boolean {
  if (element instanceof HTMLVideoElement) {
    return element.readyState >= 1;
  } else if (element instanceof HTMLImageElement) {
    return element.complete;
  }
  return false;
}

/**
 * ビデオの現在時間を安全に設定
 * @param video - ビデオ要素
 * @param time - 設定する時間
 * @param maxDuration - 最大長さ
 */
export function safeSetVideoTime(
  video: HTMLVideoElement,
  time: number,
  maxDuration?: number
): void {
  const max = maxDuration ?? video.duration;
  if (Number.isFinite(time) && Number.isFinite(max)) {
    video.currentTime = Math.max(0, Math.min(max, time));
  }
}

/**
 * Canvasの現在の内容をキャプチャしてPNG画像としてダウンロードする
 * @param canvas - キャプチャ対象のCanvas要素
 * @param filename - 保存ファイル名（拡張子なし）。未指定時はタイムスタンプベースの名前を生成
 * @returns ダウンロードが成功したらtrue、失敗したらfalse
 */
export function captureCanvasAsImage(
  canvas: HTMLCanvasElement,
  filename?: string
): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const name = filename || `turtle_capture_${Date.now()}`;
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(false);
            return;
          }
          const url = URL.createObjectURL(blob);
          try {
            const a = document.createElement('a');
            a.href = url;
            a.download = `${name}.png`;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            resolve(true);
          } finally {
            // ObjectURL を確実に解放
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }
        },
        'image/png'
      );
    } catch {
      resolve(false);
    }
  });
}
