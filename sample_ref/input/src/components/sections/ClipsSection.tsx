/**
 * @file ClipsSection.tsx
 * @author Turtle Village
 * @description 動画・画像クリップの管理を行うセクション。アップロード、並び替え、各クリップの基本操作（削除、複製）を提供するリストビュー。
 */
import React, { useRef } from 'react';
import { Upload, Lock, Unlock, CircleHelp } from 'lucide-react';
import type { MediaItem } from '../../types';
import ClipItem from '../media/ClipItem';

interface ClipsSectionProps {
  mediaItems: MediaItem[];
  mediaTimelineRanges: Record<string, { start: number; end: number }>;
  isClipsLocked: boolean;
  mediaElements: Record<string, HTMLVideoElement | HTMLImageElement>;
  onToggleClipsLock: () => void;
  onMediaUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onOpenMediaPicker: () => void;
  supportsShowOpenFilePicker: boolean;
  onMoveMedia: (index: number, direction: 'up' | 'down') => void;
  onRemoveMedia: (id: string) => void;
  onToggleMediaLock: (id: string) => void;
  onToggleTransformPanel: (id: string) => void;
  onUpdateVideoTrim: (id: string, type: 'start' | 'end', value: string) => void;
  onUpdateImageDuration: (id: string, value: string) => void;
  onUpdateMediaScale: (id: string, value: string | number) => void;
  onUpdateMediaPosition: (id: string, axis: 'x' | 'y', value: string) => void;
  onResetMediaSetting: (id: string, type: 'scale' | 'x' | 'y') => void;
  onUpdateMediaVolume: (id: string, value: number) => void;
  onToggleMediaMute: (id: string) => void;
  onToggleMediaFadeIn: (id: string, checked: boolean) => void;
  onToggleMediaFadeOut: (id: string, checked: boolean) => void;
  onUpdateFadeInDuration: (id: string, duration: number) => void;
  onUpdateFadeOutDuration: (id: string, duration: number) => void;
  onOpenHelp: () => void;
}

/**
 * クリップセクションコンポーネント
 */
const ClipsSection: React.FC<ClipsSectionProps> = ({
  mediaItems,
  mediaTimelineRanges,
  isClipsLocked,
  mediaElements,
  onToggleClipsLock,
  onMediaUpload,
  onOpenMediaPicker,
  supportsShowOpenFilePicker,
  onMoveMedia,
  onRemoveMedia,
  onToggleMediaLock,
  onToggleTransformPanel,
  onUpdateVideoTrim,
  onUpdateImageDuration,
  onUpdateMediaScale,
  onUpdateMediaPosition,
  onResetMediaSetting,
  onUpdateMediaVolume,
  onToggleMediaMute,
  onToggleMediaFadeIn,
  onToggleMediaFadeOut,
  onUpdateFadeInDuration,
  onUpdateFadeOutDuration,
  onOpenHelp,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleAddClick = () => {
    if (isClipsLocked) return;
    if (supportsShowOpenFilePicker) {
      onOpenMediaPicker();
      return;
    }
    fileInputRef.current?.click();
  };

  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
      <div className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center gap-3">
        <h2 className="font-bold flex items-center gap-2 text-blue-400 md:text-base lg:text-lg">
          <span className="w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-blue-500/10 flex items-center justify-center text-xs lg:text-sm">
            1
          </span>
          <span>動画・画像</span>
          <button
            onClick={onOpenHelp}
            className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
            title="このセクションの説明"
            aria-label="動画・画像セクションの説明"
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        </h2>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggleClipsLock}
            className={`p-1 rounded-lg transition ${isClipsLocked ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300 hover:text-white hover:bg-gray-600'}`}
            title={isClipsLocked ? 'ロック解除' : 'ロック'}
            aria-label={isClipsLocked ? '動画・画像セクションのロックを解除' : '動画・画像セクションをロック'}
          >
            {isClipsLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
          <button
            type="button"
            onClick={handleAddClick}
            className={`bg-emerald-700 hover:bg-emerald-600 border border-emerald-500/45 text-white px-2.5 py-1 rounded-lg text-xs md:text-sm font-semibold whitespace-nowrap flex items-center gap-1 transition ${isClipsLocked ? 'opacity-50 pointer-events-none' : ''}`}
            disabled={isClipsLocked}
          >
            <Upload className="w-3 h-3" /> 追加
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="video/*, image/*"
            className="hidden"
            onChange={onMediaUpload}
            disabled={isClipsLocked}
          />
        </div>
      </div>
      <div className="p-3 lg:p-4 space-y-3 max-h-75 lg:max-h-128 overflow-y-auto custom-scrollbar">
        {mediaItems.length === 0 && (
          <div className="text-center py-8 text-gray-600 text-xs md:text-sm border-2 border-dashed border-gray-800 rounded">
            動画または画像ファイルを追加してください
          </div>
        )}
        {mediaItems.map((v, i) => (
          <ClipItem
            key={v.id}
            item={v}
            timelineRange={mediaTimelineRanges[v.id] ?? { start: 0, end: v.duration }}
            index={i}
            totalItems={mediaItems.length}
            isClipsLocked={isClipsLocked}
            mediaElement={mediaElements[v.id] || null}
            onMoveUp={() => onMoveMedia(i, 'up')}
            onMoveDown={() => onMoveMedia(i, 'down')}
            onRemove={() => onRemoveMedia(v.id)}
            onToggleLock={() => onToggleMediaLock(v.id)}
            onToggleTransformPanel={() => onToggleTransformPanel(v.id)}
            onUpdateVideoTrim={(type, value) => onUpdateVideoTrim(v.id, type, value)}
            onUpdateImageDuration={(value) => onUpdateImageDuration(v.id, value)}
            onUpdateScale={(value) => onUpdateMediaScale(v.id, value)}
            onUpdatePosition={(axis, value) => onUpdateMediaPosition(v.id, axis, value)}
            onResetSetting={(type) => onResetMediaSetting(v.id, type)}
            onUpdateVolume={(value) => onUpdateMediaVolume(v.id, value)}
            onToggleMute={() => onToggleMediaMute(v.id)}
            onToggleFadeIn={(checked) => onToggleMediaFadeIn(v.id, checked)}
            onToggleFadeOut={(checked) => onToggleMediaFadeOut(v.id, checked)}
            onUpdateFadeInDuration={(duration) => onUpdateFadeInDuration(v.id, duration)}
            onUpdateFadeOutDuration={(duration) => onUpdateFadeOutDuration(v.id, duration)}
          />
        ))}
      </div>
    </section>
  );
};

export default React.memo(ClipsSection);
