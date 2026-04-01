/**
 * @file useSwipeProtectedValue.ts
 * @author Turtle Village
 * @description スワイプ（スクロール）とスライダー操作（値変更）を区別し、誤操作を防ぐためのロジックを提供するカスタムフック。
 */
import { useRef, useCallback, TouchEvent } from 'react';

interface SwipeProtectedHandlers {
  onTouchStart: (e: TouchEvent<HTMLInputElement>) => void;
  onTouchMove: (e: TouchEvent<HTMLInputElement>) => void;
  onTouchEnd: (e: TouchEvent<HTMLInputElement>) => void;
}

/**
 * 誤タッチを検出して値を元に戻すフック
 * 
 * スライダー操作（横移動）と縦スクロールを区別：
 * - 縦移動が横移動より大きい → 縦スクロールの意図 → 値をリセット
 * - 横移動が縦移動より大きい → スライダー操作 → 値を維持
 * - タッチ時間が短すぎる場合も通りすがりと判断してリセット
 */
export function useSwipeProtectedValue(
  currentValue: number,
  onRestore: (value: number) => void,
  options: {
    minMovement?: number;      // 判定開始の最小移動量（px）
    minTouchDuration?: number; // 最小タッチ時間（ms）
  } = {}
): SwipeProtectedHandlers {
  const { minMovement = 10, minTouchDuration = 80 } = options;

  const startXRef = useRef<number>(0);
  const startYRef = useRef<number>(0);
  const startValueRef = useRef<number>(0);
  const touchStartTimeRef = useRef<number>(0);
  const isVerticalScrollRef = useRef<boolean>(false);
  const directionDecidedRef = useRef<boolean>(false);

  const onTouchStart = useCallback(
    (e: TouchEvent<HTMLInputElement>) => {
      startXRef.current = e.touches[0].clientX;
      startYRef.current = e.touches[0].clientY;
      startValueRef.current = currentValue;
      touchStartTimeRef.current = Date.now();
      isVerticalScrollRef.current = false;
      directionDecidedRef.current = false;
    },
    [currentValue]
  );

  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLInputElement>) => {
      // 方向が既に決定済みの場合
      if (directionDecidedRef.current) {
        if (isVerticalScrollRef.current) {
          // 縦スクロール中は値を戻し続ける
          onRestore(startValueRef.current);
        }
        return;
      }

      const deltaX = Math.abs(e.touches[0].clientX - startXRef.current);
      const deltaY = Math.abs(e.touches[0].clientY - startYRef.current);

      // 最小移動量を超えたら方向を判定
      if (deltaX > minMovement || deltaY > minMovement) {
        directionDecidedRef.current = true;

        if (deltaY > deltaX) {
          // 縦移動が横移動より大きい = 縦スクロールの意図
          isVerticalScrollRef.current = true;
          onRestore(startValueRef.current);
        }
        // 横移動が大きい場合はスライダー操作なので何もしない
      }
    },
    [minMovement, onRestore]
  );

  const onTouchEnd = useCallback(
    (_e: TouchEvent<HTMLInputElement>) => {
      const touchDuration = Date.now() - touchStartTimeRef.current;

      if (isVerticalScrollRef.current) {
        // 縦スクロール中だった場合は元の値を確定
        onRestore(startValueRef.current);
      } else if (touchDuration < minTouchDuration && !directionDecidedRef.current) {
        // 移動がなく、タッチ時間が短すぎる = 通りすがりのタップ
        onRestore(startValueRef.current);
      }
      // それ以外は意図的なスライダー操作なので値を維持

      isVerticalScrollRef.current = false;
      directionDecidedRef.current = false;
    },
    [minTouchDuration, onRestore]
  );

  return { onTouchStart, onTouchMove, onTouchEnd };
}
