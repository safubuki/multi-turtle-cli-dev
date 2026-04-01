/**
 * @file SwipeProtectedSlider.tsx
 * @author Turtle Village
 * @description スワイプ操作による誤動作を防止するためのカスタムスライダーコンポーネント。垂直方向のスクロールと水平方向のシーク操作を区別する。
 */
import React, { useCallback } from 'react';
import { useSwipeProtectedValue } from '../hooks/useSwipeProtectedValue';

interface SwipeProtectedSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number | string;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * 誤タッチ保護付きスライダー
 * 
 * スライダー操作（横移動）と縦スクロールを区別：
 * - 縦移動 > 横移動 → 縦スクロールと判断 → 値をリセット
 * - 横移動 > 縦移動 → スライダー操作 → 値を維持
 */
export const SwipeProtectedSlider: React.FC<SwipeProtectedSliderProps> = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  disabled = false,
  className = '',
}) => {
  const handleRestore = useCallback(
    (restoredValue: number) => {
      onChange(restoredValue);
    },
    [onChange]
  );

  const { onTouchStart, onTouchMove, onTouchEnd } = useSwipeProtectedValue(
    value,
    handleRestore,
    {
      minMovement: 15,        // 15px以上動いたら方向を判定
      minTouchDuration: 200,  // 200ms未満の移動なしタッチは無視
    }
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      onChange(parseFloat(e.target.value));
    },
    [onChange]
  );

  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={handleChange}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      disabled={disabled}
      className={className}
    />
  );
};
