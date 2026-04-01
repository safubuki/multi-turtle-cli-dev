/**
 * @file NarrationSection.tsx
 * @author Turtle Village
 * @description Narration section (multiple clips)
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  Upload,
  Lock,
  Unlock,
  CircleHelp,
  Mic,
  Sparkles,
  Volume2,
  VolumeX,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  ArrowUp,
  ArrowDown,
  Trash2,
  MapPin,
  FileAudio,
  Edit2,
  Save,
} from 'lucide-react';
import type { NarrationClip } from '../../types';
import { getAudioUploadAccept } from '../../utils/platform';
import { SwipeProtectedSlider } from '../SwipeProtectedSlider';

interface NarrationSectionProps {
  narrations: NarrationClip[];
  offlineMode: boolean;
  isNarrationLocked: boolean;
  totalDuration: number;
  currentTime: number;
  onToggleNarrationLock: () => void;
  onAddAiNarration: () => void;
  onEditAiNarration: (id: string) => void;
  onNarrationUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemoveNarration: (id: string) => void;
  onMoveNarration: (id: string, direction: 'up' | 'down') => void;
  onSaveNarration: (id: string) => void;
  onUpdateStartTime: (id: string, value: string) => void;
  onSetStartTimeToCurrent: (id: string) => void;
  onUpdateVolume: (id: string, value: string) => void;
  onToggleMute: (id: string) => void;
  onUpdateTrimStart: (id: string, value: string) => void;
  onUpdateTrimEnd: (id: string, value: string) => void;
  formatTime: (seconds: number) => string;
  onOpenHelp: () => void;
}

const NarrationSection: React.FC<NarrationSectionProps> = ({
  narrations,
  offlineMode,
  isNarrationLocked,
  totalDuration,
  currentTime,
  onToggleNarrationLock,
  onAddAiNarration,
  onEditAiNarration,
  onNarrationUpload,
  onRemoveNarration,
  onMoveNarration,
  onSaveNarration,
  onUpdateStartTime,
  onSetStartTimeToCurrent,
  onUpdateVolume,
  onToggleMute,
  onUpdateTrimStart,
  onUpdateTrimEnd,
  formatTime,
  onOpenHelp,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openTrimMap, setOpenTrimMap] = useState<Record<string, boolean>>({});
  const prevNarrationCountRef = useRef(narrations.length);
  const audioFileAccept = getAudioUploadAccept();

  const handleStartTimeChange = useCallback(
    (id: string, val: number) => onUpdateStartTime(id, String(val)),
    [onUpdateStartTime]
  );

  const handleVolumeChange = useCallback(
    (id: string, val: number) => onUpdateVolume(id, String(val)),
    [onUpdateVolume]
  );

  const handleTrimStartChange = useCallback(
    (id: string, val: number) => onUpdateTrimStart(id, String(val)),
    [onUpdateTrimStart]
  );

  const handleTrimEndChange = useCallback(
    (id: string, val: number) => onUpdateTrimEnd(id, String(val)),
    [onUpdateTrimEnd]
  );

  useEffect(() => {
    if (narrations.length > prevNarrationCountRef.current) {
      setIsOpen(true);
    }
    prevNarrationCountRef.current = narrations.length;
  }, [narrations.length]);

  const isAiAddDisabled = isNarrationLocked || offlineMode;

  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
      <div
        className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center gap-2 cursor-pointer hover:bg-gray-800/50 transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h2 className="font-bold flex items-center gap-1.5 md:gap-2 text-indigo-400 md:text-base lg:text-lg min-w-0 flex-1">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-indigo-500/10 flex items-center justify-center text-xs lg:text-sm">
            3
          </span>
          <span className="truncate">ナレーション</span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenHelp();
            }}
            className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 shrink-0"
            title="このセクションの説明"
            aria-label="ナレーションセクションの説明"
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        </h2>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={onToggleNarrationLock}
            className={`p-1 rounded-lg transition ${isNarrationLocked ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600'}`}
            title={isNarrationLocked ? 'ロック解除' : 'ロック'}
            aria-label={isNarrationLocked ? 'ナレーションセクションのロックを解除' : 'ナレーションセクションをロック'}
          >
            {isNarrationLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
          <button
            onClick={onAddAiNarration}
            disabled={isAiAddDisabled}
            className={`h-7 md:h-8 px-2 md:px-2.5 rounded-lg text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1 ${
              isAiAddDisabled
                ? 'bg-gray-700 border border-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-linear-to-r from-indigo-600 to-blue-600 hover:from-indigo-500 hover:to-blue-500 text-white'
            }`}
            title={
              offlineMode
                ? 'オフラインモードではAIナレーションを追加できません'
                : isNarrationLocked
                  ? 'ロック中はAIナレーションを追加できません'
                  : 'AIナレーションを追加'
            }
          >
            <Sparkles className="w-3 h-3" /> AI
          </button>
          <label
            className={`cursor-pointer h-7 md:h-8 bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/45 text-white px-2 md:px-2.5 rounded-lg text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1 ${isNarrationLocked ? 'opacity-50 pointer-events-none' : ''}`}
          >
            <Upload className="w-3 h-3" /> 追加
            <input
              type="file"
              accept={audioFileAccept}
              multiple
              className="hidden"
              onChange={onNarrationUpload}
              disabled={isNarrationLocked}
            />
          </label>
        </div>
      </div>

      {isOpen && (
        <div className="p-3 lg:p-4 space-y-3 max-h-75 lg:max-h-128 overflow-y-auto custom-scrollbar">
          {narrations.length === 0 && (
            <div className="text-center py-8 text-gray-600 text-xs md:text-sm border-2 border-dashed border-gray-800 rounded">
              {offlineMode
                ? 'ナレーションはまだありません。追加で作成できます。'
                : 'ナレーションはまだありません。AIまたは追加で作成できます。'}
            </div>
          )}

          {narrations.map((clip, index) => {
            const isAi = clip.sourceType === 'ai';
            const isAiEditDisabled = isNarrationLocked || !isAi || offlineMode;
            const isTrimOpen = openTrimMap[clip.id] ?? false;
            const trimStart = Number.isFinite(clip.trimStart) ? Math.max(0, clip.trimStart) : 0;
            const trimEnd = Number.isFinite(clip.trimEnd)
              ? Math.max(trimStart, Math.min(clip.duration, clip.trimEnd))
              : clip.duration;
            const playableDuration = Math.max(0.05, trimEnd - trimStart);
            const rawEndTime = clip.startTime + playableDuration;
            const hasEndMarker = totalDuration > 0;
            const clampedEndTime = hasEndMarker
              ? Math.max(0, Math.min(totalDuration, rawEndTime))
              : 0;
            const endMarkerPercent = hasEndMarker
              ? (clampedEndTime / totalDuration) * 100
              : 0;
            const isEndOverflow = rawEndTime > totalDuration;

            return (
              <div key={clip.id} className="p-3 bg-indigo-900/10 border border-indigo-500/20 rounded-xl space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs text-gray-500 font-mono shrink-0">[{index + 1}]</span>
                    {isAi ? <Mic className="w-3.5 h-3.5 text-indigo-400 shrink-0" /> : <FileAudio className="w-3.5 h-3.5 text-cyan-400 shrink-0" />}
                    <span className="text-xs md:text-sm text-indigo-100 truncate" title={clip.file.name}>
                      {clip.file.name}
                    </span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${isAi ? 'bg-indigo-500/20 text-indigo-200' : 'bg-cyan-500/20 text-cyan-200'}`}>
                      {isAi ? 'AI' : 'FILE'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => onMoveNarration(clip.id, 'up')}
                      disabled={index === 0 || isNarrationLocked}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 disabled:opacity-30 disabled:transition-none text-[10px] transition"
                      title="上へ移動"
                    >
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onMoveNarration(clip.id, 'down')}
                      disabled={index === narrations.length - 1 || isNarrationLocked}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 disabled:opacity-30 disabled:transition-none text-[10px] transition"
                      title="下へ移動"
                    >
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onEditAiNarration(clip.id)}
                      disabled={isAiEditDisabled}
                      className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 disabled:opacity-30 disabled:transition-none text-[10px] transition"
                      title={
                        !isAi
                          ? '追加したナレーションはAI編集できません'
                          : offlineMode
                            ? 'オフラインモードではAI編集できません'
                            : 'AIで編集'
                      }
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => onRemoveNarration(clip.id)}
                      disabled={isNarrationLocked}
                      className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded border border-red-800/50 disabled:opacity-30 text-[10px] transition"
                      title="削除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                    {clip.blobUrl && (
                      <button
                        onClick={() => onSaveNarration(clip.id)}
                        disabled={isNarrationLocked}
                        className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 text-[10px] transition disabled:opacity-30"
                        title="音声を保存"
                      >
                        <Save className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px] md:text-xs text-gray-400">
                    <span>開始位置: {formatTime(clip.startTime)}</span>
                    <span>長さ: {formatTime(playableDuration)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1 pt-3">
                      {hasEndMarker && (
                        <div
                          className="pointer-events-none absolute top-0 -translate-x-1/2 z-10"
                          style={{ left: `${endMarkerPercent}%` }}
                          aria-hidden="true"
                        >
                          <div
                            className={`w-0 h-0 border-l-[7px] border-r-[7px] border-l-transparent border-r-transparent border-t-[9px] ${isEndOverflow ? 'border-t-amber-400/90' : 'border-t-indigo-300/90'}`}
                          />
                        </div>
                      )}
                      <SwipeProtectedSlider
                        min={0}
                        max={Math.max(0, totalDuration)}
                        step={0.1}
                        value={clip.startTime}
                        onChange={(val) => handleStartTimeChange(clip.id, val)}
                        disabled={isNarrationLocked}
                        className="w-full accent-indigo-500 h-1 bg-gray-700 rounded appearance-none disabled:opacity-50"
                      />
                    </div>
                    <button
                      onClick={() => onSetStartTimeToCurrent(clip.id)}
                      disabled={isNarrationLocked}
                      className="p-1 text-gray-400 hover:text-indigo-300 disabled:opacity-30"
                      title={`現在位置(${formatTime(currentTime)})を開始位置に設定`}
                    >
                      <MapPin className="w-3.5 h-3.5" />
                    </button>
                    <input
                      type="number"
                      min="0"
                      max={Math.max(0, totalDuration)}
                      step="0.1"
                      value={clip.startTime}
                      onChange={(e) => onUpdateStartTime(clip.id, e.target.value)}
                      disabled={isNarrationLocked}
                      className="w-16 md:w-20 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] md:text-xs text-right focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                    />
                    <span className="text-[10px] md:text-xs text-gray-500">秒</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    setOpenTrimMap((prev) => ({
                      ...prev,
                      [clip.id]: !(prev[clip.id] ?? false),
                    }));
                  }}
                  disabled={isNarrationLocked}
                  className="text-xs md:text-sm flex items-center gap-1 text-gray-400 hover:text-white disabled:opacity-50"
                >
                  {isTrimOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>トリミング設定</span>
                </button>

                {isTrimOpen && (
                  <div className="px-2 mb-1 space-y-2 border-t border-gray-700/50 pt-2 mt-1 bg-gray-900/30 rounded p-2">
                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] md:text-xs text-gray-400">
                        <span>トリミング開始: {formatTime(trimStart)}</span>
                        <span>元音声: {formatTime(clip.duration)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <SwipeProtectedSlider
                          min={0}
                          max={Math.max(0, clip.duration)}
                          step={0.1}
                          value={trimStart}
                          onChange={(val) => handleTrimStartChange(clip.id, val)}
                          disabled={isNarrationLocked}
                          className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded appearance-none disabled:opacity-50"
                        />
                        <input
                          type="number"
                          min="0"
                          max={Math.max(0, trimEnd - 0.05)}
                          step="0.1"
                          value={trimStart}
                          onChange={(e) => onUpdateTrimStart(clip.id, e.target.value)}
                          disabled={isNarrationLocked}
                          className="w-16 md:w-20 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] md:text-xs text-right focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                        />
                        <span className="text-[10px] md:text-xs text-gray-500">秒</span>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between text-[10px] md:text-xs text-gray-400">
                        <span>トリミング終了: {formatTime(trimEnd)}</span>
                        <span>範囲: {formatTime(playableDuration)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <SwipeProtectedSlider
                          min={0}
                          max={Math.max(0, clip.duration)}
                          step={0.1}
                          value={trimEnd}
                          onChange={(val) => handleTrimEndChange(clip.id, val)}
                          disabled={isNarrationLocked}
                          className="flex-1 accent-indigo-500 h-1 bg-gray-700 rounded appearance-none disabled:opacity-50"
                        />
                        <input
                          type="number"
                          min={Math.min(Math.max(0, trimStart + 0.05), Math.max(0, clip.duration))}
                          max={Math.max(0, clip.duration)}
                          step="0.1"
                          value={trimEnd}
                          onChange={(e) => onUpdateTrimEnd(clip.id, e.target.value)}
                          disabled={isNarrationLocked}
                          className="w-16 md:w-20 bg-gray-700 border border-gray-600 rounded px-1 text-[10px] md:text-xs text-right focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                        />
                        <span className="text-[10px] md:text-xs text-gray-500">秒</span>
                      </div>
                    </div>
                  </div>
                )}

                <div className="bg-gray-800/50 p-2 rounded-lg flex items-center gap-2">
                  <button
                    onClick={() => onToggleMute(clip.id)}
                    disabled={isNarrationLocked}
                    className={`p-1 rounded transition ${clip.isMuted ? 'bg-red-500/20 text-red-300' : 'text-gray-400 hover:text-white'} disabled:opacity-50`}
                    title={clip.isMuted ? 'ミュート解除' : 'ミュート'}
                  >
                    {clip.isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
                  </button>
                  <SwipeProtectedSlider
                    min={0}
                    max={2.5}
                    step={0.05}
                    value={clip.volume}
                    onChange={(val) => handleVolumeChange(clip.id, val)}
                    disabled={isNarrationLocked || clip.isMuted}
                    className={`flex-1 accent-indigo-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 ${(isNarrationLocked || clip.isMuted) ? '' : 'cursor-pointer'}`}
                  />
                  <span className="text-[10px] md:text-xs text-gray-400 w-10 text-right">{Math.round(clip.volume * 100)}%</span>
                  <button
                    onClick={() => onUpdateVolume(clip.id, '1')}
                    disabled={isNarrationLocked}
                    className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition disabled:opacity-50"
                    title="リセット"
                  >
                    <RefreshCw className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};

export default React.memo(NarrationSection);
