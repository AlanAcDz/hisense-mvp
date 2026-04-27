import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MirrorPage } from '@/components/mirror-page';
import type { MirrorStageHandle, MirrorStageProps } from '@/components/mirror-stage';
import { SCREENSAVER_VIDEO_ASSET_URL } from '@/lib/mirror/constants';

describe('MirrorPage', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function queryScreensaverVideo() {
    return document.querySelector<HTMLVideoElement>(
      `video[src="${SCREENSAVER_VIDEO_ASSET_URL}"]`
    );
  }

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

    fireEvent.click(screen.getByRole('button', { name: /show pose points/i }));
    fireEvent.click(screen.getByRole('button', { name: /capture/i }));

    expect(screen.getByText(/using proxy sleeves instead/i)).toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-jersey-opacity', '1');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'true');
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('shows the screensaver after one minute without a detected subject', () => {
    vi.useFakeTimers();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(_props, ref) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return <div data-testid="mirror-stage" />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    expect(queryScreensaverVideo()).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(59_999);
    });
    expect(queryScreensaverVideo()).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryScreensaverVideo()).toBeInTheDocument();
  });

  it('hides the screensaver when a subject is detected again', () => {
    vi.useFakeTimers();
    let subjectDetected = false;
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { onSubjectDetectedChange },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));
      useEffect(() => {
        onSubjectDetectedChange?.(subjectDetected);
      });

      return <div data-testid="mirror-stage" />;
    });

    const { rerender } = render(<MirrorPage StageComponent={FakeStage} />);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(queryScreensaverVideo()).toBeInTheDocument();

    subjectDetected = true;
    rerender(<MirrorPage StageComponent={FakeStage} />);

    expect(queryScreensaverVideo()).not.toBeInTheDocument();
  });
});
