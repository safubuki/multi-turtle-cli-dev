import React, { useState, useCallback } from 'react';
import { Trash2, Edit2, Check, X, MapPin, Settings, ArrowUp, ArrowDown } from 'lucide-react';
import type { Caption } from '../../types';
import { SwipeProtectedSlider } from '../SwipeProtectedSlider';
import CaptionSettingsModal from '../modals/CaptionSettingsModal';

interface CaptionItemProps {
  caption: Caption;
  index: number;
  totalCaptions: number;
  totalDuration: number;
  currentTime: number;
  isLocked: boolean;
  onUpdate: (id: string, updates: Partial<Omit<Caption, 'id'>>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: 'up' | 'down') => void;
}

/**
 * キャプションアイテムコンポーネント
 */
const CaptionItem: React.FC<CaptionItemProps> = ({
  caption,
  index,
  totalCaptions,
  totalDuration,
  currentTime,
  isLocked,
  onUpdate,
  onRemove,
  onMove,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(caption.text);
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  const handleSave = () => {
    if (editText.trim()) {
      onUpdate(caption.id, { text: editText.trim() });
    }
    setIsEditing(false);
  };

  const handleCancel = () => {
    setEditText(caption.text);
    setIsEditing(false);
  };

  // 現在時刻がこのキャプションの範囲内かどうか
  const isActive = currentTime >= caption.startTime && currentTime < caption.endTime;

  // スワイプ保護用ハンドラ
  const handleStartTimeChange = useCallback(
    (val: number) => {
      if (!isNaN(val) && val >= 0 && val < caption.endTime) {
        onUpdate(caption.id, { startTime: val });
      }
    },
    [caption.id, caption.endTime, onUpdate]
  );

  const handleEndTimeChange = useCallback(
    (val: number) => {
      if (!isNaN(val) && val > caption.startTime) {
        onUpdate(caption.id, { endTime: val });
      }
    },
    [caption.id, caption.startTime, onUpdate]
  );

  return (
    <div
      className={`p-3 lg:p-4 rounded-lg border transition ${
        isActive
          ? 'bg-yellow-900/30 border-yellow-500/50'
          : 'bg-gray-800/50 border-gray-700/50'
      }`}
    >
      {/* ヘッダー: 番号とアクション */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xs md:text-sm text-gray-500 font-mono">[{index + 1}]</span>
          {/* 個別設定が有効な場合にバッジ表示 */}
          {(caption.overridePosition || caption.overrideFontStyle || caption.overrideFontSize || caption.overrideFadeIn || caption.overrideFadeOut) && (
            <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">
              個別設定
            </span>
          )}
        </div>
        <div className="flex gap-1">
          {/* 上へ移動 */}
          <button
            onClick={() => onMove(caption.id, 'up')}
            disabled={index === 0 || isLocked}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 disabled:opacity-30 disabled:transition-none text-[10px] transition"
            title="上へ移動"
          >
            <ArrowUp className="w-3 h-3" />
          </button>
          {/* 下へ移動 */}
          <button
            onClick={() => onMove(caption.id, 'down')}
            disabled={index === totalCaptions - 1 || isLocked}
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 disabled:opacity-30 disabled:transition-none text-[10px] transition"
            title="下へ移動"
          >
            <ArrowDown className="w-3 h-3" />
          </button>
          {/* 設定ボタン */}
          <button
            onClick={() => setShowSettingsModal(true)}
            disabled={isLocked}
            className={`px-2 py-1 rounded border text-[10px] transition disabled:opacity-50 ${
              caption.overridePosition || caption.overrideFontStyle || caption.overrideFontSize || caption.overrideFadeIn || caption.overrideFadeOut
                ? 'bg-yellow-500/20 border-yellow-500/50 text-yellow-300 hover:bg-yellow-500/30'
                : 'bg-gray-700 hover:bg-gray-600 border-gray-600 text-gray-300'
            }`}
            title="個別設定"
          >
            <Settings className="w-3 h-3" />
          </button>
          {/* 編集ボタン */}
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              disabled={isLocked}
              className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 flex items-center gap-0.5 text-[10px] transition disabled:opacity-30 disabled:transition-none"
              title="編集"
            >
              <Edit2 className="w-3 h-3" />
            </button>
          ) : (
            <>
              <button
                onClick={handleSave}
                className="px-2 py-1 bg-green-900/30 hover:bg-green-900/50 text-green-300 rounded border border-green-700/50 text-[10px] transition"
                title="保存"
              >
                <Check className="w-3 h-3" />
              </button>
              <button
                onClick={handleCancel}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded border border-gray-600 text-gray-300 text-[10px] transition"
                title="キャンセル"
              >
                <X className="w-3 h-3" />
              </button>
            </>
          )}
          {/* 削除ボタン */}
          <button
            onClick={() => onRemove(caption.id)}
            disabled={isLocked}
            className="px-2 py-1 bg-red-900/30 hover:bg-red-900/50 text-red-400 rounded border border-red-800/50 disabled:opacity-30 text-[10px] transition"
            title="削除"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* テキスト */}
      {isEditing ? (
        <input
          type="text"
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSave();
            if (e.key === 'Escape') handleCancel();
          }}
          className="w-full bg-gray-700 border border-yellow-500 rounded px-2 py-1 text-sm text-white focus:outline-none mb-2"
          autoFocus
        />
      ) : (
        <p className="text-sm md:text-base text-white mb-2 truncate" title={caption.text}>
          "{caption.text}"
        </p>
      )}

      {/* 時間設定 */}
      <div className="space-y-2">
        {/* 開始時間 */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400 w-8 shrink-0">開始:</span>
          <SwipeProtectedSlider
            min={0}
            max={totalDuration || 60}
            step={0.1}
            value={caption.startTime}
            onChange={handleStartTimeChange}
            disabled={isLocked}
            className="flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"
          />
          <button
            onClick={() => {
              const val = Math.round(currentTime * 10) / 10;
              if (val >= 0 && val < caption.endTime) {
                onUpdate(caption.id, { startTime: val });
              }
            }}
            disabled={isLocked}
            className="p-1 text-gray-400 hover:text-yellow-400 disabled:opacity-50 disabled:hover:text-gray-400"
            title="現在位置を開始時間に設定"
          >
            <MapPin size={12} />
          </button>
          <input
            type="number"
            min={0}
            max={caption.endTime - 0.1}
            step={0.1}
            value={caption.startTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val >= 0 && val < caption.endTime) {
                onUpdate(caption.id, { startTime: val });
              }
            }}
            disabled={isLocked}
            className="w-12 bg-gray-700 border border-gray-600 rounded px-1 text-right text-white focus:outline-none focus:border-yellow-500 disabled:opacity-50"
          />
          <span className="text-gray-500">秒</span>
        </div>

        {/* 終了時間 */}
        <div className="flex items-center gap-2 text-[10px]">
          <span className="text-gray-400 w-8 shrink-0">終了:</span>
          <SwipeProtectedSlider
            min={0}
            max={totalDuration || 60}
            step={0.1}
            value={caption.endTime}
            onChange={handleEndTimeChange}
            disabled={isLocked}
            className="flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50"
          />
          <button
            onClick={() => {
              const val = Math.round(currentTime * 10) / 10;
              if (val > caption.startTime) {
                onUpdate(caption.id, { endTime: val });
              }
            }}
            disabled={isLocked}
            className="p-1 text-gray-400 hover:text-yellow-400 disabled:opacity-50 disabled:hover:text-gray-400"
            title="現在位置を終了時間に設定"
          >
            <MapPin size={12} />
          </button>
          <input
            type="number"
            min={caption.startTime + 0.1}
            max={totalDuration || 9999}
            step={0.1}
            value={caption.endTime}
            onChange={(e) => {
              const val = parseFloat(e.target.value);
              if (!isNaN(val) && val > caption.startTime) {
                onUpdate(caption.id, { endTime: val });
              }
            }}
            disabled={isLocked}
            className="w-12 bg-gray-700 border border-gray-600 rounded px-1 text-right text-white focus:outline-none focus:border-yellow-500 disabled:opacity-50"
          />
          <span className="text-gray-500">秒</span>
        </div>
      </div>

      {/* 個別設定モーダル */}
      {showSettingsModal && (
        <CaptionSettingsModal
          caption={caption}
          onClose={() => setShowSettingsModal(false)}
          onUpdate={onUpdate}
        />
      )}
    </div>
  );
};

export default React.memo(CaptionItem);
