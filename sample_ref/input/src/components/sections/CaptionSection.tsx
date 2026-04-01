/**
 * @file CaptionSection.tsx
 * @author Turtle Village
 * @description テキストキャプションの追加、編集、削除を行うセクション。タイムライン上での表示タイミングやスタイル（サイズ、位置）の設定UIを提供する。
 */
import React, { useState } from 'react';
import {
  Lock,
  Unlock,
  CircleHelp,
  Plus,
  ChevronDown,
  ChevronRight,
  Type,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { Caption, CaptionSettings, CaptionPosition, CaptionSize, CaptionFontStyle } from '../../types';
import CaptionItem from '../media/CaptionItem';
import { SwipeProtectedSlider } from '../SwipeProtectedSlider';

interface CaptionSectionProps {
  captions: Caption[];
  settings: CaptionSettings;
  isLocked: boolean;
  totalDuration: number;
  currentTime: number;
  onToggleLock: () => void;
  onAddCaption: (text: string, startTime: number, endTime: number) => void;
  onUpdateCaption: (id: string, updates: Partial<Omit<Caption, 'id'>>) => void;
  onRemoveCaption: (id: string) => void;
  onMoveCaption: (id: string, direction: 'up' | 'down') => void;
  onSetEnabled: (enabled: boolean) => void;
  onSetFontSize: (size: CaptionSize) => void;
  onSetFontStyle: (style: CaptionFontStyle) => void;
  onSetPosition: (position: CaptionPosition) => void;
  onSetBlur: (blur: number) => void;
  onSetBulkFadeIn: (enabled: boolean) => void;
  onSetBulkFadeOut: (enabled: boolean) => void;
  onSetBulkFadeInDuration: (duration: number) => void;
  onSetBulkFadeOutDuration: (duration: number) => void;
  onOpenHelp: () => void;
}

/**
 * キャプションセクションコンポーネント
 */
const CaptionSection: React.FC<CaptionSectionProps> = ({
  captions,
  settings,
  isLocked,
  totalDuration,
  currentTime,
  onToggleLock,
  onAddCaption,
  onUpdateCaption,
  onRemoveCaption,
  onMoveCaption,
  onSetEnabled,
  onSetFontSize,
  onSetFontStyle,
  onSetPosition,
  onSetBlur,
  onSetBulkFadeIn,
  onSetBulkFadeOut,
  onSetBulkFadeInDuration,
  onSetBulkFadeOutDuration,
  onOpenHelp,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const [showStyleSettings, setShowStyleSettings] = useState(false);
  const [newText, setNewText] = useState('');

  const handleAddCaption = () => {
    if (!newText.trim()) return;

    // 現在のスライドバー位置（currentTime）から開始
    let startTime = currentTime;

    // 境界値チェック: startTimeがtotalDurationを超えないようにする
    if (startTime >= totalDuration) {
      // 動画の終わりに達している場合、最後の3秒前から開始
      startTime = Math.max(0, totalDuration - 3);
    }

    // endTimeは3秒後、ただしtotalDurationを超えない
    const endTime = Math.min(startTime + 3, totalDuration);

    // startTimeとendTimeが同じ（または逆転）にならないようにする
    if (endTime <= startTime) {
      return; // 追加できる余地がない
    }

    onAddCaption(newText.trim(), startTime, endTime);
    setNewText('');
  };

  const fontSizeOptions: { value: CaptionSize; label: string }[] = [
    { value: 'small', label: '小' },
    { value: 'medium', label: '中' },
    { value: 'large', label: '大' },
    { value: 'xlarge', label: '特大' },
  ];

  const fontStyleOptions: { value: CaptionFontStyle; label: string }[] = [
    { value: 'gothic', label: 'ゴシック' },
    { value: 'mincho', label: '明朝' },
  ];

  const positionOptions: { value: CaptionPosition; label: string }[] = [
    { value: 'top', label: '上部' },
    { value: 'center', label: '中央' },
    { value: 'bottom', label: '下部' },
  ];

  return (
    <section className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-xl">
      {/* ヘッダー */}
      <div
        className="p-4 bg-gray-850 border-b border-gray-800 flex justify-between items-center cursor-pointer hover:bg-gray-800/50 transition"
        onClick={() => setIsOpen(!isOpen)}
      >
        <h2 className="font-bold flex items-center gap-2 text-yellow-400 md:text-base lg:text-lg">
          {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className="w-6 h-6 lg:w-7 lg:h-7 rounded-full bg-yellow-500/10 flex items-center justify-center text-xs lg:text-sm">
            4
          </span>
          <span>キャプション</span>
          {captions.length > 0 && (
            <span className="text-[10px] md:text-xs text-yellow-300 font-normal ml-2">
              ({captions.length}件)
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenHelp();
            }}
            className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200 ml-1"
            title="このセクションの説明"
            aria-label="キャプションセクションの説明"
          >
            <CircleHelp className="w-4 h-4" />
          </button>
        </h2>
        <div className="flex gap-2 items-center" onClick={(e) => e.stopPropagation()}>
          {/* 表示/非表示トグル */}
          <button
            onClick={() => onSetEnabled(!settings.enabled)}
            className={`p-1.5 rounded-lg transition ${settings.enabled
              ? 'bg-yellow-500/20 text-yellow-400'
              : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
            title={settings.enabled ? 'キャプションを非表示' : 'キャプションを表示'}
          >
            {settings.enabled ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          </button>
          {/* ロック */}
          <button
            onClick={onToggleLock}
            className={`p-1.5 rounded-lg transition ${isLocked
              ? 'bg-red-500/20 text-red-400'
              : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
              }`}
            title={isLocked ? 'ロック解除' : 'ロック'}
            aria-label={isLocked ? 'キャプションセクションのロックを解除' : 'キャプションセクションをロック'}
          >
            {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* コンテンツ */}
      {isOpen && (
        <div className="p-3 lg:p-4 space-y-3">
          {/* スタイル/フェード一括設定 */}
          <div className="bg-gray-800/50 rounded-lg border border-gray-700/50">
            <button
              onClick={() => setShowStyleSettings(!showStyleSettings)}
              className="w-full p-2 flex items-center justify-between text-xs md:text-sm text-gray-400 hover:text-white transition"
            >
              <div className="flex items-center gap-2">
                <Type className="w-3 h-3" />
                <span>スタイル/フェード一括設定</span>
              </div>
              {showStyleSettings ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </button>
            {showStyleSettings && (
              <div className="px-3 pb-3 space-y-3">
                {/* ■ スタイル設定 */}
                <div className="space-y-2">
                  <div className="text-[10px] md:text-xs text-yellow-400 font-bold">■ スタイル設定</div>
                  {/* 文字サイズ */}
                  <div className="flex items-center gap-2 text-[10px] md:text-xs">
                    <span className="text-gray-400 w-16">サイズ:</span>
                    <div className="flex gap-1 flex-1">
                      {fontSizeOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => onSetFontSize(opt.value)}
                          disabled={isLocked}
                          className={`flex-1 max-w-[4rem] py-1 rounded transition ${settings.fontSize === opt.value
                            ? 'bg-yellow-500 text-gray-900'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            } disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 字体 */}
                  <div className="flex items-center gap-2 text-[10px] md:text-xs">
                    <span className="text-gray-400 w-16">字体:</span>
                    <div className="flex gap-1 flex-1">
                      {fontStyleOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => onSetFontStyle(opt.value)}
                          disabled={isLocked}
                          className={`flex-1 max-w-[4rem] py-1 rounded transition ${settings.fontStyle === opt.value
                            ? 'bg-yellow-500 text-gray-900'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            } disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* 位置 */}
                  <div className="flex items-center gap-2 text-[10px] md:text-xs">
                    <span className="text-gray-400 w-16">位置:</span>
                    <div className="flex gap-1 flex-1">
                      {positionOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => onSetPosition(opt.value)}
                          disabled={isLocked}
                          className={`flex-1 max-w-[4rem] py-1 rounded transition ${settings.position === opt.value
                            ? 'bg-yellow-500 text-gray-900'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                            } disabled:opacity-50`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* ぼかし */}
                  <div className="flex items-center gap-2 text-[10px] md:text-xs">
                    <span className="text-gray-400 w-16">ぼかし:</span>
                    <SwipeProtectedSlider
                      min={0}
                      max={50}
                      step={1}
                      value={settings.blur * 10}
                      onChange={(val) => onSetBlur(val / 10)}
                      disabled={isLocked}
                      className={`flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 disabled:cursor-default disabled:bg-gray-800 disabled:accent-gray-700 ${isLocked ? '' : 'cursor-pointer'}`}
                    />
                    <span className={`w-8 text-right whitespace-nowrap ${isLocked ? 'text-gray-600' : 'text-gray-400'}`}>{settings.blur.toFixed(1)}</span>
                  </div>
                </div>
                {/* ■ フェード一括設定 */}
                <div className="space-y-2 pt-2 border-t border-gray-700/50">
                  <div className="text-[10px] md:text-xs text-yellow-400 font-bold">■ フェード一括設定（個別ON優先）</div>
                  {/* フェード設定 - 1行表示 */}
                  {/* フェード一括設定 - レイアウト改善 */}
                  <div className="flex flex-col gap-2 mt-2 text-[10px] md:text-xs">
                    {/* フェードイン */}
                    <div className="flex items-center gap-2">
                      <label className={`flex items-center gap-1 w-24 justify-start ${isLocked ? 'opacity-50' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={settings.bulkFadeIn}
                          onChange={(e) => onSetBulkFadeIn(e.target.checked)}
                          disabled={isLocked}
                          className="accent-yellow-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        />
                        <span className="whitespace-nowrap">フェードイン</span>
                      </label>
                      <SwipeProtectedSlider
                        min={0}
                        max={2}
                        step={1}
                        value={settings.bulkFadeInDuration === 0.5 ? 0 : settings.bulkFadeInDuration === 1.0 ? 1 : 2}
                        onChange={(val) => {
                          const steps = [0.5, 1.0, 2.0];
                          onSetBulkFadeInDuration(steps[val]);
                        }}
                        disabled={isLocked || !settings.bulkFadeIn}
                        className={`flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 disabled:cursor-default disabled:bg-gray-800 disabled:accent-gray-700 ${isLocked || !settings.bulkFadeIn ? '' : 'cursor-pointer'}`}
                      />
                      <span className={`w-8 text-right whitespace-nowrap ${isLocked || !settings.bulkFadeIn ? 'text-gray-600' : 'text-gray-400'}`}>{settings.bulkFadeInDuration}秒</span>
                    </div>

                    {/* フェードアウト */}
                    <div className="flex items-center gap-2">
                      <label className={`flex items-center gap-1 w-24 justify-start ${isLocked ? 'opacity-50' : 'cursor-pointer'}`}>
                        <input
                          type="checkbox"
                          checked={settings.bulkFadeOut}
                          onChange={(e) => onSetBulkFadeOut(e.target.checked)}
                          disabled={isLocked}
                          className="accent-yellow-500 rounded cursor-pointer disabled:opacity-50 disabled:cursor-default"
                        />
                        <span className="whitespace-nowrap">フェードアウト</span>
                      </label>
                      <SwipeProtectedSlider
                        min={0}
                        max={2}
                        step={1}
                        value={settings.bulkFadeOutDuration === 0.5 ? 0 : settings.bulkFadeOutDuration === 1.0 ? 1 : 2}
                        onChange={(val) => {
                          const steps = [0.5, 1.0, 2.0];
                          onSetBulkFadeOutDuration(steps[val]);
                        }}
                        disabled={isLocked || !settings.bulkFadeOut}
                        className={`flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 disabled:cursor-default disabled:bg-gray-800 disabled:accent-gray-700 ${isLocked || !settings.bulkFadeOut ? '' : 'cursor-pointer'}`}
                      />
                      <span className={`w-8 text-right whitespace-nowrap ${isLocked || !settings.bulkFadeOut ? 'text-gray-600' : 'text-gray-400'}`}>{settings.bulkFadeOutDuration}秒</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 新規キャプション追加 */}
          <div className="flex gap-2">
            <input
              type="text"
              value={newText}
              onChange={(e) => setNewText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAddCaption();
              }}
              placeholder="キャプションテキストを入力..."
              disabled={isLocked}
              className="flex-1 h-9 md:h-10 bg-gray-800 border border-gray-700 rounded-lg px-3 text-sm md:text-sm text-white placeholder-gray-500 focus:outline-none focus:border-yellow-500 disabled:opacity-50"
            />
            <button
              onClick={handleAddCaption}
              disabled={isLocked || !newText.trim()}
              className="h-9 md:h-10 bg-yellow-600 hover:bg-yellow-500 text-white px-3 lg:px-4 rounded-lg text-xs md:text-sm font-semibold whitespace-nowrap flex items-center gap-1 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Plus className="w-3 h-3" /> 追加
            </button>
          </div>

          {/* キャプション一覧 */}
          <div className="space-y-2 min-h-14 lg:min-h-[4.5rem] max-h-44 lg:max-h-[15rem] overflow-y-auto custom-scrollbar">
            {captions.length === 0 ? (
              <div className="text-center py-2 lg:py-2.5 min-h-12 lg:min-h-14 text-gray-600 text-xs md:text-sm border-2 border-dashed border-gray-800 rounded flex items-center justify-center">
                キャプションがありません
              </div>
            ) : (
              captions.map((caption, index) => (
                <CaptionItem
                  key={caption.id}
                  caption={caption}
                  index={index}
                  totalCaptions={captions.length}
                  totalDuration={totalDuration}
                  currentTime={currentTime}
                  isLocked={isLocked}
                  onUpdate={onUpdateCaption}
                  onRemove={onRemoveCaption}
                  onMove={onMoveCaption}
                />
              ))
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default React.memo(CaptionSection);
