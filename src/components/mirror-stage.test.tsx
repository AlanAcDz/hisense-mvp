import { act, render, waitFor } from '@testing-library/react';
import { MirrorStage } from '@/components/mirror-stage';
import { createPoseFrame } from '@/lib/mirror/pose/torso';
import type { LandmarkerFrame, PoseLandmark2D, PoseLandmark3D } from '@/lib/mirror/types';

function buildNormalizedLandmarks(visibility = 0.98) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
    visibility,
  })) satisfies PoseLandmark2D[];

  landmarks[11] = { x: 0.4, y: 0.3, z: 0, visibility };
  landmarks[12] = { x: 0.6, y: 0.3, z: 0, visibility };
  landmarks[13] = { x: 0.3, y: 0.47, z: 0, visibility };
  landmarks[14] = { x: 0.7, y: 0.47, z: 0, visibility };
  landmarks[23] = { x: 0.43, y: 0.7, z: 0, visibility };
  landmarks[24] = { x: 0.57, y: 0.7, z: 0, visibility };

  return landmarks;
}

function buildWorldLandmarks(visibility = 0.98) {
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    z: 0,
    visibility,
  })) satisfies PoseLandmark3D[];

  landmarks[11] = { x: -0.18, y: -0.08, z: -0.25, visibility };
  landmarks[12] = { x: 0.18, y: -0.08, z: -0.23, visibility };
  landmarks[13] = { x: -0.34, y: 0.08, z: -0.18, visibility };
  landmarks[14] = { x: 0.34, y: 0.08, z: -0.17, visibility };
  landmarks[23] = { x: -0.14, y: 0.38, z: -0.2, visibility };
  landmarks[24] = { x: 0.14, y: 0.38, z: -0.19, visibility };

  return landmarks;
}

