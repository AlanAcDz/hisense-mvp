import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { usePwaController } from '@/lib/pwa/use-pwa-controller';
import {
  resetPwaRegistrationForTests,
  setPwaRegistrationSnapshotForTests,
} from '@/lib/pwa/registration';
import type { BeforeInstallPromptEvent } from '@/lib/pwa/types';

function ControllerHarness() {
  const controller = usePwaController();

  return (
    <div>
      <div data-testid="can-install">{String(controller.canInstall)}</div>
      <div data-testid="is-installed">{String(controller.isInstalled)}</div>
      <div data-testid="update-ready">{String(controller.updateReady)}</div>
      <div data-testid="dismissed-install">{String(controller.dismissedInstallPrompt)}</div>
      <button type="button" onClick={controller.dismissInstallPrompt}>
        dismiss install
      </button>
    </div>
  );
}

function createBeforeInstallPromptEvent(): BeforeInstallPromptEvent {
  const event = new Event('beforeinstallprompt') as BeforeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(event, 'userChoice', {
    configurable: true,
    value: Promise.resolve({ outcome: 'accepted' as const }),
  });
  return event;
}

describe('usePwaController', () => {
  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation(() => ({
        matches: false,
        media: '(display-mode: standalone)',
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    resetPwaRegistrationForTests();
    window.localStorage.clear();
  });

  it('captures beforeinstallprompt and clears install availability after appinstalled', async () => {
    render(<ControllerHarness />);

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });

    await waitFor(() => {
      expect(screen.getByTestId('can-install')).toHaveTextContent('true');
    });

    act(() => {
      window.dispatchEvent(new Event('appinstalled'));
    });

    expect(screen.getByTestId('can-install')).toHaveTextContent('false');
    expect(screen.getByTestId('is-installed')).toHaveTextContent('true');
  });

  it('exposes update readiness when the service worker registration notifies the app', async () => {
    render(<ControllerHarness />);

    act(() => {
      setPwaRegistrationSnapshotForTests({ updateReady: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('update-ready')).toHaveTextContent('true');
    });
  });

  it('persists install prompt dismissal in local storage', async () => {
    render(<ControllerHarness />);

    act(() => {
      window.dispatchEvent(createBeforeInstallPromptEvent());
    });

    await waitFor(() => {
      expect(screen.getByTestId('can-install')).toHaveTextContent('true');
    });

    fireEvent.click(screen.getByRole('button', { name: /dismiss install/i }));

    expect(window.localStorage.getItem('hisense-mvp:pwa-install-dismissed')).toBe('true');
    expect(screen.getByTestId('dismissed-install')).toHaveTextContent('true');
    expect(screen.getByTestId('can-install')).toHaveTextContent('false');
  });
});
