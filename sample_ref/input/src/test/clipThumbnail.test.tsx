import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClipThumbnail from '../components/common/ClipThumbnail';

const getPlatformCapabilitiesMock = vi.fn();

vi.mock('../utils/platform', () => ({
  getPlatformCapabilities: () => getPlatformCapabilitiesMock(),
}));

type VideoMockControls = {
  createElementSpy: ReturnType<typeof vi.spyOn>;
  playSpy: ReturnType<typeof vi.fn>;
  pauseSpy: ReturnType<typeof vi.fn>;
  getCreatedVideo: () => HTMLVideoElement | null;
};

function installVideoElementMock(): VideoMockControls {
  const originalCreateElement = document.createElement.bind(document);
  let createdVideo: HTMLVideoElement | null = null;

  const playSpy = vi.fn(async () => {
    setTimeout(() => {
      createdVideo?.dispatchEvent(new Event('playing'));
      createdVideo?.dispatchEvent(new Event('timeupdate'));
    }, 0);
  });
  const pauseSpy = vi.fn();
  const loadSpy = vi.fn(function (this: HTMLVideoElement) {
    setTimeout(() => {
      this.dispatchEvent(new Event('loadedmetadata'));
      this.dispatchEvent(new Event('loadeddata'));
      this.dispatchEvent(new Event('canplay'));
    }, 0);
  });

  const createElementSpy = vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    const element = originalCreateElement(tagName);
    if (tagName.toLowerCase() !== 'video') {
      return element;
    }

    const video = element as HTMLVideoElement;
    createdVideo = video;
    let currentTime = 0;

    Object.defineProperty(video, 'readyState', {
      configurable: true,
      get: () => 4,
    });
    Object.defineProperty(video, 'duration', {
      configurable: true,
      get: () => 10,
    });
    Object.defineProperty(video, 'videoWidth', {
      configurable: true,
      get: () => 1920,
    });
    Object.defineProperty(video, 'videoHeight', {
      configurable: true,
      get: () => 1080,
    });
    Object.defineProperty(video, 'seeking', {
      configurable: true,
      get: () => false,
    });
    Object.defineProperty(video, 'currentTime', {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
        setTimeout(() => {
          video.dispatchEvent(new Event('loadeddata'));
          video.dispatchEvent(new Event('canplay'));
          video.dispatchEvent(new Event('seeked'));
        }, 0);
      },
    });
    Object.defineProperty(video, 'play', {
      configurable: true,
      value: playSpy,
    });
    Object.defineProperty(video, 'pause', {
      configurable: true,
      value: pauseSpy,
    });
    Object.defineProperty(video, 'load', {
      configurable: true,
      value: loadSpy,
    });

    return video;
  }) as typeof document.createElement);

  return {
    createElementSpy,
    playSpy,
    pauseSpy,
    getCreatedVideo: () => createdVideo,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

beforeEach(() => {
  getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: false });
});

describe('ClipThumbnail', () => {
  it('iOS Safari では一時 video を DOM に置いてフレームを prime する', async () => {
    const { getCreatedVideo, playSpy } = installVideoElementMock();
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');
    getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: true });

    const file = new File(['video'], 'ios.mov', { type: 'video/quicktime' });
    const { container } = render(<ClipThumbnail file={file} type="video" />);
    const canvas = container.querySelector('canvas');

    await waitFor(() => expect(playSpy).toHaveBeenCalled());
    await waitFor(() => expect(canvas).toHaveClass('opacity-100'));

    const createdVideo = getCreatedVideo();
    expect(createdVideo).not.toBeNull();
    expect(createdVideo?.getAttribute('playsinline')).toBe('');
    expect(createdVideo?.getAttribute('webkit-playsinline')).toBe('');
    expect(appendSpy.mock.calls.some(([node]) => node === createdVideo)).toBe(true);
    expect(removeSpy.mock.calls.some(([node]) => node === createdVideo)).toBe(true);
  });

  it('iOS Safari 以外では DOM 配置や再生 prime を行わない', async () => {
    const { getCreatedVideo, playSpy } = installVideoElementMock();
    const appendSpy = vi.spyOn(document.body, 'appendChild');

    const file = new File(['video'], 'desktop.mp4', { type: 'video/mp4' });
    const { container } = render(<ClipThumbnail file={file} type="video" />);
    const canvas = container.querySelector('canvas');

    await waitFor(() => expect(canvas).toHaveClass('opacity-100'));

    const createdVideo = getCreatedVideo();
    expect(createdVideo).not.toBeNull();
    expect(playSpy).not.toHaveBeenCalled();
    expect(appendSpy.mock.calls.some(([node]) => node === createdVideo)).toBe(false);
  });
});
