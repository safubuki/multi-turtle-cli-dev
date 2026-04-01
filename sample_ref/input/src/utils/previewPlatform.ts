/**
 * @file previewPlatform.ts
 * @description プレビュー再生に関わるブラウザ差分ポリシーを集約する utility。
 * `TurtleVideo.tsx` 側では個別の iOS 判定を持たず、このポリシーを参照して
 * 同期しきい値、caption blur fallback、AudioContext 復帰方針を決める。
 */

import type { PlatformCapabilities } from './platform';

export interface PreviewPlatformPolicy {
  previewSyncThresholdSec: number;
  exportSyncThresholdSec: number;
  exportFallbackSyncThresholdSec: number;
  needsCaptionBlurFallback: boolean;
  muteNativeMediaWhenAudioRouted: boolean;
  muteNativeMediaDuringExportWhenAudioRouted: boolean;
  reinitializeAudioRouteOnPlay: boolean;
  resumeAudioContextOnVisibilityReturn: boolean;
  visibilityRecoveryDebounceMs: number;
  audioContextResumeRetryCount: number;
}

export type PreviewAudioOutputMode = 'native' | 'webaudio';

export interface PreviewAudioRoutingCandidate {
  id: string;
  hasAudioNode: boolean;
  desiredVolume: number;
  sourceType?: 'video' | 'audio';
}

export interface PreviewAudioRoutingDecision extends PreviewAudioRoutingCandidate {
  audibleSourceCount: number;
  outputMode: PreviewAudioOutputMode;
}

export interface PreviewAudioProbeTimelineItem {
  type: 'video' | 'image';
  duration: number;
}

export interface VideoClipEndGuardOptions {
  clipLocalTime: number;
  clipDuration: number;
  trimStart: number;
  videoCurrentTime: number;
  videoEnded: boolean;
  clipEndGuardWindowSec?: number;
  videoEndToleranceSec?: number;
}

/**
 * プラットフォーム capability から、プレビュー制御用の方針を組み立てる。
 */
export function getPreviewPlatformPolicy(
  capabilities: Pick<PlatformCapabilities, 'isIosSafari' | 'isAndroid' | 'audioContextMayInterrupt'>,
): PreviewPlatformPolicy {
  return {
    previewSyncThresholdSec: capabilities.isIosSafari ? 1.0 : 0.5,
    exportSyncThresholdSec: capabilities.isIosSafari ? 1.2 : 0.5,
    exportFallbackSyncThresholdSec: 0.35,
    needsCaptionBlurFallback: capabilities.isIosSafari,
    muteNativeMediaWhenAudioRouted: capabilities.isIosSafari,
    muteNativeMediaDuringExportWhenAudioRouted: capabilities.isIosSafari || capabilities.isAndroid,
    reinitializeAudioRouteOnPlay: capabilities.isIosSafari,
    resumeAudioContextOnVisibilityReturn: true,
    visibilityRecoveryDebounceMs: 120,
    // 既存実装は全ブラウザで最大2回まで resume を試みていたため、その挙動を維持する。
    audioContextResumeRetryCount: 2,
  };
}

/**
 * 通常プレビュー/エクスポート/フォールバックの状況から、動画同期しきい値を返す。
 */
export function getPreviewVideoSyncThreshold(
  policy: PreviewPlatformPolicy,
  options: { isExporting: boolean; hasExportPlayFailure: boolean },
): number {
  if (options.isExporting) {
    return options.hasExportPlayFailure
      ? policy.exportFallbackSyncThresholdSec
      : policy.exportSyncThresholdSec;
  }

  return policy.previewSyncThresholdSec;
}

/**
 * iOS Safari 向けの caption blur fallback 描画が必要かを返す。
 */
export function shouldUseCaptionBlurFallback(
  policy: PreviewPlatformPolicy,
  blurStrength: number,
): boolean {
  return policy.needsCaptionBlurFallback && blurStrength > 0;
}

/**
 * WebAudio 経路が確立した要素について、ネイティブ音声出力をミュートすべきかを返す。
 */
export function shouldMuteNativeMediaElement(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
  },
): boolean {
  if (!options.hasAudioNode) {
    return false;
  }

  return options.isExporting
    ? policy.muteNativeMediaDuringExportWhenAudioRouted
    : policy.muteNativeMediaWhenAudioRouted;
}

/**
 * iOS Safari preview では単一音源時のみ native 出力へ逃がし、複数同時再生時は WebAudio mix を使う。
 */
