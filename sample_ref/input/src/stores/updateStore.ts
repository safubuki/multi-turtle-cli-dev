import { create } from 'zustand';

export type UpdateCheckResult = 'update-found' | 'up-to-date' | 'unavailable' | 'error';

const UPDATE_CHECK_TIMEOUT_MS = 4000;

function waitForServiceWorkerUpdate(registration: ServiceWorkerRegistration): Promise<boolean> {
  return new Promise((resolve) => {
    if (registration.waiting) {
      resolve(true);
      return;
    }

    let installingWorker: ServiceWorker | null = registration.installing;
    let settled = false;
    let timeoutId: number | null = null;

    const finalize = (hasUpdate: boolean) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
      registration.removeEventListener('updatefound', handleUpdateFound);
      if (installingWorker) {
        installingWorker.removeEventListener('statechange', handleStateChange);
      }
      resolve(hasUpdate || Boolean(registration.waiting));
    };

    const handleStateChange = () => {
      if (!installingWorker) {
        finalize(Boolean(registration.waiting));
        return;
      }
      if (installingWorker.state === 'installed' || installingWorker.state === 'activated' || installingWorker.state === 'redundant') {
        finalize(Boolean(registration.waiting));
      }
    };

    const bindInstallingWorker = (worker: ServiceWorker | null) => {
      if (installingWorker) {
        installingWorker.removeEventListener('statechange', handleStateChange);
      }
      installingWorker = worker;
      if (installingWorker) {
        installingWorker.addEventListener('statechange', handleStateChange);
      }
    };

    const handleUpdateFound = () => {
      bindInstallingWorker(registration.installing);
    };

    registration.addEventListener('updatefound', handleUpdateFound);
    bindInstallingWorker(registration.installing);
    timeoutId = window.setTimeout(() => finalize(Boolean(registration.waiting)), UPDATE_CHECK_TIMEOUT_MS);
  });
}

interface UpdateState {
    needRefresh: boolean;
    offlineReady: boolean;
    registration: ServiceWorkerRegistration | null;
    isCheckingForUpdate: boolean;
    pendingUpdateCheckAfterRegister: boolean;
    updateServiceWorker: (reloadPage?: boolean) => Promise<void>;
    setNeedRefresh: (value: boolean) => void;
    setOfflineReady: (value: boolean) => void;
    setRegistration: (registration: ServiceWorkerRegistration | undefined) => void;
    checkForUpdate: () => Promise<UpdateCheckResult>;
    queueUpdateCheckAfterRegister: () => void;
    clearPendingUpdateCheck: () => void;
    clearUpdateSignals: () => void;
    setUpdateServiceWorker: (fn: (reloadPage?: boolean) => Promise<void>) => void;
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
    needRefresh: false,
    offlineReady: false,
    registration: null,
    isCheckingForUpdate: false,
    pendingUpdateCheckAfterRegister: false,
    updateServiceWorker: async () => { },
    setNeedRefresh: (value) => set({ needRefresh: value }),
    setOfflineReady: (value) => set({ offlineReady: value }),
    setRegistration: (registration) => set({ registration: registration ?? null }),
    checkForUpdate: async () => {
        const registration = get().registration;
        if (!registration) {
            set({ isCheckingForUpdate: false });
            return 'unavailable';
        }

        set({ isCheckingForUpdate: true });
        try {
            await registration.update();
            const hasUpdate = registration.waiting ? true : await waitForServiceWorkerUpdate(registration);
            if (hasUpdate) {
                set({ needRefresh: true, isCheckingForUpdate: false });
                return 'update-found';
            }
            set({ isCheckingForUpdate: false });
            return 'up-to-date';
        } catch (error) {
            console.error('Update check failed:', error);
            set({ isCheckingForUpdate: false });
            return 'error';
        }
    },
    queueUpdateCheckAfterRegister: () => set({ pendingUpdateCheckAfterRegister: true }),
    clearPendingUpdateCheck: () => set({ pendingUpdateCheckAfterRegister: false }),
    clearUpdateSignals: () => set({
        needRefresh: false,
        offlineReady: false,
        isCheckingForUpdate: false,
        pendingUpdateCheckAfterRegister: false,
    }),
    setUpdateServiceWorker: (fn) => set({ updateServiceWorker: fn }),
}));
