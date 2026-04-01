/**
 * @file PreviewSection.tsx
 * @author Turtle Village
 * @description 編集中の動画をリアルタイムでプレビュー再生、シーク、およびファイルへの書き出しを行うセクションコンポーネント。
 */
import React, { RefObject, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  Pause,
  Square,
  Download,
  Loader,
  RotateCcw,
  MonitorPlay,
  AlertCircle,
  Camera,
  CircleHelp,
} from 'lucide-react';
import type { MediaItem, AudioTrack, NarrationClip } from '../../types';
import type { ExportPreparationStep } from '../../hooks/useExport';

const PREVIEW_ICON_BUTTON_BASE =
  'relative overflow-hidden p-3 lg:p-4 rounded-full border transition-[transform,background-color,color,box-shadow,filter] duration-200 shadow-lg active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed';
const PREVIEW_STOP_BUTTON =
  'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500';
const PREVIEW_CAPTURE_BUTTON =
  'border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white disabled:border-gray-700 disabled:bg-gray-800 disabled:text-gray-500';
const EXPORT_RENDERING_READY_TIME_SEC = 0.25;

interface PreviewSectionProps {
  mediaItems: MediaItem[];
  bgm: AudioTrack | null;
  narrations: NarrationClip[];
  canvasRef: RefObject<HTMLCanvasElement | null>;
  currentTime: number;
  totalDuration: number;
  isPlaying: boolean;
  isProcessing: boolean;
  exportPreparationStep: ExportPreparationStep | null;
  isLoading: boolean;
  exportUrl: string | null;
  exportExt: string | null;
  onSeekChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSeekStart: () => void;
  onSeekEnd: () => void;
  onTogglePlay: () => void;
  onStop: () => void;
  onExport: () => void;
  onDownload: () => void;
  onClearAll: () => void;
  onCapture: () => void;
  onOpenHelp: () => void;
  formatTime: (seconds: number) => string;
}

/**
 * プレビューセクションコンポーネント
 */
