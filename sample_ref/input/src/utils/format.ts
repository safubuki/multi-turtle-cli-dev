/**
 * @file format.ts
 * @author Turtle Village
 * @description 時間表示、ファイルサイズ、パーセンテージなどの数値フォーマット変換を行うユーティリティ関数群。
 */

/**
 * 秒数を "分:秒" 形式にフォーマット
 * @param seconds - 秒数
 * @returns フォーマットされた時間文字列 (例: "1:30")
 */
export function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * 秒数を "分:秒.ミリ秒" 形式にフォーマット（詳細表示用）
 * @param seconds - 秒数
 * @returns フォーマットされた時間文字列 (例: "1:30.5")
 */
export function formatTimeDetailed(seconds: number): string {
  if (!seconds || isNaN(seconds) || !isFinite(seconds)) return '0:00.0';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);
  return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
}

/**
 * パーセンテージをフォーマット
 * @param value - 0〜1の値
 * @returns パーセンテージ文字列 (例: "50%")
 */
export function formatPercent(value: number): string {
  if (isNaN(value)) return '0%';
  return `${Math.round(value * 100)}%`;
}

/**
 * ファイルサイズをフォーマット
 * @param bytes - バイト数
 * @returns フォーマットされたサイズ (例: "1.5 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * 数値を安全にパース（NaN対策）
 * @param value - パースする値
 * @param defaultValue - デフォルト値
 * @param min - 最小値
 * @param max - 最大値
 * @returns パースされた数値
 */
export function safeParseFloat(
  value: string | number,
  defaultValue: number = 0,
  min?: number,
  max?: number
): number {
  let num = typeof value === 'number' ? value : parseFloat(value);
  if (isNaN(num)) num = defaultValue;
  if (min !== undefined) num = Math.max(min, num);
  if (max !== undefined) num = Math.min(max, num);
  return num;
}
