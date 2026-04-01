/**
 * @file SaveLoadModal.tsx
 * @author Turtle Village
 * @description 保存・読み込み・削除機能を提供するモーダル。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Save, FolderOpen, Trash2, Clock, AlertTriangle, Timer, Image, CircleHelp } from 'lucide-react';
import {
  useProjectStore,
  getProjectStoreErrorMessage,
} from '../../stores/projectStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useAudioStore } from '../../stores/audioStore';
import { useCaptionStore } from '../../stores/captionStore';
import { useLogStore } from '../../stores/logStore';
import type { SaveSlot } from '../../utils/indexedDB';
import {
  getAutoSaveInterval,
  setAutoSaveInterval,
  type AutoSaveIntervalOption,
} from '../../hooks/useAutoSave';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from '../../constants';
import { useDisableBodyScroll } from '../../hooks/useDisableBodyScroll';
import { saveBlobWithClientFileStrategy } from '../../utils/fileSave';
import { getPlatformCapabilities } from '../../utils/platform';

interface SaveLoadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onToast: (message: string, type?: 'success' | 'error') => void;
}

type ModalMode =
  | 'menu'
  | 'confirmLoad'
  | 'confirmDelete'
  | 'selectSlot'
  | 'confirmAutoDeleteForSave'
  | 'confirmResetDbForSave';

/** 自動保存間隔のオプション */
const AUTO_SAVE_OPTIONS: { value: AutoSaveIntervalOption; label: string }[] = [
  { value: 0, label: 'オフ' },
  { value: 1, label: '1分' },
  { value: 2, label: '2分' },
  { value: 5, label: '5分' },
];

/**
 * 日時を読みやすい形式にフォーマット
 */
