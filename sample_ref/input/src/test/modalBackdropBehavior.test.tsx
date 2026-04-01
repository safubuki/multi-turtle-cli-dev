import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AiModal from '../components/modals/AiModal';
import SettingsModal from '../components/modals/SettingsModal';
import { useOfflineModeStore } from '../stores/offlineModeStore';

const logStoreState = {
  entries: [],
  hasError: false,
  clearLogs: vi.fn(),
  clearErrorFlag: vi.fn(),
  exportLogs: vi.fn(() => '[]'),
};

const updateStoreState = {
  needRefresh: false,
  offlineReady: false,
  registration: null,
  isCheckingForUpdate: false,
  pendingUpdateCheckAfterRegister: false,
  updateServiceWorker: vi.fn(),
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  setRegistration: vi.fn(),
  checkForUpdate: vi.fn(),
  queueUpdateCheckAfterRegister: vi.fn(),
  clearPendingUpdateCheck: vi.fn(),
  clearUpdateSignals: vi.fn(),
  setUpdateServiceWorker: vi.fn(),
};

const uiStoreState = {
  showToast: vi.fn(),
};

vi.mock('../stores', () => ({
  useLogStore: (selector: (state: typeof logStoreState) => unknown) => selector(logStoreState),
}));

vi.mock('../stores/updateStore', () => ({
  useUpdateStore: (selector?: (state: typeof updateStoreState) => unknown) =>
    selector ? selector(updateStoreState) : updateStoreState,
}));

vi.mock('../stores/uiStore', () => ({
  useUIStore: (selector: (state: typeof uiStoreState) => unknown) => selector(uiStoreState),
}));

vi.mock('../hooks/useDisableBodyScroll', () => ({
  useDisableBodyScroll: () => {},
}));

const mockMobileViewport = () => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === '(max-width: 767px)',
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
};

const renderAiModal = (onClose = vi.fn()) => {
  const result = render(
    <AiModal
      isOpen={true}
      onClose={onClose}
      aiPrompt=""
      aiScript=""
      aiScriptLength="short"
      aiVoice="Aoede"
      aiVoiceStyle=""
      isAiLoading={false}
      voiceOptions={[{ id: 'Aoede', label: 'Aoede', desc: 'default' }]}
      onPromptChange={() => {}}
      onScriptChange={() => {}}
      onScriptLengthChange={() => {}}
      onVoiceChange={() => {}}
      onVoiceStyleChange={() => {}}
      onGenerateScript={() => {}}
      onGenerateSpeech={() => {}}
    />
  );

  return { ...result, onClose };
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  useOfflineModeStore.getState().setOfflineMode(false);
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('modal backdrop behavior', () => {
  it('SettingsModal は領域外クリックで閉じる', () => {
    const onClose = vi.fn();
    const { container } = render(<SettingsModal isOpen={true} onClose={onClose} />);

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('SettingsModal は各種設定タブの文言を正しく表示する', () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    expect(screen.getByRole('button', { name: '各種設定' })).toBeInTheDocument();
    expect(screen.queryByText('蜷榊燕險ｭ螳・')).not.toBeInTheDocument();
  });

  it('SettingsModal は API キー保存後も閉じない', () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    render(<SettingsModal isOpen={true} onClose={onClose} />);

    const input = screen.getByPlaceholderText('AIza...');
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: 'AIza-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    act(() => {
      vi.advanceTimersByTime(1100);
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('保存しました！')).toBeInTheDocument();
    expect(localStorage.getItem('turtle-video-gemini-api-key')).toBe('AIza-test-key');
  });

  it('SettingsModal はオフライン時に更新確認ボタンを無効化する', () => {
    useOfflineModeStore.getState().setOfflineMode(true);
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '各種設定' }));

    expect(screen.getByRole('button', { name: '無効' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '有効' })).toBeInTheDocument();

    const updateButton = screen.getByRole('button', { name: '更新を確認' });
    expect(updateButton).toBeDisabled();

    fireEvent.click(updateButton);

    expect(updateStoreState.checkForUpdate).not.toHaveBeenCalled();
  });

  it('SettingsModal は更新なし時に結果を通知する', async () => {
    updateStoreState.checkForUpdate.mockResolvedValue('up-to-date');
    render(<SettingsModal isOpen={true} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: '各種設定' }));
    fireEvent.click(screen.getByRole('button', { name: '更新を確認' }));

    await waitFor(() => {
      expect(uiStoreState.showToast).toHaveBeenCalledWith('更新がありませんでした');
    });
  });

  it('AiModal は領域外クリックでは閉じない', () => {
    const { container, onClose } = renderAiModal();

    fireEvent.click(container.firstChild as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('AiModal は textarea からの下スワイプでは閉じない', () => {
    mockMobileViewport();
    const { container, onClose } = renderAiModal();
    const textarea = container.querySelector('textarea');

    expect(textarea).not.toBeNull();

    fireEvent.touchStart(textarea as HTMLElement, {
      touches: [{ clientX: 120, clientY: 100 }],
    });
    fireEvent.touchMove(textarea as HTMLElement, {
      touches: [{ clientX: 122, clientY: 196 }],
    });
    fireEvent.touchEnd(textarea as HTMLElement);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('AiModal は上端のシートを下スワイプすると閉じる', () => {
    mockMobileViewport();
    const { container, onClose } = renderAiModal();
    const sheetScrollArea = container.querySelector('div.overflow-y-auto');

    expect(sheetScrollArea).not.toBeNull();

    fireEvent.touchStart(sheetScrollArea as HTMLElement, {
      touches: [{ clientX: 140, clientY: 100 }],
    });
    fireEvent.touchMove(sheetScrollArea as HTMLElement, {
      touches: [{ clientX: 142, clientY: 196 }],
    });
    fireEvent.touchEnd(sheetScrollArea as HTMLElement);

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
