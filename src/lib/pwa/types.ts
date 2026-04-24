export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaControllerState {
  canInstall: boolean;
  isInstalled: boolean;
  updateReady: boolean;
  offlineReady: boolean;
  dismissedInstallPrompt: boolean;
  showInstallPrompt: boolean;
  showUpdatePrompt: boolean;
  install: () => Promise<void>;
  dismissInstallPrompt: () => void;
  dismissUpdatePrompt: () => void;
  reloadForUpdate: () => Promise<void>;
}
