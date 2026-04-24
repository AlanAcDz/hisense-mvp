import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  getPwaRegistrationSnapshot,
  reloadForPwaUpdate,
  subscribeToPwaRegistration,
} from '@/lib/pwa/registration';
import type { BeforeInstallPromptEvent, PwaControllerState } from '@/lib/pwa/types';

const INSTALL_DISMISS_STORAGE_KEY = 'hisense-mvp:pwa-install-dismissed';

function readInstallDismissalPreference() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY) === 'true';
}

function detectStandaloneMode() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.matchMedia('(display-mode: standalone)').matches;
}

function bindMediaQueryListener(
  mediaQuery: MediaQueryList,
  listener: (event: MediaQueryListEvent) => void
) {
  if ('addEventListener' in mediaQuery) {
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }

  const legacyMediaQuery = mediaQuery as MediaQueryList & {
    addListener(listener: (event: MediaQueryListEvent) => void): void;
    removeListener(listener: (event: MediaQueryListEvent) => void): void;
  };

  legacyMediaQuery.addListener(listener);
  return () => legacyMediaQuery.removeListener(listener);
}

export function usePwaController(): PwaControllerState {
  const { offlineReady, updateReady } = useSyncExternalStore(
    subscribeToPwaRegistration,
    getPwaRegistrationSnapshot,
    getPwaRegistrationSnapshot
  );
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(detectStandaloneMode);
  const [dismissedInstallPrompt, setDismissedInstallPrompt] = useState(
    readInstallDismissalPreference
  );
  const [hideUpdatePrompt, setHideUpdatePrompt] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(display-mode: standalone)');

    function handleBeforeInstallPrompt(event: Event) {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    }

    function handleAppInstalled() {
      setDeferredPrompt(null);
      setIsInstalled(true);
    }

    function handleStandaloneChange(event: MediaQueryListEvent) {
      setIsInstalled(event.matches);
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    const unbindStandaloneListener = bindMediaQueryListener(mediaQuery, handleStandaloneChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      unbindStandaloneListener();
    };
  }, []);

  useEffect(() => {
    if (updateReady) {
      setHideUpdatePrompt(false);
    }
  }, [updateReady]);

  async function install() {
    if (!deferredPrompt) {
      return;
    }

    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;

    if (outcome === 'accepted') {
      setDeferredPrompt(null);
      setDismissedInstallPrompt(false);
      window.localStorage.removeItem(INSTALL_DISMISS_STORAGE_KEY);
    }
  }

  function dismissInstallPrompt() {
    window.localStorage.setItem(INSTALL_DISMISS_STORAGE_KEY, 'true');
    setDismissedInstallPrompt(true);
  }

  function dismissUpdatePrompt() {
    setHideUpdatePrompt(true);
  }

  async function reloadForUpdate() {
    await reloadForPwaUpdate();
  }

  const canInstall = Boolean(deferredPrompt) && !dismissedInstallPrompt && !isInstalled;
  const showInstallPrompt = canInstall;
  const showUpdatePrompt = updateReady && !hideUpdatePrompt;

  return {
    canInstall,
    isInstalled,
    updateReady,
    offlineReady,
    dismissedInstallPrompt,
    showInstallPrompt,
    showUpdatePrompt,
    install,
    dismissInstallPrompt,
    dismissUpdatePrompt,
    reloadForUpdate,
  };
}
