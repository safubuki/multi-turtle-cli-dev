/**
 * @file main.tsx
 * @author Turtle Village
 * @description アプリケーションのエントリーポイント。React DOMのレンダリングとグローバルエラーハンドリングの設定を行う。
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { useLogStore } from './stores';

// グローバルエラーハンドラ（未捕捉エラーをログに記録）
window.addEventListener('error', (event) => {
  const { error: logError } = useLogStore.getState();
  logError('GLOBAL', '未捕捉エラー', {
    message: event.message,
    filename: event.filename?.split('/').pop() || 'unknown',
    lineno: event.lineno,
    colno: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  const { error: logError } = useLogStore.getState();
  logError('GLOBAL', '未処理Promise拒否', {
    reason: String(event.reason).slice(0, 200)
  });
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
