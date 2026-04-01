/**
 * @file Header.tsx
 * @author Turtle Village
 * @description アプリケーションのグローバルヘッダー。タイトル表示、エクスポートボタン、設定モーダルへのアクセスを提供する。
 */
import React from 'react';
import { Settings, FolderOpen, CircleHelp } from 'lucide-react';

interface HeaderProps {
  onOpenSettings?: () => void;
  onOpenProjectManager?: () => void;
  onOpenAppHelp?: () => void;
}

/**
 * ヘッダーコンポーネント
 */
const Header: React.FC<HeaderProps> = ({ onOpenSettings, onOpenProjectManager, onOpenAppHelp }) => {
  return (
    <header className="sticky top-0 z-50 bg-gray-900/95 backdrop-blur border-b border-gray-800 px-4 py-3 lg:px-8 lg:py-4 shadow-lg">
      <div className="flex items-center justify-center lg:justify-center lg:relative">
        <div className="flex items-center gap-2.5 lg:gap-3.5">
          <div className="relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-emerald-600/95 ring-1 ring-emerald-300/35 shadow-[0_0_0_2px_rgba(2,6,23,0.65)] lg:h-12 lg:w-12">
            <img
              src={`${import.meta.env.BASE_URL}turtle_icon.png`}
              alt="タートルビデオ"
              className="h-8 w-8 rounded-full object-cover lg:h-9 lg:w-9"
            />
          </div>
          <h1 className="font-bold text-lg lg:text-xl whitespace-nowrap leading-none">タートルビデオ</h1>
          {/* モバイル: タイトル横に配置（従来通り） */}
          <div className="flex items-center gap-1 lg:hidden">
            {onOpenProjectManager && (
              <button
                onClick={onOpenProjectManager}
                className="p-1.5 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
                title="保存・読み込み"
              >
                <FolderOpen className="w-5 h-5" />
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1.5 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
                title="設定"
              >
                <Settings className="w-5 h-5" />
              </button>
            )}
            {onOpenAppHelp && (
              <button
                onClick={onOpenAppHelp}
                className="p-1.5 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
                title="このアプリの説明"
                aria-label="このアプリの説明"
              >
                <CircleHelp className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
        {/* PC: タイトルから少し離して右側に配置 (ml-8 で間隔調整) */}
        <div className="hidden lg:flex items-center gap-1 ml-10">
          {onOpenProjectManager && (
            <button
              onClick={onOpenProjectManager}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
              title="保存・読み込み"
            >
              <FolderOpen className="w-6 h-6" />
            </button>
          )}
          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="p-2 hover:bg-gray-700 rounded-lg transition text-gray-400 hover:text-white"
              title="設定"
            >
              <Settings className="w-6 h-6" />
            </button>
          )}
          {onOpenAppHelp && (
            <button
              onClick={onOpenAppHelp}
              className="p-2 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
              title="このアプリの説明"
              aria-label="このアプリの説明"
            >
              <CircleHelp className="w-6 h-6" />
            </button>
          )}
        </div>
      </div>
    </header>
  );
};

export default React.memo(Header);
