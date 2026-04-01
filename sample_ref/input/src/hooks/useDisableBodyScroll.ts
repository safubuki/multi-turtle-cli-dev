import { useEffect } from 'react';

/**
 * モーダル表示中に背景のスクロールを防止するフック
 * isOpenがtrueの間、bodyのスクロールを無効化し、閉じると元に戻す。
 * モバイルデバイス（タッチスクロール）にも対応。
 * 
 * @param isOpen モーダルが開いているかどうか
 */
export const useDisableBodyScroll = (isOpen: boolean) => {
  useEffect(() => {
    if (!isOpen) return;

    // 現在のスクロール位置を保存
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;

    // bodyのスタイルを保存（既存のスタイルを保持）
    const originalStyle = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      left: document.body.style.left,
      width: document.body.style.width,
    };

    // スクロールを防止
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.left = `-${scrollX}px`;
    document.body.style.width = '100%';

    // クリーンアップ: モーダルが閉じたら元のスタイルに戻す
    return () => {
      // スタイルを復元
      document.body.style.overflow = originalStyle.overflow;
      document.body.style.position = originalStyle.position;
      document.body.style.top = originalStyle.top;
      document.body.style.left = originalStyle.left;
      document.body.style.width = originalStyle.width;

      // スクロール位置を復元（instant behaviorで即座に復元）
      window.scrollTo({ top: scrollY, left: scrollX, behavior: 'instant' });
    };
  }, [isOpen]);
};
