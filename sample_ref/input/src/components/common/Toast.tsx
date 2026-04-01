/**
 * @file Toast.tsx
 * @author Turtle Village
 * @description ユーザー操作の完了を通知するための一時的なメッセージ（トースト）を表示するコンポーネント。
 */
import React, { useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import type { ToastProps } from '../../types';

/**
 * トースト通知コンポーネント
 * 操作結果のフィードバック表示用
 */
const Toast: React.FC<ToastProps> = ({ message, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 2000);
    return () => clearTimeout(timer);
  }, [onClose]);

  if (!message) return null;

  return (
    <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-green-600 text-white px-4 py-2 rounded-lg shadow-xl z-200 flex items-center gap-2 animate-bounce">
      <CheckCircle className="w-4 h-4" />
      <span className="text-sm font-bold">{message}</span>
    </div>
  );
};

export default React.memo(Toast);