describe('MirrorStage', () => {
  const createCameraStream = (track: Partial<MediaStreamTrack> = {}) => {
    const cameraTrack = {
      stop: vi.fn(),
      ...track,
    } as MediaStreamTrack;

    return {
      getTracks: () => [cameraTrack],
      getVideoTracks: () => [cameraTrack],
    } as unknown as MediaStream;
  };
  const getUserMediaMock = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }],
  });
  const requestAnimationFrameMock = vi.fn<(callback: FrameRequestCallback) => number>();
  const cancelAnimationFrameMock = vi.fn();
  const videoMattingRuntime = () => ({
    detectMattingFrame: () => null,
    error: null,
    isLoading: false,
    stats: {
      fps: 0,
      inferenceMs: 0,
      snapshotMs: 0,
      modelMs: 0,
      maskMs: 0,
      inputWidth: 0,
      inputHeight: 0,
      backend: null,
    },
  });
  let queuedFrames: FrameRequestCallback[] = [];

  beforeAll(() => {
    class ResizeObserverMock {
      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.callback(
          [
            {
              contentRect: {
                width: 960,
                height: 540,
              },
              target,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        );
      }

      disconnect() {}

      unobserve() {}
    }

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', requestAnimationFrameMock);
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrameMock);

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: getUserMediaMock,
      },
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: vi.fn().mockResolvedValue(undefined),
    });

    Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
      configurable: true,
      value: vi.fn(),
    });

    Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
      configurable: true,
      get: () => HTMLMediaElement.HAVE_ENOUGH_DATA,
    });

    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
      configurable: true,
      get: () => 1280,
    });

    Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
      configurable: true,
      get: () => 720,
    });

    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value: () => ({
        arc() {},
        beginPath() {},
        clearRect() {},
        createImageData: (width: number, height: number) => ({
          data: new Uint8ClampedArray(width * height * 4),
          height,
          width,
        }),
        createLinearGradient: () => ({
          addColorStop() {},
        }),
        drawImage() {},
        fill() {},
        fillRect() {},
        lineTo() {},
        moveTo() {},
        putImageData() {},
        restore() {},
        save() {},
        scale() {},
        set fillStyle(_value: string | CanvasGradient) {},
        set globalCompositeOperation(_value: GlobalCompositeOperation) {},
        set lineCap(_value: CanvasLineCap) {},
        set lineJoin(_value: CanvasLineJoin) {},
        set lineWidth(_value: number) {},
        set strokeStyle(_value: string | CanvasGradient | CanvasPattern) {},
        stroke() {},
        translate() {},
      }),
    });
  });

  beforeEach(() => {
    queuedFrames = [];
    getUserMediaMock.mockClear();
    getUserMediaMock.mockResolvedValue(createCameraStream());

    requestAnimationFrameMock.mockImplementation((callback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
  });

  function flushNextFrame(timestamp = 1000) {
    const nextFrame = queuedFrames.shift();
    if (!nextFrame) {
      throw new Error('Expected an animation frame to be queued.');
    }

    act(() => {
      nextFrame(timestamp);
    });
  }

  it('requests the preferred camera resolution for kiosk hardware', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    getUserMediaMock.mockResolvedValue(
      createCameraStream({
        applyConstraints,
        getCapabilities: () =>
          ({
            width: { max: 2560 },
            height: { max: 1440 },
            frameRate: { max: 60 },
          }) as MediaTrackCapabilities,
      })
    );

    render(
      <MirrorStage
        showPosePoints={false}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => ({ poseFrame: null, segmentationFrame: null }),
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await waitFor(() =>
      expect(getUserMediaMock).toHaveBeenCalledWith({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30 },
        },
      })
    );
    await waitFor(() =>
      expect(applyConstraints).toHaveBeenCalledWith({
        width: { exact: 1920 },
        height: { exact: 1080 },
        frameRate: { ideal: 30 },
      })
    );
  });

  it('starts the camera only while cameraEnabled is true', async () => {
    const stop = vi.fn();
    getUserMediaMock.mockResolvedValue(createCameraStream({ stop }));

    const { rerender } = render(
      <MirrorStage
        cameraEnabled={false}
        showPosePoints={false}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => ({ poseFrame: null, segmentationFrame: null }),
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await act(async () => {});
    expect(getUserMediaMock).not.toHaveBeenCalled();

    rerender(
      <MirrorStage
        cameraEnabled
        showPosePoints={false}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => ({ poseFrame: null, segmentationFrame: null }),
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));

    rerender(
      <MirrorStage
        cameraEnabled={false}
        showPosePoints={false}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => ({ poseFrame: null, segmentationFrame: null }),
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('shows paused guidance when background replacement lacks a matte', async () => {
    const poseFrame = createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000);
    const landmarkerFrame: LandmarkerFrame = {
      poseFrame,
      segmentationFrame: null,
    };
    const onStatusChange = vi.fn();

    render(
      <MirrorStage
        showPosePoints={false}
        onStatusChange={onStatusChange}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => landmarkerFrame,
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    flushNextFrame();

    expect(onStatusChange).toHaveBeenCalledWith(expect.stringMatching(/improve lighting/i));
  });

  it('notifies when subject detection changes', async () => {
    let landmarkerFrame: LandmarkerFrame = {
      poseFrame: createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000),
      segmentationFrame: null,
    };
    const onSubjectDetectedChange = vi.fn();

    render(
      <MirrorStage
        showPosePoints={false}
        onSubjectDetectedChange={onSubjectDetectedChange}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => landmarkerFrame,
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    flushNextFrame();

    expect(onSubjectDetectedChange).toHaveBeenCalledWith(true);

    landmarkerFrame = {
      poseFrame: null,
      segmentationFrame: null,
    };
    flushNextFrame(1040);

    expect(onSubjectDetectedChange).toHaveBeenLastCalledWith(false);
  });

  it('ignores background-sized torso detections', async () => {
    const backgroundLandmarks = buildNormalizedLandmarks();
    backgroundLandmarks[11] = { x: 0.47, y: 0.43, z: 0, visibility: 0.98 };
    backgroundLandmarks[12] = { x: 0.53, y: 0.43, z: 0, visibility: 0.98 };
    backgroundLandmarks[23] = { x: 0.48, y: 0.58, z: 0, visibility: 0.98 };
    backgroundLandmarks[24] = { x: 0.52, y: 0.58, z: 0, visibility: 0.98 };
    let landmarkerFrame: LandmarkerFrame = {
      poseFrame: createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000),
      segmentationFrame: null,
    };
    const onSubjectDetectedChange = vi.fn();

    render(
      <MirrorStage
        showPosePoints={false}
        onSubjectDetectedChange={onSubjectDetectedChange}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => landmarkerFrame,
          error: null,
          isLoading: false,
        })}
        useVideoMattingRuntime={videoMattingRuntime}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    flushNextFrame();

    expect(onSubjectDetectedChange).toHaveBeenCalledWith(true);

    landmarkerFrame = {
      poseFrame: createPoseFrame(backgroundLandmarks, buildWorldLandmarks(), 1040),
      segmentationFrame: null,
    };
    flushNextFrame(1040);

    expect(onSubjectDetectedChange).toHaveBeenLastCalledWith(false);
  });
});
