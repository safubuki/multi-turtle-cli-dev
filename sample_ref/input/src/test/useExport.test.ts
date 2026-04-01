import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformCapabilities } from '../utils/platform';

const { mockGetPlatformCapabilities, mockRunIosSafariMediaRecorderStrategy } = vi.hoisted(() => ({
  mockGetPlatformCapabilities: vi.fn(),
  mockRunIosSafariMediaRecorderStrategy: vi.fn(),
}));

vi.mock('../utils/platform', async () => {
  const actual = await vi.importActual<typeof import('../utils/platform')>('../utils/platform');
  return {
    ...actual,
    getPlatformCapabilities: mockGetPlatformCapabilities,
  };
});

vi.mock('../hooks/export-strategies/iosSafariMediaRecorder', () => ({
  runIosSafariMediaRecorderStrategy: mockRunIosSafariMediaRecorderStrategy,
}));

import { useExport } from '../hooks/useExport';

function createPlatformCapabilities(
  overrides: Partial<PlatformCapabilities> = {},
): PlatformCapabilities {
  return {
    userAgent: 'test-agent',
    platform: 'test-platform',
    maxTouchPoints: 0,
    isAndroid: false,
    isIOS: false,
    isSafari: false,
    isIosSafari: false,
    supportsShowSaveFilePicker: false,
    supportsShowOpenFilePicker: false,
    supportsTrackProcessor: false,
    supportsMp4MediaRecorder: false,
    audioContextMayInterrupt: false,
    supportedMediaRecorderProfile: null,
    trackProcessorCtor: undefined,
    ...overrides,
  };
}

function createStartExportArgs() {
  const audioContext = {
    sampleRate: 48000,
    state: 'running',
  } as AudioContext;
  const canvasRef = {
    current: {
      width: 1280,
      height: 720,
      captureStream: vi.fn(),
    } as unknown as HTMLCanvasElement,
  };
  const masterDestRef = {
    current: {
      context: audioContext,
      stream: {
        getAudioTracks: () => [],
      },
    } as unknown as MediaStreamAudioDestinationNode,
  };

  return {
    canvasRef,
    masterDestRef,
    onRecordingStop: vi.fn(),
    onRecordingError: vi.fn(),
  };
}

describe('useExport', () => {
  beforeEach(() => {
    mockGetPlatformCapabilities.mockReset();
    mockRunIosSafariMediaRecorderStrategy.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('初期化に必要な ref が無ければ即座にエラーを返す', async () => {
    const { result } = renderHook(() => useExport());
    const onRecordingError = vi.fn();

    await act(async () => {
      await result.current.startExport(
        { current: null },
        { current: null },
        vi.fn(),
        onRecordingError,
      );
    });

    expect(onRecordingError).toHaveBeenCalledWith('エクスポートの初期化に失敗しました。');
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS 条件では iOS strategy を呼び出し、ハンドリング済みならそこで終了する', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );
    mockRunIosSafariMediaRecorderStrategy.mockResolvedValue(true);

    const { result } = renderHook(() => useExport());
    const args = createStartExportArgs();

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
    });

    expect(mockRunIosSafariMediaRecorderStrategy).toHaveBeenCalledTimes(1);
    expect(args.onRecordingError).not.toHaveBeenCalled();
    expect(result.current.isProcessing).toBe(false);
  });

  it('iOS strategy が false を返した場合は WebCodecs 側へフォールバックする', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );
    mockRunIosSafariMediaRecorderStrategy.mockResolvedValue(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const { result } = renderHook(() => useExport());
    const args = createStartExportArgs();

    await act(async () => {
      await result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
    });

    expect(mockRunIosSafariMediaRecorderStrategy).toHaveBeenCalledTimes(1);
    expect(args.onRecordingError).toHaveBeenCalledWith(
      expect.stringContaining('WebCodecsに対応していないブラウザです'),
    );
    expect(result.current.isProcessing).toBe(false);
  });

  it('stopExport は進行中セッションの AbortSignal を中断し、処理中状態を戻す', async () => {
    mockGetPlatformCapabilities.mockReturnValue(
      createPlatformCapabilities({
        isIOS: true,
        isSafari: true,
        isIosSafari: true,
        supportsMp4MediaRecorder: true,
        supportedMediaRecorderProfile: {
          mimeType: 'video/mp4',
          extension: 'mp4',
        },
      }),
    );

    let capturedSignal: AbortSignal | null = null;
    mockRunIosSafariMediaRecorderStrategy.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise<boolean>((resolve) => {
          capturedSignal = signal;
          signal.addEventListener('abort', () => resolve(false), { once: true });
        }),
    );

    const { result } = renderHook(() => useExport());
    const args = createStartExportArgs();

    await act(async () => {
      result.current.startExport(
        args.canvasRef,
        args.masterDestRef,
        args.onRecordingStop,
        args.onRecordingError,
      );
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.isProcessing).toBe(true);
    });
    expect(capturedSignal).not.toBeNull();

    act(() => {
      result.current.stopExport();
    });

    const activeSignal = capturedSignal;
    if (!activeSignal) {
      throw new Error('AbortSignal was not captured');
    }
    expect((activeSignal as AbortSignal).aborted).toBe(true);
    expect(result.current.isProcessing).toBe(false);

    await waitFor(() => {
      expect(args.onRecordingError).toHaveBeenCalledWith('エクスポートが中断されました');
    });
  });

  it('clearExportUrl は保持中の Blob URL を解放して state を空にする', () => {
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const { result } = renderHook(() => useExport());

    act(() => {
      result.current.setExportUrl('blob:test-export');
      result.current.setExportExt('mp4');
    });

    act(() => {
      result.current.clearExportUrl();
    });

    expect(revokeSpy).toHaveBeenCalledWith('blob:test-export');
    expect(result.current.exportUrl).toBeNull();
    expect(result.current.exportExt).toBeNull();
  });
});
