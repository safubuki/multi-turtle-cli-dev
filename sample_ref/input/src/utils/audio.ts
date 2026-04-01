/**
 * @file audio.ts
 * @author Turtle Village
 * @description 音声データの変換（PCM to WAV）、AudioContextの管理、ボリューム計算などのユーティリティ関数群。
 */

import { useLogStore } from '../stores/logStore';

/**
 * PCMデータをWAVフォーマットに変換
 * @param pcmData - 生のPCMデータ
 * @param sampleRate - サンプルレート (例: 24000)
 * @param numChannels - チャンネル数 (デフォルト: 1 = モノラル)
 * @param bitsPerSample - ビット深度 (デフォルト: 16)
 * @returns WAVフォーマットのArrayBuffer
 */
export function pcmToWav(
  pcmData: ArrayBuffer,
  sampleRate: number,
  numChannels: number = 1,
  bitsPerSample: number = 16
): ArrayBuffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  // ヘルパー: 文字列を書き込み
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  // RIFFヘッダー
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');

  // fmtチャンク
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // fmtチャンクサイズ
  view.setUint16(20, 1, true); // PCMフォーマット
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);

  // dataチャンク
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  // PCMデータをコピー
  const pcmView = new Uint8Array(pcmData);
  const wavView = new Uint8Array(buffer, 44);
  wavView.set(pcmView);

  return buffer;
}

/**
 * Base64文字列をArrayBufferに変換
 * @param base64 - Base64エンコードされた文字列
 * @returns ArrayBuffer
 */
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

/**
 * AudioContextを取得または作成（Safari対応）
 * @returns AudioContext
 */
export function getOrCreateAudioContext(): AudioContext {
  useLogStore.getState().debug('AUDIO', 'AudioContextを作成または取得');
  const AC = window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return new AC();
}

/**
 * オーディオトラックの再生位置を計算
 * @param globalTime - グローバルタイムライン時間
 * @param delay - 遅延時間
 * @param startPoint - 開始位置
 * @returns トラック内の再生位置
 */
export function calculateTrackTime(
  globalTime: number,
  delay: number,
  startPoint: number
): number {
  return globalTime - delay + startPoint;
}

/**
 * フェードボリュームを計算
 * @param baseVolume - 基本ボリューム
 * @param currentTime - 現在の時間
 * @param totalDuration - 総再生時間
 * @param fadeIn - フェードイン有効
 * @param fadeOut - フェードアウト有効
 * @param fadeDuration - フェード時間（秒）
 * @returns 計算されたボリューム
 */
export function calculateFadeVolume(
  baseVolume: number,
  currentTime: number,
  totalDuration: number,
  fadeIn: boolean,
  fadeOut: boolean,
  fadeDuration: number = 2.0
): number {
  let volume = baseVolume;

  if (fadeIn && currentTime < fadeDuration) {
    volume *= currentTime / fadeDuration;
  }

  if (fadeOut && currentTime > totalDuration - fadeDuration) {
    volume *= Math.max(0, (totalDuration - currentTime) / fadeDuration);
  }

  return Math.max(0, Math.min(1, volume));
}
