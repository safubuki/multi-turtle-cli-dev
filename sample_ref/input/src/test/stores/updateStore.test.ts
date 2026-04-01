import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useUpdateStore } from '../../stores/updateStore';

type MockRegistration = Pick<
  ServiceWorkerRegistration,
  'waiting' | 'installing' | 'update' | 'addEventListener' | 'removeEventListener'
>;

function createRegistration(waiting: ServiceWorker | null = null): MockRegistration {
  const registration: MockRegistration = {
    waiting,
    installing: null,
    update: vi.fn(async () => registration as ServiceWorkerRegistration),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return registration;
}

describe('updateStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUpdateStore.setState({
      needRefresh: false,
      offlineReady: false,
      registration: null,
      isCheckingForUpdate: false,
      pendingUpdateCheckAfterRegister: false,
      updateServiceWorker: async () => {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('registration.waiting があれば更新ありを返す', async () => {
    const registration = createRegistration({} as ServiceWorker);
    useUpdateStore.getState().setRegistration(registration as ServiceWorkerRegistration);

    const result = await useUpdateStore.getState().checkForUpdate();

    expect(result).toBe('update-found');
    expect(useUpdateStore.getState().needRefresh).toBe(true);
  });

  it('更新が無ければ最新扱いにする', async () => {
    const registration = createRegistration();
    useUpdateStore.getState().setRegistration(registration as ServiceWorkerRegistration);

    const pending = useUpdateStore.getState().checkForUpdate();
    await vi.advanceTimersByTimeAsync(4000);
    const result = await pending;

    expect(result).toBe('up-to-date');
    expect(useUpdateStore.getState().needRefresh).toBe(false);
  });
});
