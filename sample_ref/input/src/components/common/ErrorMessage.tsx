/**
 * @file ErrorMessage.tsx
 * @author Turtle Village
 * @description アプリケーション内で発生したエラーメッセージをユーザーに通知するための表示コンポーネント。
 */
import React from 'react';
import { Trash2 } from 'lucide-react';

interface ErrorMessageProps {
  message: string | null;
  count?: number;
  onClose: () => void;
}

/**
 * エラーメッセージ表示コンポーネント
 */
const ErrorMessage: React.FC<ErrorMessageProps> = ({ message, count = 0, onClose }) => {
  if (!message) return null;

  // カウントが2以上の場合、件数を表示
  const displayMessage = count > 1 ? `${message} (${count}件)` : message;

  return (
    <div className="bg-red-500/10 border border-red-500/50 p-3 rounded text-sm text-red-200 flex justify-between items-center">
      <span>{displayMessage}</span>
      <button onClick={onClose}>
        <Trash2 className="w-3 h-3" />
      </button>
    </div>
  );
};

export default React.memo(ErrorMessage);
