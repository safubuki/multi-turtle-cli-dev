import { describe, expect, it } from 'vitest';
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

describe('getPreviewPlatformPolicy', () => {
  it('iOS Safari では preview/export 向けの緩和値を返す', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(policy.previewSyncThresholdSec).toBe(1.0);
    expect(policy.exportSyncThresholdSec).toBe(1.2);
    expect(policy.needsCaptionBlurFallback).toBe(true);
    expect(policy.muteNativeMediaWhenAudioRouted).toBe(true);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(true);
    expect(policy.reinitializeAudioRouteOnPlay).toBe(true);
    expect(policy.audioContextResumeRetryCount).toBe(2);
  });

  it('非 iOS Safari では既定値を返す', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(policy.previewSyncThresholdSec).toBe(0.5);
    expect(policy.exportSyncThresholdSec).toBe(0.5);
    expect(policy.needsCaptionBlurFallback).toBe(false);
    expect(policy.muteNativeMediaWhenAudioRouted).toBe(false);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(false);
    expect(policy.reinitializeAudioRouteOnPlay).toBe(false);
    expect(policy.audioContextResumeRetryCount).toBe(2);
  });

  it('Android は export 中だけ native mute を有効にする', () => {
    const policy = getPreviewPlatformPolicy({
      isAndroid: true,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(policy.muteNativeMediaWhenAudioRouted).toBe(false);
    expect(policy.muteNativeMediaDuringExportWhenAudioRouted).toBe(true);
  });
  it('iOS Safari の将来動画 warm-up は動画開始点だけを probe する', () => {
    expect(
      getFutureVideoAudioProbeTimes([
        { type: 'image', duration: 2 },
        { type: 'video', duration: 3 },
        { type: 'image', duration: 1 },
        { type: 'video', duration: 0.04 },
      ], 0),
    ).toEqual([2.05, 6.02]);

    expect(
      getFutureVideoAudioProbeTimes([
        { type: 'image', duration: 2 },
        { type: 'video', duration: 3 },
        { type: 'image', duration: 1 },
        { type: 'video', duration: 2 },
      ], 2.2),
    ).toEqual([6.05]);
  });

  it('iOS Safari preview の BGM 単独再生は WebAudio を維持する', () => {
    const iosPolicy = getPreviewPlatformPolicy({
      isAndroid: false,
      isIosSafari: true,
      audioContextMayInterrupt: true,
    });

    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'bgm',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'audio',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'bgm',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 1,
        outputMode: 'webaudio',
      },
    ]);
  });
});

describe('preview platform helpers', () => {
  const iosPolicy = getPreviewPlatformPolicy({
    isAndroid: false,
    isIosSafari: true,
    audioContextMayInterrupt: true,
  });

  it('export の再生失敗時は fallback しきい値を返す', () => {
    expect(
      getPreviewVideoSyncThreshold(iosPolicy, {
        isExporting: true,
        hasExportPlayFailure: true,
      }),
    ).toBe(0.35);
  });

  it('caption blur fallback の要否を返す', () => {
    expect(shouldUseCaptionBlurFallback(iosPolicy, 2)).toBe(true);
    expect(shouldUseCaptionBlurFallback(iosPolicy, 0)).toBe(false);
  });

  it('AudioNode があるときだけ native mute 判定を返す', () => {
    expect(shouldMuteNativeMediaElement(iosPolicy, { hasAudioNode: true, isExporting: false })).toBe(true);
    expect(shouldMuteNativeMediaElement(iosPolicy, { hasAudioNode: false, isExporting: false })).toBe(false);
  });

  it('Android は export 中だけ native mute 判定を返す', () => {
    const androidPolicy = getPreviewPlatformPolicy({
      isAndroid: true,
      isIosSafari: false,
      audioContextMayInterrupt: false,
    });

    expect(shouldMuteNativeMediaElement(androidPolicy, { hasAudioNode: true, isExporting: false })).toBe(false);
    expect(shouldMuteNativeMediaElement(androidPolicy, { hasAudioNode: true, isExporting: true })).toBe(true);
  });

  it('iOS Safari preview は未接続の単一音源だけ native 出力にする', () => {
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('native');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 2,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 0.5,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: true,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: true,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'video',
      }),
    ).toBe('webaudio');
    expect(
      getPreviewAudioOutputMode(iosPolicy, {
        hasAudioNode: false,
        isExporting: false,
        audibleSourceCount: 1,
        desiredVolume: 1,
        sourceType: 'audio',
      }),
    ).toBe('webaudio');
  });

  it('iOS Safari preview の複数音源は開始前判定でもまとめて WebAudio に寄せる', () => {
    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'video:1',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'video',
          },
          {
            id: 'bgm',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'audio',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'video:1',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 2,
        outputMode: 'webaudio',
      },
      {
        id: 'bgm',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 2,
        outputMode: 'webaudio',
      },
    ]);
  });

  it('iOS Safari preview の単一音源は開始前判定でも native fallback を維持する', () => {
    expect(
      getPreviewAudioRoutingPlan(iosPolicy, {
        isExporting: false,
        candidates: [
          {
            id: 'video:1',
            hasAudioNode: false,
            desiredVolume: 1,
            sourceType: 'video',
          },
        ],
      }),
    ).toEqual([
      {
        id: 'video:1',
        hasAudioNode: false,
        desiredVolume: 1,
        audibleSourceCount: 1,
        outputMode: 'native',
      },
    ]);
  });

  it('可視復帰時の AudioContext resume 判定と再初期化判定を返す', () => {
    expect(shouldResumeAudioContextOnVisibilityReturn(iosPolicy, 'interrupted')).toBe(true);
    expect(shouldResumeAudioContextOnVisibilityReturn(iosPolicy, 'running')).toBe(false);
    expect(shouldReinitializeAudioRoute(iosPolicy, false)).toBe(true);
    expect(shouldReinitializeAudioRoute(iosPolicy, true)).toBe(false);
  });

  it('動画クリップ終端では非最終クリップでも最終フレーム保持を優先する', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.96,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.97,
        videoEnded: true,
      }),
    ).toBe(true);
  });

  it('クリップ終端前なら ended していない動画を通常再生のまま扱う', () => {
    expect(
      shouldHoldVideoFrameAtClipEnd({
        clipLocalTime: 1.2,
        clipDuration: 2,
        trimStart: 3,
        videoCurrentTime: 4.2,
        videoEnded: false,
      }),
    ).toBe(false);
  });
});