export function getPreviewAudioOutputMode(
  policy: PreviewPlatformPolicy,
  options: {
    hasAudioNode: boolean;
    isExporting: boolean;
    audibleSourceCount: number;
    desiredVolume: number;
    sourceType?: 'video' | 'audio';
  },
): PreviewAudioOutputMode {
  if (!policy.muteNativeMediaWhenAudioRouted) {
    return 'webaudio';
  }

  // MediaElementAudioSourceNode を一度生成した要素は native 出力へ戻せないため、
  // ノード生成済みなら常に WebAudio 側で扱う。
  if (options.hasAudioNode) {
    return 'webaudio';
  }

  if (options.sourceType === 'audio' && !options.isExporting) {
    return 'webaudio';
  }

  // iOS Safari の native volume 経路は単一音源の再生確保には有効だが、
  // 音量変更・フェード・一時ミュートのような細かな制御は不安定になりやすい。
  if (Math.abs(options.desiredVolume - 1) > 0.001) {
    return 'webaudio';
  }

  if (!options.isExporting && options.audibleSourceCount <= 1) {
    return 'native';
  }

  return 'webaudio';
}

/**
 * 同一フレームで可聴な preview 音源群に対する出力モードをまとめて判定する。
 * iOS Safari では「複数音源なら全て WebAudio」に揃える必要があるため、
 * 候補ごとの個別判定ではなく全体の可聴数を先に確定してから決める。
 */
export function getPreviewAudioRoutingPlan(
  policy: PreviewPlatformPolicy,
  options: {
    isExporting: boolean;
    candidates: PreviewAudioRoutingCandidate[];
  },
): PreviewAudioRoutingDecision[] {
  const audibleSourceCount = options.candidates.reduce(
    (count, candidate) => count + (candidate.desiredVolume > 0 ? 1 : 0),
    0,
  );

  return options.candidates.map((candidate) => {
    const candidateAudibleSourceCount = candidate.desiredVolume > 0 ? audibleSourceCount : 0;
    return {
      id: candidate.id,
      hasAudioNode: candidate.hasAudioNode,
      desiredVolume: candidate.desiredVolume,
      audibleSourceCount: candidateAudibleSourceCount,
      outputMode: getPreviewAudioOutputMode(policy, {
        hasAudioNode: candidate.hasAudioNode,
        isExporting: options.isExporting,
        audibleSourceCount: candidateAudibleSourceCount,
        desiredVolume: candidate.desiredVolume,
        sourceType: candidate.sourceType,
      }),
    };
  });
}

/**
 * iOS Safari preview で将来の動画開始点だけを事前評価するための probe time を返す。
 * 単独動画 native fallback を壊さないよう、開始直後の少し先だけを warm-up 対象にする。
 */
export function getFutureVideoAudioProbeTimes(
  items: PreviewAudioProbeTimelineItem[],
  fromTime: number,
): number[] {
  const probeTimes: number[] = [];
  let cursor = 0;

  for (const item of items) {
    const startTime = cursor;
    const duration = Math.max(0, item.duration);
    cursor += duration;

    if (item.type !== 'video' || duration <= 0.001) {
      continue;
    }

    if (startTime <= fromTime + 0.0005) {
      continue;
    }

    const probeOffset = duration <= 0.1 ? duration / 2 : 0.05;
    probeTimes.push(startTime + probeOffset);
  }

  return probeTimes;
}

/**
 * クリップ終端直前に ended 済み動画を再始動すると position 0 へ巻き戻るため、
 * その瞬間だけ最終フレーム保持へ倒す。
 */
export function shouldHoldVideoFrameAtClipEnd(
  options: VideoClipEndGuardOptions,
): boolean {
  const clipDuration = Math.max(0, options.clipDuration);
  if (clipDuration <= 0) {
    return false;
  }

  const clipEndGuardWindowSec = options.clipEndGuardWindowSec ?? 0.2;
  const videoEndToleranceSec = options.videoEndToleranceSec ?? 0.05;
  const remainingClipTime = Math.max(0, clipDuration - Math.max(0, options.clipLocalTime));
  if (remainingClipTime > clipEndGuardWindowSec) {
    return false;
  }

  const safeClipEndTime = options.trimStart + Math.max(0, clipDuration - 0.001);
  return options.videoEnded || options.videoCurrentTime >= safeClipEndTime - videoEndToleranceSec;
}

/**
 * 可視復帰時に AudioContext の resume を試みるべきかを返す。
 */
export function shouldResumeAudioContextOnVisibilityReturn(
  policy: PreviewPlatformPolicy,
  state: AudioContextState | 'interrupted',
): boolean {
  return policy.resumeAudioContextOnVisibilityReturn && state !== 'running';
}

/**
 * 再生開始時に AudioContext の経路再初期化が必要かを返す。
 */
export function shouldReinitializeAudioRoute(
  policy: PreviewPlatformPolicy,
  isExportMode: boolean,
): boolean {
  return policy.reinitializeAudioRouteOnPlay && !isExportMode;
}
