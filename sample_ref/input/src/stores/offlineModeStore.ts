import { create } from 'zustand';

const OFFLINE_MODE_STORAGE_KEY = 'turtle-video-offline-mode';

function readStoredOfflineMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(OFFLINE_MODE_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredOfflineMode(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(OFFLINE_MODE_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage が使えない環境では状態のみ保持する
  }
}

interface OfflineModeState {
  offlineMode: boolean;
  setOfflineMode: (enabled: boolean) => void;
  hydrateOfflineMode: () => void;
}

export const useOfflineModeStore = create<OfflineModeState>((set) => ({
  offlineMode: readStoredOfflineMode(),
  setOfflineMode: (enabled) => {
    writeStoredOfflineMode(enabled);
    set({ offlineMode: enabled });
  },
  hydrateOfflineMode: () => {
    set({ offlineMode: readStoredOfflineMode() });
  },
}));

export { OFFLINE_MODE_STORAGE_KEY, readStoredOfflineMode };
