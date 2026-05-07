import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MirrorPage } from '@/components/mirror-page';
import type { MirrorStageHandle, MirrorStageProps } from '@/components/mirror-stage';
import {
  DEFAULT_SCREENSAVER_OPTION,
  DETECTION_INPUT_LONG_EDGE_PX,
  getScreensaverVideoUrl,
  POSE_MODEL_VARIANT,
} from '@/lib/mirror/constants';

describe('MirrorPage', () => {
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    window.localStorage.clear();
  });

  function queryScreensaverVideo() {
    return document.querySelector<HTMLVideoElement>(
      `video[src="${getScreensaverVideoUrl(DEFAULT_SCREENSAVER_OPTION)}"]`
    );
  }

  it('renders the mirror immediately and keeps pose points hidden by default', () => {
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return (
        <div
          data-testid="mirror-stage"
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

  it('counts subject detections and persists them in local storage', () => {
    let notifySubjectDetected: MirrorStageProps['onSubjectDetectedChange'];
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { onSubjectDetectedChange },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));
      notifySubjectDetected = onSubjectDetectedChange;

      return <div data-testid="mirror-stage" />;
    });

    const { unmount } = render(<MirrorPage StageComponent={FakeStage} />);

    expect(screen.getByText('Detecciones')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();

    act(() => {
      notifySubjectDetected?.(true);
    });
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(window.localStorage.getItem('hisense-mvp:subject-detection-count')).toBe('1');

    act(() => {
      notifySubjectDetected?.(false);
      notifySubjectDetected?.(true);
    });
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(window.localStorage.getItem('hisense-mvp:subject-detection-count')).toBe('2');

    unmount();
    render(<MirrorPage StageComponent={FakeStage} />);

    expect(screen.getByText('2')).toBeInTheDocument();
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
      { showPosePoints },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture: captureSpy,
      }));

      return (
        <div
          data-testid="mirror-stage"
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
      { onStatusChange, showPosePoints },
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
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-show-points', 'true');
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it('alternates between AR mirror and screensaver every five minutes', () => {
    vi.useFakeTimers();
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { cameraEnabled },
      ref
    ) {
      useImperativeHandle(ref, () => ({
        capture() {},
      }));

      return <div data-testid="mirror-stage" data-camera-enabled={String(cameraEnabled)} />;
    });

    render(<MirrorPage StageComponent={FakeStage} />);

    expect(queryScreensaverVideo()).not.toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-camera-enabled', 'true');

    act(() => {
      vi.advanceTimersByTime(299_999);
    });
    expect(queryScreensaverVideo()).not.toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(queryScreensaverVideo()).toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-camera-enabled', 'false');

    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(queryScreensaverVideo()).not.toBeInTheDocument();
    expect(screen.getByTestId('mirror-stage')).toHaveAttribute('data-camera-enabled', 'true');
  });

  it('keeps the screensaver alternation independent from subject detection', () => {
    vi.useFakeTimers();
    let subjectDetected = false;
    const FakeStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function FakeStage(
      { onSubjectDetectedChange },
      ref
    ) {
      const lastNotifiedSubjectDetectedRef = useRef<boolean | null>(null);

      useImperativeHandle(ref, () => ({
        capture() {},
      }));
      useEffect(() => {
        if (lastNotifiedSubjectDetectedRef.current === subjectDetected) {
          return;
        }

        lastNotifiedSubjectDetectedRef.current = subjectDetected;
        onSubjectDetectedChange?.(subjectDetected);
      });

      return <div data-testid="mirror-stage" />;
    });

    const { rerender } = render(<MirrorPage StageComponent={FakeStage} />);

    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(queryScreensaverVideo()).toBeInTheDocument();

    subjectDetected = true;
    rerender(<MirrorPage StageComponent={FakeStage} />);

    expect(queryScreensaverVideo()).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(300_000);
    });
    expect(queryScreensaverVideo()).not.toBeInTheDocument();
  });
});
