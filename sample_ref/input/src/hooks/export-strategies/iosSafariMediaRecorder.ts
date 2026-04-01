import { useLogStore } from '../../stores/logStore';
import type { IosSafariMediaRecorderStrategyContext } from './types';

type RequestFrameCapableTrack = MediaStreamTrack & {
  requestFrame?: () => void;
};

export async function runIosSafariMediaRecorderStrategy(
  context: IosSafariMediaRecorderStrategyContext,
): Promise<boolean> {
  const {
    canvas,
    masterDest,
    audioContext,
    signal,
    audioSources,
    callbacks,
    state,
    refs,
    exportConfig,
    supportedMediaRecorderProfile,
  } = context;

  const profile = supportedMediaRecorderProfile;
  if (!profile) {
    useLogStore.getState().warn('RENDER', 'iOS Safari: MediaRecorder が未対応のため WebCodecs 経路へフォールバック');
    return false;
  }

  const canvasStream = canvas.captureStream(exportConfig.fps);
  const canvasVideoTrack = canvasStream.getVideoTracks()[0] as RequestFrameCapableTrack | undefined;
  const sourceAudioTracks = masterDest.stream.getAudioTracks();
  const liveAudioTracks = sourceAudioTracks.filter((track) => track.readyState === 'live');
  if (liveAudioTracks.length === 0) {
    useLogStore.getState().warn('RENDER', 'iOS Safari: 有効な音声トラックがないため WebCodecs 経路へフォールバック', {
      sourceTrackCount: sourceAudioTracks.length,
      sourceTrackStates: sourceAudioTracks.map((track) => track.readyState),
    });
    canvasStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    return false;
  }

  // 元トラックを stop すると後続エクスポートや再生に影響するため、録画用には clone を使用する。
  const recorderAudioTracks = liveAudioTracks.map((track) => track.clone());
  let keepAliveOscillator: OscillatorNode | null = null;
  let keepAliveGain: GainNode | null = null;
  let framePumpTimer: ReturnType<typeof setInterval> | null = null;
  let abortStopTimer: ReturnType<typeof setTimeout> | null = null;
  const combined = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...recorderAudioTracks,
  ]);

  // iOS Safari: 静止画主体のタイムラインでは Canvas 変化が少なく、
  // captureStream のフレーム供給が不安定になることがあるため、requestFrame で明示供給する。
  if (canvasVideoTrack && typeof canvasVideoTrack.requestFrame === 'function') {
    const frameIntervalMs = Math.max(16, Math.round(1000 / exportConfig.fps));
    framePumpTimer = setInterval(() => {
      try {
        canvasVideoTrack.requestFrame?.();
      } catch {
        // ignore
      }
    }, frameIntervalMs);
  }

  // iOS Safari で無音最適化されるのを防ぐため、極小レベルの keep-alive 音声を維持する。
  try {
    keepAliveOscillator = audioContext.createOscillator();
    keepAliveGain = audioContext.createGain();
    keepAliveOscillator.frequency.value = 440;
    keepAliveGain.gain.value = 0.00001;
    keepAliveOscillator.connect(keepAliveGain);
    keepAliveGain.connect(masterDest);
    keepAliveOscillator.start();
  } catch (err) {
    keepAliveOscillator = null;
    keepAliveGain = null;
    useLogStore.getState().warn('RENDER', 'iOS Safari: keep-alive 音声ノードの初期化に失敗（続行）', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const cleanupStreams = () => {
    canvasStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    recorderAudioTracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // ignore
      }
    });
    if (framePumpTimer) {
      clearInterval(framePumpTimer);
      framePumpTimer = null;
    }
    if (abortStopTimer) {
      clearTimeout(abortStopTimer);
      abortStopTimer = null;
    }
    if (keepAliveOscillator) {
      try {
        keepAliveOscillator.stop();
      } catch {
        // ignore
      }
      try {
        keepAliveOscillator.disconnect();
      } catch {
        // ignore
      }
      keepAliveOscillator = null;
    }
    if (keepAliveGain) {
      try {
        keepAliveGain.disconnect();
      } catch {
        // ignore
      }
      keepAliveGain = null;
    }
  };

  const recorderOptions: MediaRecorderOptions = {
    videoBitsPerSecond: exportConfig.videoBitrate,
    audioBitsPerSecond: 128000,
  };
  if (profile.mimeType) {
    recorderOptions.mimeType = profile.mimeType;
  }

  useLogStore.getState().info('RENDER', 'iOS Safari: MediaRecorder 経路でエクスポート開始', {
    mimeType: profile.mimeType || '(default)',
    extension: profile.extension,
    sourceAudioTrackCount: sourceAudioTracks.length,
    sourceAudioTrackStates: sourceAudioTracks.map((track) => track.readyState),
    recorderAudioTrackCount: recorderAudioTracks.length,
    hasCanvasFramePump: !!framePumpTimer,
  });

  let startedSuccessfully = false;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const chunks: Blob[] = [];
    let recorder: MediaRecorder | null = null;
    let pausedByVisibility = false;
    let visibilityListenersAttached = false;

    const finishResolve = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      reject(err);
    };

    const removeVisibilityListeners = () => {
      if (!visibilityListenersAttached || typeof document === 'undefined') return;
      document.removeEventListener('visibilitychange', handleRecorderVisibilityChange);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', handleRecorderVisibilityChange);
        window.removeEventListener('pageshow', handleRecorderVisibilityChange);
      }
      visibilityListenersAttached = false;
    };

    const handleRecorderVisibilityChange = () => {
      if (!recorder || recorder.state === 'inactive' || typeof document === 'undefined') return;
      const isVisible = document.visibilityState === 'visible';

      if (!isVisible) {
        if (recorder.state === 'recording') {
          try {
            recorder.pause();
            pausedByVisibility = true;
            useLogStore.getState().info('RENDER', 'iOS Safari: 非アクティブ化のため録画を一時停止');
          } catch (err) {
            useLogStore.getState().warn('RENDER', 'iOS Safari: 非アクティブ化時の録画一時停止に失敗', {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        return;
      }

      if (pausedByVisibility && recorder.state === 'paused') {
        try {
          recorder.resume();
          pausedByVisibility = false;
          useLogStore.getState().info('RENDER', 'iOS Safari: 可視復帰で録画を再開');
        } catch (err) {
          useLogStore.getState().warn('RENDER', 'iOS Safari: 可視復帰時の録画再開に失敗', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      try {
        canvasVideoTrack?.requestFrame?.();
      } catch {
        // ignore
      }
    };

    const addVisibilityListeners = () => {
      if (typeof document === 'undefined' || visibilityListenersAttached) return;
      document.addEventListener('visibilitychange', handleRecorderVisibilityChange);
      if (typeof window !== 'undefined') {
        window.addEventListener('focus', handleRecorderVisibilityChange);
        window.addEventListener('pageshow', handleRecorderVisibilityChange);
      }
      visibilityListenersAttached = true;
    };

    const cleanup = () => {
      signal.removeEventListener('abort', onAbort);
      removeVisibilityListeners();
      cleanupStreams();
    };

    const onAbort = () => {
      if (recorder && recorder.state !== 'inactive') {
        try {
          canvasVideoTrack?.requestFrame?.();
        } catch {
          // ignore
        }
        try {
          recorder.requestData();
        } catch {
          // ignore
        }
        // iOS Safari では requestData 直後に stop すると終端チャンクが欠落する場合があるため、
        // 最終フラッシュ時間を確保してから stop する。
        if (!abortStopTimer) {
          abortStopTimer = setTimeout(() => {
            abortStopTimer = null;
            if (recorder && recorder.state !== 'inactive') {
              try {
                recorder.stop();
              } catch {
                // ignore
              }
            }
          }, 180);
        }
      }
    };

    try {
      recorder = new MediaRecorder(combined, recorderOptions);
      refs.recorderRef.current = recorder;
    } catch (err) {
      cleanup();
      refs.recorderRef.current = null;
      useLogStore.getState().warn('RENDER', 'iOS Safari: MediaRecorder 初期化失敗、WebCodecs 経路へフォールバック', {
        error: err instanceof Error ? err.message : String(err),
      });
      finishResolve();
      return;
    }

    signal.addEventListener('abort', onAbort, { once: true });
    addVisibilityListeners();

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) {
        chunks.push(event.data);
      }
    };

    recorder.onerror = () => {
      cleanup();
      finishReject(new Error('MediaRecorder で録画中にエラーが発生しました'));
    };

    recorder.onstop = () => {
      cleanup();
      refs.recorderRef.current = null;

      if (chunks.length === 0) {
        finishReject(new Error('MediaRecorder の出力データが空です'));
        return;
      }

      const blob = new Blob(chunks, { type: profile.mimeType || 'video/mp4' });
      const url = URL.createObjectURL(blob);
      state.setExportUrl(url);
      state.setExportExt(profile.extension);

      useLogStore.getState().info('RENDER', 'iOS Safari: MediaRecorder エクスポート完了', {
        chunks: chunks.length,
        blobSizeBytes: blob.size,
        extension: profile.extension,
      });

      callbacks.onRecordingStop(url, profile.extension);
      finishResolve();
    };

    try {
      // iOS Safari では timeslice が粗いと終端側の時間解像度が荒くなるため、
      // 短めの timeslice でチャンクを小刻みに取り出す。
      recorder.start(250);
      try {
        canvasVideoTrack?.requestFrame?.();
      } catch {
        // ignore
      }
      startedSuccessfully = true;
      useLogStore.getState().info('RENDER', '[DIAG-READY] 音声準備完了、再生ループ開始通知（MediaRecorder経路）');
      audioSources?.onAudioPreRenderComplete?.();
      handleRecorderVisibilityChange();
    } catch (err) {
      cleanup();
      refs.recorderRef.current = null;
      useLogStore.getState().warn('RENDER', 'iOS Safari: MediaRecorder 開始失敗、WebCodecs 経路へフォールバック', {
        error: err instanceof Error ? err.message : String(err),
      });
      finishResolve();
    }
  });

  return startedSuccessfully;
}
