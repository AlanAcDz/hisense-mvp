import { forwardRef, useImperativeHandle } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MirrorPage } from '@/components/mirror-page';
import type { MirrorStageHandle, MirrorStageProps } from '@/components/mirror-stage';

describe('MirrorPage', () => {
  it('transitions from idle to active and keeps pose points enabled by default', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return <div data-testid="mirror-stage" data-show-points={String(showPosePoints)} />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /start mirror/i }));

    expect(screen.getByRole('button', { name: /capture/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/show pose points/i)).toBeChecked();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'true');
  });

  it('forwards capture requests to the live stage handle', () => {
    const captureSpy = vi.fn();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: captureSpy,
      }));

      return <div data-testid="mirror-stage" data-show-points={String(showPosePoints)} />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /start mirror/i }));
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the runtime controls usable when the stage reports an asset warning', () => {
    const captureSpy = vi.fn();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: captureSpy,
      }));

      return (
        <div>
          <p>Could not load shirt model. Using proxy shirt geometry instead.</p>
          <div data-testid="mirror-stage" data-show-points={String(showPosePoints)} />
        </div>
      );
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /start mirror/i }));
    fireEvent.click(screen.getByLabelText(/show pose points/i));
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(screen.getByText(/using proxy shirt geometry instead/i)).toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'false');
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });
});
