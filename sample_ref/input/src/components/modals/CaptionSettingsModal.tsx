/**
 * @file CaptionSettingsModal.tsx
 * @author Turtle Village
 * @description キャプション個別スタイル設定のモーダル。一括設定を上書き（Override）するためのUI。
 */
import React from 'react';
import { X } from 'lucide-react';
import type { Caption, CaptionPosition, CaptionSize, CaptionFontStyle } from '../../types';
import { SwipeProtectedSlider } from '../SwipeProtectedSlider';
import { useDisableBodyScroll } from '../../hooks/useDisableBodyScroll';

interface CaptionSettingsModalProps {
  caption: Caption;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Omit<Caption, 'id'>>) => void;
}

// 拡張型：デフォルトオプション付き
type PositionOption = 'default' | CaptionPosition;
type FontStyleOption = 'default' | CaptionFontStyle;
type SizeOption = 'default' | CaptionSize;
type FadeOption = 'default' | 'on' | 'off';

/**
 * キャプション個別設定モーダル
 */
const CaptionSettingsModal: React.FC<CaptionSettingsModalProps> = ({
  caption,
  onClose,
  onUpdate,
}) => {
  // モーダル表示中は背景のスクロールを防止
  // このコンポーネントは親で条件付きレンダリングされているため、
  // マウント時は常に表示状態なので true を渡す
  useDisableBodyScroll(true);

  // 現在の値を取得（undefinedの場合は'default'）
  const currentPosition: PositionOption = caption.overridePosition ?? 'default';
  const currentFontStyle: FontStyleOption = caption.overrideFontStyle ?? 'default';
  const currentFontSize: SizeOption = caption.overrideFontSize ?? 'default';
  const currentFadeIn: FadeOption = caption.overrideFadeIn ?? 'default';
  const currentFadeOut: FadeOption = caption.overrideFadeOut ?? 'default';
  const currentFadeInDuration = caption.overrideFadeInDuration ?? 0.5;
  const currentFadeOutDuration = caption.overrideFadeOutDuration ?? 0.5;

  // サイズオプション
  const fontSizeOptions: { value: SizeOption; label: string }[] = [
    { value: 'default', label: 'デフォルト' },
    { value: 'small', label: '小' },
    { value: 'medium', label: '中' },
    { value: 'large', label: '大' },
    { value: 'xlarge', label: '特大' },
  ];

  // 字体オプション
  const fontStyleOptions: { value: FontStyleOption; label: string }[] = [
    { value: 'default', label: 'デフォルト' },
    { value: 'gothic', label: 'ゴシック' },
    { value: 'mincho', label: '明朝' },
  ];

  // 配置オプション
  const positionOptions: { value: PositionOption; label: string }[] = [
    { value: 'default', label: 'デフォルト' },
    { value: 'top', label: '上部' },
    { value: 'center', label: '中央' },
    { value: 'bottom', label: '下部' },
  ];

  // 更新ハンドラ
  const handleFontSizeChange = (value: SizeOption) => {
    onUpdate(caption.id, {
      overrideFontSize: value === 'default' ? undefined : value,
    });
  };

  const handleFontStyleChange = (value: FontStyleOption) => {
    onUpdate(caption.id, {
      overrideFontStyle: value === 'default' ? undefined : value,
    });
  };

  const handlePositionChange = (value: PositionOption) => {
    onUpdate(caption.id, {
      overridePosition: value === 'default' ? undefined : value,
    });
  };

  const handleFadeInChange = (value: FadeOption) => {
    onUpdate(caption.id, {
      overrideFadeIn: value === 'default' ? undefined : value,
      // デフォルトに戻す場合は時間もクリア
      ...(value === 'default' ? { overrideFadeInDuration: undefined } : {}),
    });
  };

  const handleFadeOutChange = (value: FadeOption) => {
    onUpdate(caption.id, {
      overrideFadeOut: value === 'default' ? undefined : value,
      // デフォルトに戻す場合は時間もクリア
      ...(value === 'default' ? { overrideFadeOutDuration: undefined } : {}),
    });
  };

  const handleFadeInDurationChange = (value: number) => {
    const steps = [0.5, 1.0, 2.0];
    onUpdate(caption.id, {
      overrideFadeInDuration: steps[value],
    });
  };

  const handleFadeOutDurationChange = (value: number) => {
    const steps = [0.5, 1.0, 2.0];
    onUpdate(caption.id, {
      overrideFadeOutDuration: steps[value],
    });
  };

  // セグメンテッドコントロールのスタイル（一括設定と同じ）
  const getButtonClass = (isSelected: boolean) =>
    `flex-1 py-1 rounded transition text-[10px] whitespace-nowrap ${isSelected
      ? 'bg-yellow-500 text-gray-900'
      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`;

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-[300] p-4"
      onClick={onClose}
    >
      <div
        className="bg-gray-900 rounded-2xl border border-gray-700 w-full max-w-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-sm font-bold flex items-center gap-2">
            ⚙️ キャプション個別設定
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-gray-700 rounded-lg transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* コンテンツ */}
        <div className="p-4 space-y-3">
          {/* ■ スタイル設定 */}
          <div className="space-y-2">
            <div className="text-[10px] text-yellow-400 font-bold">■ スタイル設定</div>
            {/* サイズ */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-400 w-16">サイズ:</span>
              <div className="flex gap-1 flex-1">
                {fontSizeOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleFontSizeChange(opt.value)}
                    className={getButtonClass(currentFontSize === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* 字体 */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-400 w-16">字体:</span>
              <div className="flex gap-1 flex-1">
                {fontStyleOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handleFontStyleChange(opt.value)}
                    className={getButtonClass(currentFontStyle === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            {/* 位置 */}
            <div className="flex items-center gap-2 text-[10px]">
              <span className="text-gray-400 w-16">位置:</span>
              <div className="flex gap-1 flex-1">
                {positionOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => handlePositionChange(opt.value)}
                    className={getButtonClass(currentPosition === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* ■ フェード設定 */}
          <div className="space-y-2 pt-3 border-t border-gray-700">
            <div className="text-[10px] text-yellow-400 font-bold">■ フェード設定</div>
            {/* フェードイン */}
            <div className="flex items-center gap-2 text-[10px]">
              <label className="flex items-center gap-1 w-24 justify-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentFadeIn === 'on'}
                  onChange={(e) => handleFadeInChange(e.target.checked ? 'on' : 'off')}
                  className="accent-yellow-500 rounded cursor-pointer"
                />
                <span className="whitespace-nowrap">フェードイン</span>
              </label>
              <SwipeProtectedSlider
                min={0}
                max={2}
                step={1}
                value={currentFadeInDuration === 0.5 ? 0 : currentFadeInDuration === 1.0 ? 1 : 2}
                onChange={handleFadeInDurationChange}
                disabled={currentFadeIn !== 'on'}
                className={`flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 disabled:cursor-default disabled:bg-gray-800 disabled:accent-gray-700 ${currentFadeIn === 'on' ? 'cursor-pointer' : ''}`}
              />
              <span className={`w-8 text-right whitespace-nowrap ${currentFadeIn !== 'on' ? 'text-gray-600' : 'text-gray-400'}`}>{currentFadeInDuration}秒</span>
            </div>
            {/* フェードアウト */}
            <div className="flex items-center gap-2 text-[10px]">
              <label className="flex items-center gap-1 w-24 justify-start cursor-pointer">
                <input
                  type="checkbox"
                  checked={currentFadeOut === 'on'}
                  onChange={(e) => handleFadeOutChange(e.target.checked ? 'on' : 'off')}
                  className="accent-yellow-500 rounded cursor-pointer"
                />
                <span className="whitespace-nowrap">フェードアウト</span>
              </label>
              <SwipeProtectedSlider
                min={0}
                max={2}
                step={1}
                value={currentFadeOutDuration === 0.5 ? 0 : currentFadeOutDuration === 1.0 ? 1 : 2}
                onChange={handleFadeOutDurationChange}
                disabled={currentFadeOut !== 'on'}
                className={`flex-1 accent-yellow-500 h-1 bg-gray-600 rounded appearance-none disabled:opacity-50 disabled:cursor-default disabled:bg-gray-800 disabled:accent-gray-700 ${currentFadeOut === 'on' ? 'cursor-pointer' : ''}`}
              />
              <span className={`w-8 text-right whitespace-nowrap ${currentFadeOut !== 'on' ? 'text-gray-600' : 'text-gray-400'}`}>{currentFadeOutDuration}秒</span>
            </div>
            {/* デフォルトに戻すボタン */}
            {(currentFadeIn !== 'default' || currentFadeOut !== 'default') && (
              <button
                onClick={() => {
                  onUpdate(caption.id, {
                    overrideFadeIn: undefined,
                    overrideFadeOut: undefined,
                    overrideFadeInDuration: undefined,
                    overrideFadeOutDuration: undefined,
                  });
                }}
                className="text-[9px] text-gray-500 hover:text-yellow-400 transition"
              >
                フェード設定をデフォルトに戻す
              </button>
            )}
          </div>

          <p className="text-[9px] text-gray-500 pt-2">
            ※「デフォルト」選択時は一括設定の値に従います
          </p>
        </div>
      </div>
    </div>
  );
};

export default CaptionSettingsModal;
