import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MirrorPage } from '@/components/mirror-page';
import type { MirrorStageHandle, MirrorStageProps } from '@/components/mirror-stage';
import {
  DETECTION_INPUT_LONG_EDGE_PX,
  POSE_MODEL_VARIANT,
  SCREENSAVER_VIDEO_ASSET_URL,
} from '@/lib/mirror/constants';

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

    expect(
      screen.getByText(/Colócate frente a la pantalla para comenzar la experiencia/i)
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /capturar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mostrar puntos de pose/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-jersey-opacity', '1');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'false');
  });

  it('hides the start prompt once a subject is detected', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { onSubjectDetectedChange },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));
      useEffect(() => {
        onSubjectDetectedChange?.(true);
      }, [onSubjectDetectedChange]);

      return <div data-testid="mirror-stage" />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    expect(
      screen.queryByText(/Colócate frente a la pantalla para comenzar la experiencia/i)
    ).not.toBeInTheDocument();
  });

  it('reveals the right-side controls from the hidden lip', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(_props, ref) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return <div data-testid="mirror-stage" />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    expect(screen.queryByRole('button', { name: /mostrar controles completos/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /mostrar configuración/i }));

    expect(screen.getByRole('button', { name: /mostrar controles completos/i })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /laboratorio de calibración/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /capturar/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mostrar puntos de pose/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /modelo/i })).toHaveValue(POSE_MODEL_VARIANT);
    expect(screen.getByRole('combobox', { name: /resolución/i })).toHaveValue(
      String(DETECTION_INPUT_LONG_EDGE_PX)
    );
  });

  it('updates pose model and detection resolution from the controls lip', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { poseLandmarkerOptions },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return (
        <div
          data-testid="mirror-stage"
          data-pose-model={poseLandmarkerOptions?.modelVariant}
          data-detection-resolution={poseLandmarkerOptions?.inputLongEdgePx}
        />
      );
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    fireEvent.click(screen.getByRole('button', { name: /mostrar configuración/i }));
    fireEvent.change(screen.getByRole('combobox', { name: /modelo/i }), {
      target: { value: 'heavy' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: /resolución/i }), {
      target: { value: '1024' },
    });

    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-pose-model', 'heavy');
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-detection-resolution', '1024');
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

    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));

    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the hidden controls usable without rendering runtime status copy', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /mostrar configuración/i }));
    fireEvent.click(screen.getByRole('button', { name: /mostrar puntos de pose/i }));
    fireEvent.click(screen.getByRole('button', { name: /capturar/i }));

    expect(screen.queryByText(/using proxy sleeves instead/i)).not.toBeInTheDocument();
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
