import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReloadPrompt } from '../components/ReloadPrompt';

const offlineModeStoreState = {
  offlineMode: false,
};

const updateStoreState = {
  needRefresh: true,
  registration: null,
  pendingUpdateCheckAfterRegister: false,
  clearPendingUpdateCheck: vi.fn(),
  checkForUpdate: vi.fn(),
  setNeedRefresh: vi.fn(),
  setOfflineReady: vi.fn(),
  setRegistration: vi.fn(),
  setUpdateServiceWorker: vi.fn(),
  clearUpdateSignals: vi.fn(),
};

const hookUpdateServiceWorker = vi.fn();
const getPlatformCapabilitiesMock = vi.fn();

vi.mock('../stores/offlineModeStore', () => ({
  useOfflineModeStore: (selector: (state: typeof offlineModeStoreState) => unknown) => selector(offlineModeStoreState),
}));

vi.mock('../stores/updateStore', () => ({
  useUpdateStore: (selector: (state: typeof updateStoreState) => unknown) => selector(updateStoreState),
}));

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    offlineReady: [false, vi.fn()],
    updateServiceWorker: hookUpdateServiceWorker,
  }),
}));

vi.mock('../utils/platform', () => ({
  getPlatformCapabilities: () => getPlatformCapabilitiesMock(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: false });
});

describe('ReloadPrompt layout', () => {
  it('iOS Safari では通知を左右余白内に収める', () => {
    getPlatformCapabilitiesMock.mockReturnValue({ isIosSafari: true });

    const { container } = render(<ReloadPrompt />);
    const wrapper = container.firstChild as HTMLElement;

    expect(wrapper.style.left).toBe('1rem');
    expect(wrapper.style.right).toBe('1rem');
    expect(wrapper.style.width).toBe('auto');
    expect(wrapper.style.maxWidth).toBe('none');
  });

  it('iOS Safari 以外では既存の右下レイアウトを維持する', () => {
    const { container } = render(<ReloadPrompt />);
    const wrapper = container.firstChild as HTMLElement;

    expect(wrapper).toHaveClass('right-4', 'w-full', 'max-w-sm');
    expect(wrapper.style.left).toBe('');
    expect(wrapper.style.width).toBe('');
  });
});
