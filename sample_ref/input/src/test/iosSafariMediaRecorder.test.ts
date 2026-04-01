import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runIosSafariMediaRecorderStrategy } from '../hooks/export-strategies/iosSafariMediaRecorder';

class FakeMediaStream {
  private readonly tracks: Array<{ kind: string }>;

  constructor(tracks: Array<{ kind: string }> = []) {
    this.tracks = tracks;
  }

  getTracks() {
    return this.tracks;
  }

  getVideoTracks() {
    return this.tracks.filter((track) => track.kind === 'video');
  }

  getAudioTracks() {
    return this.tracks.filter((track) => track.kind === 'audio');
  }
}

type FakeTrack = {
  kind: 'video' | 'audio';
  readyState: 'live' | 'ended';
  stop: ReturnType<typeof vi.fn>;
  clone?: () => FakeTrack;
  requestFrame?: ReturnType<typeof vi.fn>;
};

function createAudioContextDouble() {
  const oscillator = {
    frequency: { value: 0 },
    connect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    disconnect: vi.fn(),
  };
  const gain = {
    gain: { value: 0.00001 },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };

  return {
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  } as unknown as AudioContext;
}

function createCanvasDouble(videoTrack: FakeTrack) {
  const stream = new FakeMediaStream([videoTrack]);

  return {
    canvas: {
      captureStream: vi.fn(() => stream),
    } as unknown as HTMLCanvasElement,
    stream,
  };
}

function createCallbacks() {
  return {
    onRecordingStop: vi.fn(),
    onRecordingError: vi.fn(),
  };
}

function createStateSetters() {
  return {
    setExportUrl: vi.fn(),
    setExportExt: vi.fn(),
  };
}

describe('runIosSafariMediaRecorderStrategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('MediaStream', FakeMediaStream as unknown as typeof MediaStream);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('MediaRecorder profile が無い場合は WebCodecs へフォールバックする', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
    };
    const { canvas } = createCanvasDouble(videoTrack);

    const result = await runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      callbacks: createCallbacks(),
      state: createStateSetters(),
      refs: {
        recorderRef: { current: null },
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: null,
    });

    expect(result).toBe(false);
  });

  it('live な音声トラックが無い場合は canvas track を解放してフォールバックする', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const deadAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'ended',
      stop: vi.fn(),
      clone: () => deadAudioTrack,
    };

    const result = await runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([deadAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      callbacks: createCallbacks(),
      state: createStateSetters(),
      refs: {
        recorderRef: { current: null },
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    expect(result).toBe(false);
    expect(videoTrack.stop).toHaveBeenCalled();
  });

  it('成功時は MediaRecorder 経路で exportUrl/ext と callback を更新する', async () => {
    const videoTrack: FakeTrack = {
      kind: 'video',
      readyState: 'live',
      stop: vi.fn(),
      requestFrame: vi.fn(),
    };
    const recorderAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
    };
    const sourceAudioTrack: FakeTrack = {
      kind: 'audio',
      readyState: 'live',
      stop: vi.fn(),
      clone: () => recorderAudioTrack,
    };
    const { canvas } = createCanvasDouble(videoTrack);
    const callbacks = createCallbacks();
    const state = createStateSetters();
    const recorderRef = { current: null as MediaRecorder | null };
    const onAudioPreRenderComplete = vi.fn();
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:ios-export');

    class MockMediaRecorder {
      state: RecordingState = 'inactive';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      readonly start = vi.fn((timeslice?: number) => {
        this.state = 'recording';
        this.timeslice = timeslice;
        setTimeout(() => {
          this.ondataavailable?.({ data: new Blob(['ok']) } as BlobEvent);
          this.state = 'inactive';
          this.onstop?.();
        }, 0);
      });
      readonly pause = vi.fn(() => {
        this.state = 'paused';
      });
      readonly resume = vi.fn(() => {
        this.state = 'recording';
      });
      readonly requestData = vi.fn();
      readonly stop = vi.fn(() => {
        this.state = 'inactive';
        this.onstop?.();
      });
      timeslice?: number;

      constructor(
        readonly stream: MediaStream,
        readonly options?: MediaRecorderOptions,
      ) {}
    }

    vi.stubGlobal('MediaRecorder', MockMediaRecorder as unknown as typeof MediaRecorder);

    const promise = runIosSafariMediaRecorderStrategy({
      canvas,
      masterDest: {
        stream: new FakeMediaStream([sourceAudioTrack]),
      } as unknown as MediaStreamAudioDestinationNode,
      audioContext: createAudioContextDouble(),
      signal: new AbortController().signal,
      audioSources: {
        mediaItems: [],
        bgm: null,
        narrations: [],
        totalDuration: 1,
        onAudioPreRenderComplete,
      },
      callbacks,
      state,
      refs: {
        recorderRef,
      },
      exportConfig: {
        fps: 30,
        videoBitrate: 1_000_000,
      },
      supportedMediaRecorderProfile: {
        mimeType: 'video/mp4',
        extension: 'mp4',
      },
    });

    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe(true);
    expect(onAudioPreRenderComplete).toHaveBeenCalled();
    expect(state.setExportUrl).toHaveBeenCalledWith('blob:ios-export');
    expect(state.setExportExt).toHaveBeenCalledWith('mp4');
    expect(callbacks.onRecordingStop).toHaveBeenCalledWith('blob:ios-export', 'mp4');
    expect(videoTrack.requestFrame).toHaveBeenCalled();
    expect(videoTrack.stop).toHaveBeenCalled();
    expect(recorderAudioTrack.stop).toHaveBeenCalled();
    expect(recorderRef.current).toBeNull();
    expect(createObjectUrlSpy).toHaveBeenCalled();
  });
});
