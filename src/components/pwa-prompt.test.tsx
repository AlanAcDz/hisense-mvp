import { fireEvent, render, screen } from '@testing-library/react';
import { PwaPrompt } from '@/components/pwa-prompt';
import type { PwaControllerState } from '@/lib/pwa/types';

function createControllerState(
  overrides: Partial<PwaControllerState> = {}
): PwaControllerState {
  return {
    canInstall: false,
    isInstalled: false,
    updateReady: false,
    offlineReady: false,
    dismissedInstallPrompt: false,
    showInstallPrompt: false,
    showUpdatePrompt: false,
    install: vi.fn().mockResolvedValue(undefined),
    dismissInstallPrompt: vi.fn(),
    dismissUpdatePrompt: vi.fn(),
    reloadForUpdate: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('PwaPrompt', () => {
  it('keeps the install CTA hidden by default', () => {
    render(<PwaPrompt controller={createControllerState()} />);

    expect(screen.queryByRole('button', { name: /install/i })).not.toBeInTheDocument();
  });

  it('renders the install CTA when the app can be installed', () => {
    render(
      <PwaPrompt
        controller={createControllerState({
          canInstall: true,
          showInstallPrompt: true,
        })}
      />
    );

    expect(screen.getByRole('button', { name: /^install$/i })).toBeInTheDocument();
    expect(screen.getByText(/stays available offline/i)).toBeInTheDocument();
  });

  it('renders update actions and forwards button clicks', () => {
    const reloadForUpdate = vi.fn().mockResolvedValue(undefined);
    const dismissUpdatePrompt = vi.fn();

    render(
      <PwaPrompt
        controller={createControllerState({
          updateReady: true,
          showUpdatePrompt: true,
          reloadForUpdate,
          dismissUpdatePrompt,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /reload now/i }));
    fireEvent.click(screen.getByRole('button', { name: /later/i }));

    expect(screen.getByText(/newer offline bundle is available/i)).toBeInTheDocument();
    expect(reloadForUpdate).toHaveBeenCalledTimes(1);
    expect(dismissUpdatePrompt).toHaveBeenCalledTimes(1);
  });
});