const PreviewSection: React.FC<PreviewSectionProps> = ({
  mediaItems,
  bgm,
  narrations,
  canvasRef,
  currentTime,
  totalDuration,
  isPlaying,
  isProcessing,
  exportPreparationStep,
  isLoading,
  exportUrl,
  exportExt,
  onSeekChange,
  onSeekStart,
  onSeekEnd,
  onTogglePlay,
  onStop,
  onExport,
  onDownload,
  onClearAll,
  onCapture,
  onOpenHelp,
  formatTime,
}) => {
  const [exportPhase, setExportPhase] = useState<'preparing' | 'rendering' | 'stalled'>('preparing');
  const [isCapturePressed, setIsCapturePressed] = useState(false);
  const lastProgressAtRef = useRef<number>(Date.now());
  const lastObservedTimeRef = useRef<number>(currentTime);
  const hasExportProgressRef = useRef<boolean>(false);
  const flashTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!isProcessing) {
      setExportPhase('preparing');
      lastObservedTimeRef.current = currentTime;
      lastProgressAtRef.current = Date.now();
      hasExportProgressRef.current = false;
      return;
    }

    const delta = currentTime - lastObservedTimeRef.current;
    const renderingReadyTime = totalDuration > 0
      ? Math.min(EXPORT_RENDERING_READY_TIME_SEC, Math.max(0.05, totalDuration * 0.1))
      : EXPORT_RENDERING_READY_TIME_SEC;

    // Export 開始時に前回の停止位置から 0 秒へ戻る巻き戻しは、進捗ではなく準備フェーズとして扱う。
    if (delta <= -0.05) {
      lastObservedTimeRef.current = currentTime;
      lastProgressAtRef.current = Date.now();
      hasExportProgressRef.current = false;
      return;
    }

    if (delta >= 0.05) {
      lastObservedTimeRef.current = currentTime;
      lastProgressAtRef.current = Date.now();
      if (currentTime >= renderingReadyTime) {
        hasExportProgressRef.current = true;
      }
    }
  }, [currentTime, isProcessing, totalDuration]);

  useEffect(() => {
    if (!isProcessing) return;

    const updatePhase = () => {
      // まだ時刻進行が始まっていない段階は「準備中」として扱う。
      if (!hasExportProgressRef.current) {
        setExportPhase('preparing');
        return;
      }
      const stagnantMs = Date.now() - lastProgressAtRef.current;
      setExportPhase(stagnantMs > 1500 ? 'stalled' : 'rendering');
    };

    updatePhase();
    const timer = setInterval(updatePhase, 250);
    return () => clearInterval(timer);
  }, [isProcessing]);

  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== null) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  const exportProgressPct = useMemo(() => {
    if (!isProcessing || totalDuration <= 0) return 0;
    return Math.min(100, Math.max(0, (currentTime / totalDuration) * 100));
  }, [currentTime, isProcessing, totalDuration]);

  const exportButtonText = useMemo(() => {
    if (!isProcessing) return '動画ファイルを作成';
    if (exportPhase === 'preparing') return `書き出し準備 ${exportPreparationStep ?? 1}/4...`;
    if (exportPhase === 'stalled') return 'フレーム待機中...';
    return `映像を生成中... ${exportProgressPct.toFixed(0)}%`;
  }, [exportPhase, exportPreparationStep, exportProgressPct, isProcessing]);

  const exportStatusText = useMemo(() => {
    if (!isProcessing || exportPhase === 'preparing') return null;
    if (exportPhase === 'stalled') {
      return '処理に時間がかかっています。しばらく待っても進まない場合は中断して再実行してください。';
    }
    return '映像を生成中です。';
  }, [exportPhase, isProcessing]);

  const triggerCaptureFeedback = (callback: () => void) => {
    if (flashTimeoutRef.current !== null) {
      window.clearTimeout(flashTimeoutRef.current);
    }
    setIsCapturePressed(true);
    callback();
    flashTimeoutRef.current = window.setTimeout(() => {
      setIsCapturePressed(false);
      flashTimeoutRef.current = null;
    }, 420);
  };

  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
      <div className="p-3 lg:p-4 border-b border-gray-800 bg-gray-850 flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2 text-green-400 md:text-base lg:text-lg">
          <span className="w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-green-500/10 flex items-center justify-center text-xs lg:text-sm">
            5
          </span>{' '}
          プレビュー
          <button
            onClick={onOpenHelp}
            className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
            title="このセクションの説明"
            aria-label="プレビューセクションの説明"
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        </h2>
        <div className="flex items-center gap-2">
          {isProcessing && (
            <span className="text-[10px] md:text-xs text-green-400 font-mono animate-pulse bg-green-900/30 px-2 py-0.5 rounded">
              REC ●
            </span>
          )}
        </div>
      </div>
      <div className="relative aspect-video bg-black w-full group">
        <canvas
          ref={canvasRef}
          width={1280}
          height={720}
          className="w-full h-full object-contain"
        />
        {mediaItems.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <MonitorPlay className="w-12 h-12 lg:w-16 lg:h-16 text-gray-800" />
          </div>
        )}
        {isLoading && mediaItems.length > 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50 pointer-events-none">
            <div className="flex flex-col items-center gap-2">
              <Loader className="w-8 h-8 lg:w-10 lg:h-10 text-blue-400 animate-spin" />
              <span className="text-xs lg:text-sm text-gray-300">読み込み中...</span>
            </div>
          </div>
        )}
        {!isPlaying && !isProcessing && !isLoading && mediaItems.length > 0 && (
          <button
            onClick={onTogglePlay}
            className="absolute inset-0 m-auto w-14 h-14 lg:w-16 lg:h-16 bg-white/20 hover:bg-white/30 backdrop-blur rounded-full flex items-center justify-center text-white transition-transform active:scale-95"
          >
            <Play className="w-6 h-6 lg:w-8 lg:h-8 fill-current ml-1" />
          </button>
        )}
      </div>
      <div className="p-4 lg:p-5 bg-gray-900 border-t border-gray-800">
        <div className="flex justify-between text-[10px] md:text-xs lg:text-sm font-mono text-gray-400 mb-2">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(totalDuration)}</span>
        </div>
        {isProcessing && (
          <div className="mb-3 rounded-xl border border-amber-400/40 bg-gradient-to-r from-amber-500/10 via-orange-500/10 to-rose-500/10 px-3 py-2.5 lg:px-4 lg:py-3 shadow-[0_6px_20px_rgba(251,146,60,0.14)]">
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 w-6 h-6 rounded-lg border border-amber-300/40 bg-amber-300/10 flex items-center justify-center shrink-0">
                <AlertCircle className="w-3.5 h-3.5 text-amber-200" />
              </div>
              <div>
                <p className="text-[11px] md:text-[12px] lg:text-sm leading-snug font-semibold text-amber-100">
                  動画作成中はこの画面のままお待ちください
                </p>
                <p className="text-[10px] md:text-[11px] lg:text-xs leading-snug text-amber-200/90 mt-0.5">
                  画面を切り替えると映像・音声が乱れます
                </p>
                {exportStatusText && (
                  <p className="text-[10px] md:text-[11px] lg:text-xs leading-snug text-amber-100/90 mt-1">
                    {exportStatusText}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}
        <div className="relative h-8 w-full select-none">
          <div className="absolute top-3 w-full h-2 bg-gray-800 rounded-full overflow-hidden">
            <div className="flex w-full h-full opacity-60">
              {mediaItems.map((v, i) => (
                <div
                  key={v.id}
                  style={{ width: `${(v.duration / totalDuration) * 100}%` }}
                  className={
                    v.type === 'image'
                      ? 'bg-yellow-600'
                      : i % 2 === 0
                        ? 'bg-blue-600'
                        : 'bg-blue-500'
                  }
                />
              ))}
            </div>
          </div>
          <input
            type="range"
            min="0"
            max={totalDuration || 0.1}
            step="0.1"
            value={currentTime}
            onChange={onSeekChange}
            onPointerDown={onSeekStart}
            onMouseDown={onSeekStart}
            onTouchStart={onSeekStart}
            onPointerUp={onSeekEnd}
            onPointerCancel={onSeekEnd}
            onMouseUp={onSeekEnd}
            onTouchEnd={onSeekEnd}
            onTouchCancel={onSeekEnd}
            onBlur={onSeekEnd}
            className="absolute top-0 w-full h-full opacity-0 cursor-pointer z-10"
            disabled={mediaItems.length === 0 || isProcessing}
          />
          {!isProcessing && mediaItems.length > 0 && (
            <div
              className="absolute top-1.5 w-5 h-5 bg-white shadow-lg rounded-full pointer-events-none z-0 border-2 border-gray-200"
              style={{ left: `calc(${(currentTime / (totalDuration || 1)) * 100}% - 10px)` }}
            />
          )}
        </div>
        <div className="mt-4 flex justify-center gap-4 border-b border-gray-800 pb-6">
          <button
            type="button"
            onClick={onStop}
            disabled={mediaItems.length === 0 || isLoading}
            title="プレビューを停止"
            aria-label="プレビューを停止"
            className={`${PREVIEW_ICON_BUTTON_BASE} ${PREVIEW_STOP_BUTTON}`}
          >
            <Square className="w-5 h-5 lg:w-6 lg:h-6 fill-current" />
          </button>
          <button
            onClick={onTogglePlay}
            disabled={mediaItems.length === 0 || isLoading}
            className={`p-3 lg:p-4 rounded-full transition shadow-lg ${isLoading ? 'bg-gray-700 text-gray-400 cursor-wait' : isPlaying ? 'bg-gray-700 text-white hover:bg-gray-600' : 'bg-blue-600 text-white hover:bg-blue-500'}`}
          >
            {isLoading ? <Loader className="w-5 h-5 lg:w-6 lg:h-6 animate-spin" /> : isPlaying ? <Pause className="w-5 h-5 lg:w-6 lg:h-6" /> : <Play className="w-5 h-5 lg:w-6 lg:h-6 ml-0.5" />}
          </button>
          <button
            type="button"
            onClick={() => triggerCaptureFeedback(onCapture)}
            disabled={mediaItems.length === 0 || isProcessing || isLoading}
            title="プレビューをキャプチャ"
            aria-label="プレビューをキャプチャ"
            className={`${PREVIEW_ICON_BUTTON_BASE} ${PREVIEW_CAPTURE_BUTTON} ${
              isCapturePressed
                ? 'animate-preview-capture-press bg-emerald-700 text-white border-emerald-400/90 shadow-[0_0_0_4px_rgba(167,243,208,0.42),0_0_26px_rgba(16,185,129,0.52)]'
                : ''
            }`}
          >
            <Camera className="w-5 h-5 lg:w-6 lg:h-6" />
          </button>
        </div>
        <div className="mt-6 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4">
            <button
              onClick={onClearAll}
              disabled={mediaItems.length === 0 && !bgm && narrations.length === 0}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm lg:text-base font-medium text-gray-400 hover:bg-red-900/20 hover:text-red-400 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCcw className="w-4 h-4 lg:w-5 lg:h-5" /> 一括クリア
            </button>
            {exportUrl ? (
              <button
                type="button"
                onClick={onDownload}
                className="bg-green-600 hover:bg-green-500 text-white px-6 py-2.5 rounded-full text-sm lg:text-base font-bold flex items-center gap-2 animate-bounce-short shadow-lg"
              >
                <Download className="w-4 h-4 lg:w-5 lg:h-5" /> ダウンロード (.{exportExt})
              </button>
            ) : (
              <button
                onClick={onExport}
                disabled={isProcessing || mediaItems.length === 0}
                className={`flex-1 max-w-xs flex items-center justify-center gap-2 px-6 py-2.5 lg:py-3 rounded-full text-sm lg:text-base font-bold shadow-lg transition ${isProcessing ? 'bg-gray-700 text-gray-400 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'}`}
              >
                {isProcessing && (
                  <Loader className="animate-spin w-4 h-4 lg:w-5 lg:h-5" />
                )}
                {exportButtonText}
              </button>
            )}
          </div>
          {exportUrl && exportExt === 'webm' && (
            <div className="bg-yellow-900/30 border border-yellow-700/50 p-3 rounded-lg flex items-start gap-2 text-xs text-yellow-200">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <div>
                <p className="font-bold">重要: SNS投稿について</p>
                <p>
                  お使いのブラウザはMP4出力に非対応のため、互換性の高いWebM形式で保存しました。
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default React.memo(PreviewSection);
