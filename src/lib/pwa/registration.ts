import { registerSW } from 'virtual:pwa-register';

interface PwaRegistrationSnapshot {
  offlineReady: boolean;
  updateReady: boolean;
}

const INITIAL_SNAPSHOT: PwaRegistrationSnapshot = {
  offlineReady: false,
  updateReady: false,
};

const listeners = new Set<() => void>();

let snapshot = INITIAL_SNAPSHOT;
let registrationInitialized = false;
let updateServiceWorker: ((reloadPage?: boolean) => Promise<void>) | null = null;

function emitSnapshot(nextSnapshot: Partial<PwaRegistrationSnapshot>) {
  snapshot = {
    ...snapshot,
    ...nextSnapshot,
  };
  listeners.forEach((listener) => listener());
}

export function initializePwaRegistration() {
  if (registrationInitialized || typeof window === 'undefined' || import.meta.env.DEV) {
    return;
  }

  registrationInitialized = true;
  updateServiceWorker = registerSW({
    immediate: true,
    onOfflineReady() {
      emitSnapshot({ offlineReady: true });
    },
    onNeedRefresh() {
      emitSnapshot({ updateReady: true });
    },
  });
}

export function subscribeToPwaRegistration(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

export function getPwaRegistrationSnapshot() {
  return snapshot;
}

export async function reloadForPwaUpdate() {
  if (!updateServiceWorker) {
    return;
  }

  await updateServiceWorker(true);
}

export function resetPwaRegistrationForTests() {
  snapshot = INITIAL_SNAPSHOT;
  registrationInitialized = false;
  updateServiceWorker = null;
  listeners.clear();
}

export function setPwaRegistrationSnapshotForTests(nextSnapshot: Partial<PwaRegistrationSnapshot>) {
  emitSnapshot(nextSnapshot);
}