function formatDateTime(isoString: string | null): string {
  if (!isoString) return '---';
  const date = new Date(isoString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  
  // 1分未満
  if (diff < 60 * 1000) {
    return 'たった今';
  }
  // 1時間未満
  if (diff < 60 * 60 * 1000) {
    const minutes = Math.floor(diff / (60 * 1000));
    return `${minutes}分前`;
  }
  // 24時間未満
  if (diff < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(diff / (60 * 60 * 1000));
    return `${hours}時間前`;
  }
  // それ以上
  return date.toLocaleDateString('ja-JP', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function SaveLoadModal({ isOpen, onClose, onToast }: SaveLoadModalProps) {
  const [mode, setMode] = useState<ModalMode>('menu');
  const [selectedSlot, setSelectedSlot] = useState<SaveSlot | null>(null);
  const [autoSaveInterval, setAutoSaveIntervalState] = useState<AutoSaveIntervalOption>(getAutoSaveInterval);
  const [showHelp, setShowHelp] = useState(false);
  const onCloseRef = useRef(onClose);
  const showHelpRef = useRef(false);
  const supportsShowSaveFilePicker = useMemo(
    () => getPlatformCapabilities().supportsShowSaveFilePicker,
    [],
  );
  const modalHistoryIdRef = useRef<string | null>(null);
  const closedByPopstateRef = useRef(false);
  const sheetScrollRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const touchStartScrollTopRef = useRef(0);
  const touchDeltaYRef = useRef(0);
  const swipeCloseEligibleRef = useRef(false);

  const isMobileViewport = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(max-width: 767px)').matches;
  };
  
  // モーダル表示中は背景のスクロールを防止
  useDisableBodyScroll(isOpen);
  
  // プロジェクトストア
  const {
    isSaving,
    isLoading,
    lastAutoSave,
    lastManualSave,
    lastSaveFailure,
    saveProjectManual,
    loadProjectFromSlot,
    deleteAllSaves,
    deleteAutoSaveOnly,
    resetSaveDatabase,
    refreshSaveInfo,
    clearLastSaveFailure,
  } = useProjectStore();
  
  // 各ストアからデータを取得
  const mediaItems = useMediaStore((s) => s.mediaItems);
  const isClipsLocked = useMediaStore((s) => s.isClipsLocked);
  const bgm = useAudioStore((s) => s.bgm);
  const isBgmLocked = useAudioStore((s) => s.isBgmLocked);
  const narrations = useAudioStore((s) => s.narrations);
  const isNarrationLocked = useAudioStore((s) => s.isNarrationLocked);
  const captions = useCaptionStore((s) => s.captions);
  const captionSettings = useCaptionStore((s) => s.settings);
  const isCaptionsLocked = useCaptionStore((s) => s.isLocked);
  
  // ストアへの復元用アクション
  const restoreMediaItems = useMediaStore((s) => s.restoreFromSave);
  const restoreAudio = useAudioStore((s) => s.restoreFromSave);
  const restoreCaptions = useCaptionStore((s) => s.restoreFromSave);
  
  // 現在編集中のデータがあるかどうか
  const hasCurrentData = mediaItems.length > 0 || bgm !== null || narrations.length > 0 || captions.length > 0;
  
  // 保存データがあるかどうか
  const hasAutoSave = lastAutoSave !== null;
  const hasManualSave = lastManualSave !== null;
  const hasSaveData = hasAutoSave || hasManualSave;

  const failureActionLabel = useMemo(() => {
    switch (lastSaveFailure?.recoveryAction) {
      case 'delete-auto-and-retry':
        return '自動保存を削除して再試行';
      case 'reset-database-and-retry':
        return '保存DBを初期化して再試行';
      case 'inspect-media':
        return '素材データとログの確認が必要';
      case 'retry':
        return '時間を置いて再試行';
      default:
        return null;
    }
  }, [lastSaveFailure]);
  
  // 初回表示時に保存情報を更新
  useEffect(() => {
    if (isOpen) {
      refreshSaveInfo();
      setMode('menu');
      setSelectedSlot(null);
      setAutoSaveIntervalState(getAutoSaveInterval());
      setShowHelp(false);
    }
  }, [isOpen, refreshSaveInfo]);

  useEffect(() => {
    if (mode !== 'menu') {
      setShowHelp(false);
    }
  }, [mode]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    showHelpRef.current = showHelp;
  }, [showHelp]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;
    const stateId = `save-load-modal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    modalHistoryIdRef.current = stateId;
    closedByPopstateRef.current = false;

    const currentState = (window.history.state && typeof window.history.state === 'object')
      ? window.history.state as Record<string, unknown>
      : {};
    window.history.pushState({ ...currentState, __saveLoadModal: stateId }, '');

    const handlePopState = () => {
      if (showHelpRef.current) {
        setShowHelp(false);
        const state = (window.history.state && typeof window.history.state === 'object')
          ? window.history.state as Record<string, unknown>
          : {};
        window.history.pushState({ ...state, __saveLoadModal: stateId }, '');
        return;
      }
      closedByPopstateRef.current = true;
      onCloseRef.current();
    };

    window.addEventListener('popstate', handlePopState);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      const current = (window.history.state && typeof window.history.state === 'object')
        ? window.history.state as Record<string, unknown>
        : null;
      const ownStateOnTop = Boolean(
        modalHistoryIdRef.current &&
        current &&
        current.__saveLoadModal === modalHistoryIdRef.current
      );
      if (!closedByPopstateRef.current && ownStateOnTop) {
        window.history.back();
      }
      modalHistoryIdRef.current = null;
      closedByPopstateRef.current = false;
    };
  }, [isOpen]);

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
    const touch = event.touches[0];
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
    touchDeltaYRef.current = 0;
    touchStartScrollTopRef.current = sheetScrollRef.current?.scrollTop ?? 0;
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

    const atTop = (sheetScrollRef.current?.scrollTop ?? 0) <= 0;
    const isVerticalDownSwipe = deltaY > 0 && Math.abs(deltaY) > Math.abs(deltaX);
    if (!atTop || touchStartScrollTopRef.current > 0 || !isVerticalDownSwipe) {
      swipeCloseEligibleRef.current = false;
      return;
    }

    event.preventDefault();
  };

  const handleSheetTouchEnd = () => {
    if (swipeCloseEligibleRef.current && touchDeltaYRef.current > 72) {
      onCloseRef.current();
    }
    resetTouchTracking();
  };
  
  // 自動保存間隔変更ハンドラ
  const handleAutoSaveIntervalChange = (value: AutoSaveIntervalOption) => {
    setAutoSaveInterval(value);
    setAutoSaveIntervalState(value);
    // ログを記録
    useLogStore.getState().info('SYSTEM', `自動保存間隔を${value === 0 ? 'オフ' : `${value}分`}に変更`);
    // 設定反映のためにページリロードが必要な旨を通知
    onToast(`自動保存間隔を${value === 0 ? 'オフ' : `${value}分`}に変更しました`, 'success');
  };
  
  /**
   * 単色画像を生成してダウンロード
   */
  const handleGenerateColorImage = (color: 'black' | 'white') => {
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      onToast('画像の生成に失敗しました', 'error');
      return;
    }
    
    ctx.fillStyle = color === 'black' ? '#000000' : '#FFFFFF';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
    
    // PNGとしてダウンロード
    canvas.toBlob(async (blob) => {
      if (!blob) {
        onToast('画像の生成に失敗しました', 'error');
        return;
      }

      try {
        const result = await saveBlobWithClientFileStrategy({
          blob,
          descriptor: {
            filename: `${color === 'black' ? '黒' : '白'}画像_${CANVAS_WIDTH}x${CANVAS_HEIGHT}.png`,
            mimeType: 'image/png',
            description: 'PNG 画像',
          },
          supportsShowSaveFilePicker,
        });

        useLogStore.getState().info('MEDIA', `${color === 'black' ? '黒' : '白'}画像を生成 (${CANVAS_WIDTH}x${CANVAS_HEIGHT})`, {
          saveStrategy: result.strategy,
        });
        onToast(
          result.strategy === 'file-picker'
            ? `${color === 'black' ? '黒' : '白'}画像を保存しました`
            : `${color === 'black' ? '黒' : '白'}画像の保存を開始しました`,
          'success',
        );
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') {
          onToast('画像の保存をキャンセルしました', 'error');
          return;
        }
        onToast('画像の保存に失敗しました', 'error');
      }
    }, 'image/png');
  };
  
  const executeManualSave = async () => {
    await saveProjectManual(
      mediaItems,
      isClipsLocked,
      bgm,
      isBgmLocked,
      narrations,
      isNarrationLocked,
      captions,
      captionSettings,
      isCaptionsLocked
    );
    useLogStore.getState().info('SYSTEM', 'プロジェクトを手動保存', {
      mediaCount: mediaItems.length,
      captionCount: captions.length,
      hasBgm: !!bgm,
      narrationCount: narrations.length,
    });
    onToast('保存しました', 'success');
    onClose();
  };

  // 手動保存
  const handleSave = async () => {
    try {
      await executeManualSave();
    } catch (error) {
      const message = getProjectStoreErrorMessage(error);
      const failureInfo = useProjectStore.getState().lastSaveFailure;
      useLogStore.getState().error('SYSTEM', '手動保存に失敗', { error: message });
      if (failureInfo?.recoveryAction === 'delete-auto-and-retry') {
        await refreshSaveInfo();
        setMode('confirmAutoDeleteForSave');
        return;
      }
      if (failureInfo?.recoveryAction === 'reset-database-and-retry') {
        await refreshSaveInfo();
        setMode('confirmResetDbForSave');
        return;
      }
      if (failureInfo?.recoveryAction === 'inspect-media') {
        onToast('保存素材の一部が壊れている可能性があります。ログ詳細を確認してください', 'error');
        return;
      }
      onToast('保存に失敗しました', 'error');
    }
  };

  // 容量不足時: 自動保存削除後に手動保存を再試行
  const handleSaveAfterAutoDelete = async () => {
    try {
      await deleteAutoSaveOnly();
      await executeManualSave();
    } catch (error) {
      const message = getProjectStoreErrorMessage(error);
      const failureInfo = useProjectStore.getState().lastSaveFailure;
      useLogStore.getState().error('SYSTEM', '自動保存削除後の手動保存に失敗', { error: message });
      if (failureInfo?.recoveryAction === 'reset-database-and-retry') {
        setMode('confirmResetDbForSave');
        return;
      }
      if (failureInfo?.recoveryAction === 'inspect-media') {
        onToast('保存素材の一部が壊れている可能性があります。ログ詳細を確認してください', 'error');
      } else {
        onToast('保存に失敗しました', 'error');
      }
      setMode('menu');
    }
  };

  const handleSaveAfterDbReset = async () => {
    try {
      await resetSaveDatabase();
      await executeManualSave();
    } catch (error) {
      const message = getProjectStoreErrorMessage(error);
      useLogStore.getState().error('SYSTEM', '保存DB初期化後の手動保存に失敗', { error: message });
      onToast('保存DBを初期化しても保存に失敗しました。ログ詳細を確認してください', 'error');
      setMode('menu');
    }
  };
  
  // 読み込みスロット選択
  const handleLoadClick = () => {
    if (hasAutoSave && hasManualSave) {
      // 両方ある場合はスロット選択
      setMode('selectSlot');
    } else if (hasAutoSave) {
      // 自動保存のみ
      setSelectedSlot('auto');
      if (hasCurrentData) {
        setMode('confirmLoad');
      } else {
        handleLoadConfirm('auto');
      }
    } else if (hasManualSave) {
      // 手動保存のみ
      setSelectedSlot('manual');
      if (hasCurrentData) {
        setMode('confirmLoad');
      } else {
        handleLoadConfirm('manual');
      }
    }
  };
  
  // スロット選択後
  const handleSlotSelect = (slot: SaveSlot) => {
    setSelectedSlot(slot);
    if (hasCurrentData) {
      setMode('confirmLoad');
    } else {
      handleLoadConfirm(slot);
    }
  };
  
  // 読み込み確定
  const handleLoadConfirm = async (slot: SaveSlot) => {
    try {
      const data = await loadProjectFromSlot(slot);
      if (data) {
        // 各ストアに復元
        restoreMediaItems(data.mediaItems, data.isClipsLocked);
        restoreAudio(data.bgm, data.isBgmLocked, data.narrations, data.isNarrationLocked);
        restoreCaptions(data.captions, data.captionSettings, data.isCaptionsLocked);
        useLogStore.getState().info('SYSTEM', `プロジェクトを読み込み (${slot === 'auto' ? '自動保存' : '手動保存'})`, {
          mediaCount: data.mediaItems.length,
          captionCount: data.captions.length,
        });
        onToast('読み込みました', 'success');
      } else {
        onToast('保存データが見つかりません', 'error');
      }
      onClose();
    } catch (error) {
      useLogStore.getState().error('SYSTEM', `プロジェクト読み込みに失敗 (${slot})`);
      onToast('読み込みに失敗しました', 'error');
    }
  };
  
  // 削除確認
  const handleDeleteClick = () => {
    setMode('confirmDelete');
  };
  
  // 削除確定
  const handleDeleteConfirm = async () => {
    try {
      await deleteAllSaves();
      useLogStore.getState().info('SYSTEM', '保存データを全て削除');
      onToast('削除しました', 'success');
      onClose();
    } catch (error) {
      useLogStore.getState().error('SYSTEM', '保存データ削除に失敗');
      onToast('削除に失敗しました', 'error');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div
      className="fixed inset-0 z-[300] flex items-end md:items-center md:justify-center bg-black/70 md:p-4"
      onClick={onClose}
    >
      <div
        ref={sheetScrollRef}
        className="relative w-full md:w-[90%] max-w-md bg-gray-900 rounded-t-2xl md:rounded-2xl border border-gray-700 p-4 md:p-6 max-h-[calc(100dvh-0.5rem)] md:max-h-[90vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom)+1rem)] md:pb-6 animate-ai-modal-sheet"
        onClick={(e) => e.stopPropagation()}
        onTouchStart={handleSheetTouchStart}
        onTouchMove={handleSheetTouchMove}
        onTouchEnd={handleSheetTouchEnd}
        onTouchCancel={resetTouchTracking}
      >
        <div className="md:hidden pt-0.5 pb-2">
          <div className="mx-auto h-1 w-12 rounded-full bg-gray-600/80" />
        </div>
        {/* ヘッダー */}
        <div className="flex items-center justify-between mb-5 md:mb-6">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold text-white">
              {mode === 'menu' && '保存・素材'}
              {mode === 'selectSlot' && 'どちらを読み込みますか？'}
              {mode === 'confirmLoad' && '読み込み確認'}
              {mode === 'confirmDelete' && '削除確認'}
              {mode === 'confirmAutoDeleteForSave' && '容量不足の対応'}
              {mode === 'confirmResetDbForSave' && '保存DBの復旧'}
            </h2>
            {mode === 'menu' && (
              <button
                onClick={() => setShowHelp((prev) => !prev)}
                className="p-1 rounded-lg transition border border-blue-500/45 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20 hover:text-blue-200"
                title="このセクションの説明"
                aria-label="保存・素材の説明"
              >
                <CircleHelp className="w-4 h-4" />
              </button>
            )}
          </div>
          <button
            className="p-1.5 rounded-lg border border-gray-600/80 bg-gray-800/80 text-gray-200 hover:text-white hover:bg-gray-700 hover:border-gray-500 transition"
            onClick={onClose}
            title="閉じる"
            aria-label="閉じる"
          >
            <X className="w-[18px] h-[18px]" />
          </button>
        </div>
        
        {/* メインメニュー */}
        {mode === 'menu' && (
          <div className="space-y-4">
            {showHelp && (
              <div className="rounded-xl border border-orange-400/45 bg-linear-to-br from-orange-500/18 via-amber-500/12 to-orange-500/6 p-3 md:p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-bold text-orange-100 flex items-center gap-1">
                    <CircleHelp className="w-4 h-4" /> 保存・素材の使い方
                  </h3>
                  <button
                    onClick={() => setShowHelp(false)}
                    className="p-1.5 rounded-md border border-orange-300/40 bg-orange-500/10 text-orange-100 hover:bg-orange-500/25 hover:border-orange-200/60 transition"
                    title="ヘルプを閉じる"
                    aria-label="ヘルプを閉じる"
                  >
                    <X className="w-[18px] h-[18px]" />
                  </button>
                </div>
                <div className="space-y-3 text-xs md:text-sm text-orange-50 leading-relaxed">
                  <div className="space-y-1.5">
                    <div className="font-semibold text-orange-100">保存</div>
                    <ul className="list-disc ml-4 space-y-1">
                      <li>保存データはブラウザ上の IndexedDB に保存されます。</li>
                      <li>ブラウザやアプリを閉じても、保存データは保持されます。</li>
                      <li>自動保存間隔はオフ/1分/2分/5分から選べます。</li>
                      <li>自動保存は定期的に上書き保存されるため、保存データが増え続けずローカル領域を圧迫しにくい設計です。</li>
                      <li>手動保存で現在の状態を保存し、読み込みで復元できます。</li>
                      <li>保存データを削除すると、自動保存と手動保存の両方が消えます。</li>
                      <li>iPhone / iPad の Safari では、手動保存→読み込み、自動保存反映、ブラウザ再起動後の保持を、同じ起動方法で確認してください。</li>
                      <li>Safari の通常タブ、ホーム画面追加、プライベートブラウズでは保存領域が分かれる場合があります。継続利用する起動方法を固定してください。</li>
                    </ul>
                  </div>
                  <div className="border-t border-orange-300/35" />
                  <div className="space-y-1.5">
                    <div className="font-semibold text-orange-100">素材</div>
                    <ul className="list-disc ml-4 space-y-1">
                      <li>素材生成では 1280x720 の黒画像・白画像を作成できます。</li>
                      <li>動画のつなぎや背景用のプレースホルダー素材として利用できます。</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
            {/* 自動保存間隔設定 */}
            <div className="bg-gray-800 rounded-lg p-4">
              <div className="flex items-center justify-between">
                <span className="text-gray-400 flex items-center gap-1 text-sm">
                  <Timer size={14} />
                  自動保存間隔
                </span>
                <div className="flex gap-1">
                  {AUTO_SAVE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleAutoSaveIntervalChange(option.value)}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        autoSaveInterval === option.value
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            
            {/* 保存情報 */}
            <div className="bg-gray-800 rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-1">
                  <Clock size={14} />
                  自動保存
                </span>
                <span className={hasAutoSave ? 'text-white' : 'text-gray-500'}>
                  {formatDateTime(lastAutoSave)}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400 flex items-center gap-1">
                  <Save size={14} />
                  手動保存
                </span>
                <span className={hasManualSave ? 'text-white' : 'text-gray-500'}>
                  {formatDateTime(lastManualSave)}
                </span>
              </div>
            </div>

            {lastSaveFailure && (
              <div className="bg-red-950/35 border border-red-700/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-red-200 flex items-center gap-1">
                    <AlertTriangle size={14} />
                    直近の保存失敗
                  </span>
                  <button
                    className="text-xs text-red-300 hover:text-red-100 transition-colors"
                    onClick={clearLastSaveFailure}
                  >
                    閉じる
                  </button>
                </div>
                <div className="text-xs text-red-100 leading-relaxed break-words">
                  {lastSaveFailure.reason}
                </div>
                <div className="text-xs text-red-200/90">
                  推奨対応: {failureActionLabel ?? 'ログを確認して再試行'}
                </div>
                {lastSaveFailure.storageEstimate && lastSaveFailure.storageEstimate.quota > 0 && (
                  <div className="text-[11px] text-red-200/80">
                    使用量: {Math.round((lastSaveFailure.storageEstimate.usage / 1024 / 1024) * 10) / 10}MB /
                    {` `}上限: {Math.round((lastSaveFailure.storageEstimate.quota / 1024 / 1024) * 10) / 10}MB
                  </div>
                )}
              </div>
            )}
            
            {/* ボタン */}
            <div className="space-y-3">
              <button
                className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSave}
                disabled={isSaving || !hasCurrentData}
              >
                <Save size={18} />
                {isSaving ? '保存中...' : '手動保存'}
              </button>
              
              <button
                className="w-full flex items-center justify-center gap-2 py-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleLoadClick}
                disabled={isLoading || !hasSaveData}
              >
                <FolderOpen size={18} />
                {isLoading ? '読み込み中...' : '読み込み'}
              </button>
              
              <button
                className="w-full flex items-center justify-center gap-2 py-3 bg-gray-800 hover:bg-red-600/20 text-gray-400 hover:text-red-400 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleDeleteClick}
                disabled={!hasSaveData}
              >
                <Trash2 size={18} />
                保存データを削除
              </button>
            </div>
            
            {/* 素材生成 */}
            <div className="border-t border-gray-700 pt-4 mt-2">
              <div className="flex items-center gap-2 mb-3">
                <Image size={14} className="text-gray-400" />
                <span className="text-sm text-gray-400">素材生成</span>
                <span className="text-xs text-gray-500">({CANVAS_WIDTH}×{CANVAS_HEIGHT}px)</span>
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-gray-900 hover:bg-gray-800 text-gray-300 rounded-lg transition-colors border border-gray-700"
                  onClick={() => handleGenerateColorImage('black')}
                >
                  <div className="w-4 h-4 bg-black border border-gray-600 rounded" />
                  黒画像
                </button>
                <button
                  className="flex-1 flex items-center justify-center gap-2 py-2 bg-gray-100 hover:bg-white text-gray-800 rounded-lg transition-colors border border-gray-300"
                  onClick={() => handleGenerateColorImage('white')}
                >
                  <div className="w-4 h-4 bg-white border border-gray-400 rounded" />
                  白画像
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* スロット選択 */}
        {mode === 'selectSlot' && (
          <div className="space-y-4">
            <div className="space-y-3">
              {hasAutoSave && (
                <button
                  className="w-full flex items-center justify-between py-3 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  onClick={() => handleSlotSelect('auto')}
                >
                  <span className="flex items-center gap-2">
                    <Clock size={18} className="text-blue-400" />
                    自動保存
                  </span>
                  <span className="text-sm text-gray-400">
                    {formatDateTime(lastAutoSave)}
                  </span>
                </button>
              )}
              
              {hasManualSave && (
                <button
                  className="w-full flex items-center justify-between py-3 px-4 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
                  onClick={() => handleSlotSelect('manual')}
                >
                  <span className="flex items-center gap-2">
                    <Save size={18} className="text-green-400" />
                    手動保存
                  </span>
                  <span className="text-sm text-gray-400">
                    {formatDateTime(lastManualSave)}
                  </span>
                </button>
              )}
            </div>
            
            <button
              className="w-full py-2 text-gray-400 hover:text-white transition-colors"
              onClick={() => setMode('menu')}
            >
              戻る
            </button>
          </div>
        )}
        
        {/* 読み込み確認 */}
        {mode === 'confirmLoad' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
              <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200">
                現在編集中のデータは失われます。よろしいですか？
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                onClick={() => setMode('menu')}
              >
                キャンセル
              </button>
              <button
                className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
                onClick={() => selectedSlot && handleLoadConfirm(selectedSlot)}
                disabled={isLoading}
              >
                {isLoading ? '読み込み中...' : '読み込む'}
              </button>
            </div>
          </div>
        )}

        {/* 容量不足対応（自動保存のみ削除して手動保存を続行） */}
        {mode === 'confirmAutoDeleteForSave' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-yellow-900/30 border border-yellow-700/50 rounded-lg">
              <AlertTriangle size={20} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-yellow-200">
                保存容量が不足しています。<br />
                自動保存データのみ削除して、手動保存を続行しますか？
              </p>
            </div>

            <div className="flex gap-3">
              <button
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                onClick={() => setMode('menu')}
                disabled={isSaving}
              >
                キャンセル
              </button>
              <button
                className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveAfterAutoDelete}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : '削除して保存'}
              </button>
            </div>
          </div>
        )}

        {mode === 'confirmResetDbForSave' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
              <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">
                保存用の IndexedDB が不整合状態の可能性があります。<br />
                保存DBを初期化すると、自動保存と手動保存の履歴は消えますが、現在編集中の内容で再保存を試せます。続行しますか？
              </p>
            </div>

            <div className="flex gap-3">
              <button
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                onClick={() => setMode('menu')}
                disabled={isSaving}
              >
                キャンセル
              </button>
              <button
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleSaveAfterDbReset}
                disabled={isSaving}
              >
                {isSaving ? '保存中...' : '初期化して保存'}
              </button>
            </div>
          </div>
        )}
        
        {/* 削除確認 */}
        {mode === 'confirmDelete' && (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-red-900/30 border border-red-700/50 rounded-lg">
              <AlertTriangle size={20} className="text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-200">
                自動保存と手動保存の両方のデータを削除します。この操作は取り消せません。
              </p>
            </div>
            
            <div className="flex gap-3">
              <button
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
                onClick={() => setMode('menu')}
              >
                キャンセル
              </button>
              <button
                className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                onClick={handleDeleteConfirm}
              >
                削除する
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
