/**
 * @file SectionHelpModal.tsx
 * @author Turtle Village
 * @description セクション別の操作ヘルプを表示するモーダル（モバイルはボトムシート表示）。
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  CircleHelp,
  X,
  Upload,
  Sparkles,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  ArrowUp,
  ArrowDown,
  Trash2,
  Edit2,
  Save,
  Timer,
  Volume2,
  VolumeX,
  RefreshCw,
  MapPin,
  Settings,
  Square,
  Play,
  Camera,
  RotateCcw,
  Download,
  Check,
  Type,
  Plus,
  Move,
  ZoomIn,
} from 'lucide-react';
import { useDisableBodyScroll } from '../../hooks/useDisableBodyScroll';
import {
  SECTION_HELP_CONTENT,
  type SectionHelpKey,
  type SectionHelpVisualId,
} from '../../constants/sectionHelp';

interface SectionHelpModalProps {
  isOpen: boolean;
  section: SectionHelpKey | null;
  onClose: () => void;
}

const sectionAccentClass: Record<SectionHelpKey, string> = {
  app: 'text-emerald-300 border-emerald-500/35 bg-emerald-500/10',
  clips: 'text-blue-300 border-blue-500/35 bg-blue-500/10',
  bgm: 'text-purple-300 border-purple-500/35 bg-purple-500/10',
  narration: 'text-indigo-300 border-indigo-500/35 bg-indigo-500/10',
  caption: 'text-yellow-300 border-yellow-500/35 bg-yellow-500/10',
  preview: 'text-green-300 border-green-500/35 bg-green-500/10',
};

/**
 * セクションヘルプモーダル
 */
