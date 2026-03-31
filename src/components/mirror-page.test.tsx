import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MirrorPage } from '@/components/mirror-page';
import type { MirrorStageHandle, MirrorStageProps } from '@/components/mirror-stage';

describe('MirrorPage', () => {
  it('renders the mirror immediately and keeps pose points hidden by default', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { jerseyOpacity, showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return (
        <div
          data-testid="mirror-stage"
          data-jersey-opacity={String(jerseyOpacity)}
          data-show-points={String(showPosePoints)}
        />
      );
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    expect(screen.getByRole('button', { name: /capture/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /focus sleeves/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /show pose points/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-jersey-opacity', '1');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'false');
  });

  it('forwards capture requests to the live stage handle', () => {
    const captureSpy = vi.fn();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { jerseyOpacity, showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: captureSpy,
      }));

      return (
        <div
          data-testid="mirror-stage"
          data-jersey-opacity={String(jerseyOpacity)}
          data-show-points={String(showPosePoints)}
        />
      );
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('shows runtime status inside the floating controls and keeps them usable', () => {
    const captureSpy = vi.fn();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { jerseyOpacity, onStatusChange, showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: captureSpy,
      }));
      useEffect(() => {
        onStatusChange?.('Using proxy sleeves instead.');
      }, [onStatusChange]);

      return (
        <div>
          <div
            data-testid="mirror-stage"
            data-jersey-opacity={String(jerseyOpacity)}
            data-show-points={String(showPosePoints)}
          />
        </div>
      );
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /focus sleeves/i }));
    fireEvent.click(screen.getByRole('button', { name: /show pose points/i }));
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(screen.getByText(/using proxy sleeves instead/i)).toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-jersey-opacity', '0.1');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'true');
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });
});
