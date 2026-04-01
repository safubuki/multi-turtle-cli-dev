import { describe, expect, it } from 'vitest';
import {
  detectBrowserPlatform,
  getAudioUploadAccept,
  getPlatformCapabilities,
  getSupportedMediaRecorderProfile,
  supportsShowOpenFilePicker,
  supportsShowSaveFilePicker,
} from '../utils/platform';

describe('detectBrowserPlatform', () => {
  it('iPhone Safari を iOS Safari と判定する', () => {
    const platform = detectBrowserPlatform({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });

    expect(platform.isAndroid).toBe(false);
    expect(platform.isIOS).toBe(true);
    expect(platform.isSafari).toBe(true);
    expect(platform.isIosSafari).toBe(true);
  });

  it('iPadOS の MacIntel + touch を iOS と判定する', () => {
    const platform = detectBrowserPlatform({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      platform: 'MacIntel',
      maxTouchPoints: 5,
    });

    expect(platform.isAndroid).toBe(false);
    expect(platform.isIOS).toBe(true);
    expect(platform.isIosSafari).toBe(true);
  });

  it('CriOS は Safari 文字列を含んでも iOS Safari 扱いしない', () => {
    const platform = detectBrowserPlatform({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/135.0.0.0 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
    });

    expect(platform.isAndroid).toBe(false);
    expect(platform.isIOS).toBe(true);
    expect(platform.isSafari).toBe(false);
    expect(platform.isIosSafari).toBe(false);
  });

  it('Android Chrome を Android として検出する', () => {
    const platform = detectBrowserPlatform({
      userAgent:
        'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
    });

    expect(platform.isAndroid).toBe(true);
    expect(platform.isIOS).toBe(false);
    expect(platform.isSafari).toBe(false);
    expect(platform.isIosSafari).toBe(false);
  });
});

describe('getAudioUploadAccept', () => {
  it('iOS Safari では動画コンテナ由来音声を許可する', () => {
    const accept = getAudioUploadAccept({
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
      maxTouchPoints: 5,
      isAndroid: false,
      isIOS: true,
      isSafari: true,
      isIosSafari: true,
    });

    expect(accept).toContain('.mov');
    expect(accept).toContain('.mp4');
  });

  it('非 iOS Safari では audio/* に留める', () => {
    const accept = getAudioUploadAccept({
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36',
      platform: 'Linux armv8l',
      maxTouchPoints: 5,
      isAndroid: true,
      isIOS: false,
      isSafari: false,
      isIosSafari: false,
    });

    expect(accept).toBe('audio/*');
  });
});

describe('capability helpers', () => {
  it('showSaveFilePicker の有無を判定する', () => {
    expect(supportsShowSaveFilePicker({ showSaveFilePicker: async () => ({}) })).toBe(true);
    expect(supportsShowSaveFilePicker({})).toBe(false);
  });

  it('showOpenFilePicker の有無を判定する', () => {
    expect(supportsShowOpenFilePicker({ showOpenFilePicker: async () => [] })).toBe(true);
    expect(supportsShowOpenFilePicker({})).toBe(false);
  });

  it('MediaRecorder の対応 mimeType から MP4 優先でプロファイルを返す', () => {
    const profile = getSupportedMediaRecorderProfile({
      isTypeSupported: (mimeType: string) => mimeType.startsWith('video/mp4'),
    });

    expect(profile).toEqual({
      mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
      extension: 'mp4',
    });
  });

  it('platform capabilities に capability を集約する', () => {
    class MockTrackProcessor {
      readable = new ReadableStream<VideoFrame | AudioData>();
    }

    const capabilities = getPlatformCapabilities({
      navigator: {
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      },
      win: {
        showSaveFilePicker: async () => ({}),
        showOpenFilePicker: async () => [],
        MediaStreamTrackProcessor: MockTrackProcessor as never,
      },
      mediaRecorder: {
        isTypeSupported: (mimeType: string) => mimeType === 'video/mp4',
      },
    });

    expect(capabilities.isIosSafari).toBe(true);
    expect(capabilities.isAndroid).toBe(false);
    expect(capabilities.supportsShowSaveFilePicker).toBe(true);
    expect(capabilities.supportsShowOpenFilePicker).toBe(true);
    expect(capabilities.supportsTrackProcessor).toBe(true);
    expect(capabilities.supportsMp4MediaRecorder).toBe(true);
    expect(capabilities.audioContextMayInterrupt).toBe(true);
  });
});