const SectionHelpModal: React.FC<SectionHelpModalProps> = ({ isOpen, section, onClose }) => {
  useDisableBodyScroll(isOpen);
  const [demoSliderValue, setDemoSliderValue] = useState(24);
  const contentScrollRef = useRef<HTMLDivElement | null>(null);
  const historyStateIdRef = useRef<string | null>(null);
  const closedByPopstateRef = useRef(false);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartScrollTopRef = useRef(0);
  const touchDeltaYRef = useRef(0);
  const swipeCloseEligibleRef = useRef(false);

  const isMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  };

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let value = 24;
    let direction = 1;
    const timer = setInterval(() => {
      value += direction * 12;
      if (value >= 82) {
        value = 82;
        direction = -1;
      } else if (value <= 18) {
        value = 18;
        direction = 1;
      }
      setDemoSliderValue(value);
    }, 520);
    return () => clearInterval(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const stateId = `section-help-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    historyStateIdRef.current = stateId;
    closedByPopstateRef.current = false;

    const currentState = (window.history.state && typeof window.history.state === 'object')
      ? window.history.state as Record<string, unknown>
      : {};
    window.history.pushState({ ...currentState, __sectionHelpModal: stateId }, '');

    const handlePopState = () => {
      closedByPopstateRef.current = true;
      onClose();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);

      const current = (window.history.state && typeof window.history.state === 'object')
        ? window.history.state as Record<string, unknown>
        : null;
      const ownStateOnTop = Boolean(
        historyStateIdRef.current &&
        current &&
        current.__sectionHelpModal === historyStateIdRef.current
      );

      if (!closedByPopstateRef.current && ownStateOnTop) {
        window.history.back();
      }

      historyStateIdRef.current = null;
      closedByPopstateRef.current = false;
    };
  }, [isOpen, onClose]);

  const resetTouchTracking = () => {
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    touchStartScrollTopRef.current = 0;
    touchDeltaYRef.current = 0;
    swipeCloseEligibleRef.current = false;
  };

  const handleSheetTouchStart = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!isMobileViewport() || event.touches.length !== 1) {
      resetTouchTracking();
      return;
    }

    const touchedInsideScrollableContent = Boolean(
      contentScrollRef.current && contentScrollRef.current.contains(event.target as Node)
    );
    if (touchedInsideScrollableContent) {
      // 本文のスクロール操作と下スワイプ閉じる操作を競合させない
      resetTouchTracking();
      return;
    }

    const touch = event.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchDeltaYRef.current = 0;
    touchStartScrollTopRef.current = contentScrollRef.current?.scrollTop ?? 0;
    swipeCloseEligibleRef.current = touchStartScrollTopRef.current <= 0;
  };

  const handleSheetTouchMove = (event: React.TouchEvent<HTMLDivElement>) => {
    if (!swipeCloseEligibleRef.current || touchStartXRef.current === null || touchStartYRef.current === null || event.touches.length !== 1) {
      return;
    }

    const touch = event.touches[0];
    const deltaX = touch.clientX - touchStartXRef.current;
    const deltaY = touch.clientY - touchStartYRef.current;
    touchDeltaYRef.current = deltaY;

    const atTop = (contentScrollRef.current?.scrollTop ?? 0) <= 0;
    const isVerticalDownSwipe = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX);
    if (!atTop || touchStartScrollTopRef.current > 0 || !isVerticalDownSwipe) {
      swipeCloseEligibleRef.current = false;
      return;
    }

    // 上端から下方向スワイプ時はシートを閉じる操作を優先する
    event.preventDefault();
  };

  const handleSheetTouchEnd = () => {
    if (swipeCloseEligibleRef.current && touchDeltaYRef.current > 72) {
      onClose();
    }
    resetTouchTracking();
  };

  if (!isOpen || !section) return null;

  const help = SECTION_HELP_CONTENT[section];
  const accent = sectionAccentClass[section];
  const chipBaseClass = 'inline-flex items-center gap-1 rounded-lg border text-[10px] md:text-xs leading-none';

  const renderVisualToken = (token: SectionHelpVisualId, index: number) => {
    switch (token) {
      case 'app_step_clips':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full">
            <div className="w-full rounded-lg border border-blue-500/35 bg-blue-500/10 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border border-blue-400/40 bg-blue-500/20 text-xs font-bold text-blue-200 shrink-0">
                  1
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-blue-200">動画・画像</div>
                  <p className="text-xs md:text-sm text-gray-200 leading-relaxed">動画・画像を追加し、並び順や表示区間を整えます。</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'app_step_bgm':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full">
            <div className="w-full rounded-lg border border-purple-500/35 bg-purple-500/10 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border border-purple-400/40 bg-purple-500/20 text-xs font-bold text-purple-200 shrink-0">
                  2
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-purple-200">BGM</div>
                  <p className="text-xs md:text-sm text-gray-200 leading-relaxed">BGMを追加し、開始タイミングや音量を調整して動画を盛り上げます。</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'app_step_narration':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full">
            <div className="w-full rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border border-indigo-400/40 bg-indigo-500/20 text-xs font-bold text-indigo-200 shrink-0">
                  3
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-indigo-200">ナレーション</div>
                  <p className="text-xs md:text-sm text-gray-200 leading-relaxed">AI生成でも、あらかじめ用意した音声ファイルでもナレーションを追加できます。</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'app_step_caption':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full">
            <div className="w-full rounded-lg border border-yellow-500/35 bg-yellow-500/10 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border border-yellow-400/40 bg-yellow-500/20 text-xs font-bold text-yellow-200 shrink-0">
                  4
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-yellow-200">キャプション</div>
                  <p className="text-xs md:text-sm text-gray-200 leading-relaxed">キャプションを追加し、サイズや字体、位置、フェードなどを整えて見やすく仕上げます。</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'app_step_preview':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full">
            <div className="w-full rounded-lg border border-green-500/35 bg-green-500/10 px-2.5 py-2">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-full border border-green-400/40 bg-green-500/20 text-xs font-bold text-green-200 shrink-0">
                  5
                </span>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-green-200">プレビュー</div>
                  <p className="text-xs md:text-sm text-gray-200 leading-relaxed">プレビューで確認後、「動画ファイルを作成」してダウンロードすれば完了です。</p>
                </div>
              </div>
            </div>
          </div>
        );
      case 'add_green_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2.5 py-1 bg-emerald-700 border-emerald-500/45 text-white font-semibold`}>
            <Upload className="w-3 h-3" /> 追加
          </span>
        );
      case 'add_yellow_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2.5 py-1 bg-yellow-700 border-yellow-500/45 text-yellow-100 font-semibold`}>
            <Plus className="w-3 h-3" /> 追加
          </span>
        );
      case 'ai_add_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2.5 py-1 bg-linear-to-r from-indigo-600 to-blue-600 border-indigo-400/45 text-white font-semibold`}>
            <Sparkles className="w-3 h-3" /> AI
          </span>
        );
      case 'unlock_button':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-600 bg-gray-700 text-gray-300">
            <Unlock className="w-3.5 h-3.5" />
          </span>
        );
      case 'lock_button_red':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-red-500/45 bg-red-500/20 text-red-300">
            <Lock className="w-3.5 h-3.5" />
          </span>
        );
      case 'eye_on_button':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-yellow-500/45 bg-yellow-500/20 text-yellow-300">
            <Eye className="w-3.5 h-3.5" />
          </span>
        );
      case 'eye_off_button':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-600 bg-gray-700 text-gray-300">
            <EyeOff className="w-3.5 h-3.5" />
          </span>
        );
      case 'move_up_button':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-600 bg-gray-700/60 text-gray-200">
            <ArrowUp className="w-3.5 h-3.5" />
          </span>
        );
      case 'move_down_button':
        return (
          <span key={`${token}-${index}`} className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-gray-600 bg-gray-700/60 text-gray-200">
            <ArrowDown className="w-3.5 h-3.5" />
          </span>
        );
      case 'delete_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center px-2 py-1 rounded border border-red-800/50 bg-red-900/30 text-red-400"
          >
            <Trash2 className="w-3 h-3" />
          </span>
        );
      case 'edit_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700 text-gray-300"
          >
            <Edit2 className="w-3.5 h-3.5" />
          </span>
        );
      case 'settings_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700 text-gray-300"
          >
            <Settings className="w-3.5 h-3.5" />
          </span>
        );
      case 'save_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700 text-gray-300"
          >
            <Save className="w-3.5 h-3.5" />
          </span>
        );
      case 'item_unlock_chip':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700/55 text-gray-400"
          >
            <Unlock className="w-3 h-3" />
          </span>
        );
      case 'item_lock_chip':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-red-500/35 bg-red-500/20 text-red-400"
          >
            <Lock className="w-3 h-3" />
          </span>
        );
      case 'trim_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <Timer className="w-3 h-3" /> トリム
          </span>
        );
      case 'duration_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <Timer className="w-3 h-3" /> 表示時間
          </span>
        );
      case 'start_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-indigo-500/40 bg-indigo-500/10 text-indigo-200`}>
            <Timer className="w-3 h-3" /> 開始位置
          </span>
        );
      case 'delay_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-purple-500/40 bg-purple-500/10 text-purple-200`}>
            <Timer className="w-3 h-3" /> 遅延
          </span>
        );
      case 'volume_chip':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700 text-gray-300"
            title="音量調整"
            aria-label="音量調整"
          >
            <Volume2 className="w-3.5 h-3.5" />
          </span>
        );
      case 'mute_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-red-500/35 bg-red-500/15 text-red-300"
            title="ミュートON"
            aria-label="ミュートON"
          >
            <VolumeX className="w-3.5 h-3.5" />
          </span>
        );
      case 'reset_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-7 h-7 rounded border border-gray-600 bg-gray-700 text-gray-300"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </span>
        );
      case 'scale_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <ZoomIn className="w-3 h-3" /> 拡大率
          </span>
        );
      case 'position_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <Move className="w-3 h-3" /> 位置
          </span>
        );
      case 'blackbar_toggle_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded border border-blue-300/70 bg-blue-400/20">
              <Check className="w-2.5 h-2.5" />
            </span>
            黒帯除去 (102.5%)
          </span>
        );
      case 'size_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-yellow-500/40 bg-yellow-500/10 text-yellow-200`}>
            <Type className="w-3 h-3" /> サイズ
          </span>
        );
      case 'blur_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-yellow-500/40 bg-yellow-500/10 text-yellow-200`}>
            <Sparkles className="w-3 h-3" /> ぼかし
          </span>
        );
      case 'fade_in_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            フェードイン
          </span>
        );
      case 'fade_out_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            フェードアウト
          </span>
        );
      case 'fade_in_checkbox':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded border border-blue-300/70 bg-blue-400/20">
              <Check className="w-2.5 h-2.5" />
            </span>
            フェードイン
          </span>
        );
      case 'fade_out_checkbox':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-blue-500/40 bg-blue-500/10 text-blue-200`}>
            <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded border border-blue-300/70 bg-blue-400/20">
              <Check className="w-2.5 h-2.5" />
            </span>
            フェードアウト
          </span>
        );
      case 'style_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-yellow-500/40 bg-yellow-500/10 text-yellow-200`}>
            <Type className="w-3 h-3" /> スタイル一括設定
          </span>
        );
      case 'current_pin_chip':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2 py-1 border-indigo-500/40 bg-indigo-500/10 text-indigo-200`}>
            <MapPin className="w-3 h-3" /> 現在位置に設定
          </span>
        );
      case 'stop_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-800 border border-gray-700 text-gray-200"
          >
            <Square className="w-4 h-4 fill-current" />
          </span>
        );
      case 'play_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-blue-600 border border-blue-500/60 text-white"
          >
            <Play className="w-4 h-4 ml-0.5" />
          </span>
        );
      case 'capture_button':
        return (
          <span
            key={`${token}-${index}`}
            className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-gray-800 border border-gray-700 text-gray-200"
          >
            <Camera className="w-4 h-4" />
          </span>
        );
      case 'clear_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-2.5 py-1 border-gray-600 bg-gray-700/50 text-gray-200 font-medium`}>
            <RotateCcw className="w-3 h-3" /> 一括クリア
          </span>
        );
      case 'export_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-3 py-1.5 rounded-full border-blue-500/60 bg-blue-600 text-white font-semibold`}>
            動画ファイルを作成
          </span>
        );
      case 'download_button':
        return (
          <span key={`${token}-${index}`} className={`${chipBaseClass} px-3 py-1.5 rounded-full border-green-500/60 bg-green-600 text-white font-semibold`}>
            <Download className="w-3 h-3" /> ダウンロード
          </span>
        );
      case 'slider_demo':
        return (
          <div key={`${token}-${index}`} className="basis-full w-full pt-1">
            <div className="relative h-5 w-3/4">
              <div className="absolute left-0 right-0 top-2 h-1 rounded-full bg-gray-700" />
              <div
                className="absolute left-0 top-2 h-1 rounded-full bg-blue-500/55 transition-all duration-500"
                style={{ width: `${demoSliderValue}%` }}
              />
              <div
                className="absolute top-0.5 -translate-x-1/2 w-4 h-4 rounded-full bg-gray-100 border border-gray-300 shadow-md transition-all duration-500"
                style={{ left: `${demoSliderValue}%` }}
              />
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <div
      className="fixed inset-0 z-[320] bg-black/75 backdrop-blur-sm flex items-end md:items-center md:justify-center md:p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${help.title}ヘルプ`}
    >
      <div
        className="w-full md:max-w-2xl max-h-[calc(100dvh-0.5rem)] md:max-h-[88vh] bg-gray-900 border border-gray-700 rounded-t-2xl md:rounded-2xl shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={resetTouchTracking}
      >
        <div className="md:hidden pt-2 px-4">
          <div className="mx-auto h-1 w-12 rounded-full bg-gray-600/80" />
        </div>
        <div className="p-4 border-b border-gray-700 flex items-center justify-between bg-gray-850">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border shrink-0 ${accent}`}>
              <CircleHelp className="w-3.5 h-3.5" />
              ヘルプ
            </span>
            <h3 className="font-bold text-sm md:text-base text-white truncate">{help.title}</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg border border-gray-600/80 bg-gray-800/80 text-gray-200 hover:text-white hover:bg-gray-700 hover:border-gray-500 transition"
            title="閉じる"
            aria-label="ヘルプを閉じる"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>

        <div
          ref={contentScrollRef}
          className="flex-1 min-h-0 p-4 md:p-5 overflow-y-auto space-y-4 overscroll-contain pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-5"
        >
          {help.subtitle.trim().length > 0 && (
            <p className="text-xs md:text-sm text-gray-300 leading-relaxed">{help.subtitle}</p>
          )}

          <div className="space-y-3">
            {help.items.map((item, index) => (
              <div key={`${item.title}-${index}`} className="rounded-xl border border-gray-700 bg-gray-800/45 p-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-700 text-[10px] font-bold text-gray-200 shrink-0">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <p className="text-xs md:text-sm text-gray-300 leading-relaxed whitespace-pre-line">{item.description}</p>
                    {item.visuals && item.visuals.length > 0 && (
                      <div className="flex flex-wrap w-full gap-1.5 pt-1">
                        {item.visuals.map((visual, visualIndex) => renderVisualToken(visual, visualIndex))}
                      </div>
                    )}
                    {item.accordions && item.accordions.length > 0 && (
                      <div className="space-y-2 pt-1">
                        {item.accordions.map((accordion, accordionIndex) => (
                          <details
                            key={`${item.title}-accordion-${accordionIndex}`}
                            className="rounded-lg border border-gray-700/90 bg-gray-900/55"
                          >
                            <summary className="cursor-pointer select-none list-none px-3 py-2 text-xs md:text-sm text-gray-100 font-semibold flex items-center justify-between gap-2">
                              <span>{accordion.title}</span>
                              <span className="text-[10px] md:text-xs text-gray-400">開く</span>
                            </summary>
                            <div className="px-3 pb-2">
                              <ul className="space-y-1">
                                {accordion.items.map((line, lineIndex) => (
                                  <li key={`${item.title}-accordion-${accordionIndex}-line-${lineIndex}`} className="text-[11px] md:text-xs text-gray-300 leading-relaxed">
                                    ・{line}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          </details>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default React.memo(SectionHelpModal);

