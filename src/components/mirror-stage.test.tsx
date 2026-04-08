import { act, render, screen, waitFor } from '@testing-library/react';
import { MirrorStage } from '@/components/mirror-stage';
import {
  computeSleeveTransform,
  computeTorsoTransform,
  createPoseFrame,
  getCoverLayout,
} from '@/lib/mirror/pose/torso';
import { applySleeveRenderTwist } from '@/lib/mirror/sleeve-render';
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
  const getUserMediaMock = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop: vi.fn() }],
  });
  const requestAnimationFrameMock = vi.fn<(callback: FrameRequestCallback) => number>();
  const cancelAnimationFrameMock = vi.fn();
  const shirtSceneSpies = {
    dispose: vi.fn(),
    loadShirtModel: vi.fn().mockResolvedValue({ errorMessage: null, usedFallback: false }),
    render: vi.fn(),
    resize: vi.fn(),
    setJerseyOpacity: vi.fn(),
    updateShirtTransform: vi.fn(),
    updateSleeves: vi.fn(),
  };
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
    Object.values(shirtSceneSpies).forEach((spy) => spy.mockClear());

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

  it('shows paused guidance while keeping shirt tracking active', async () => {
    const poseFrame = createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000);
    const landmarkerFrame: LandmarkerFrame = {
      poseFrame,
      segmentationFrame: null,
    };
    const onStatusChange = vi.fn();

    render(
      <MirrorStage
        jerseyOpacity={0.1}
        showPosePoints={false}
        onStatusChange={onStatusChange}
        createSceneController={() => ({
          canvas: document.createElement('canvas'),
          dispose: shirtSceneSpies.dispose,
          loadShirtModel: shirtSceneSpies.loadShirtModel,
          render: shirtSceneSpies.render,
          resize: shirtSceneSpies.resize,
          setJerseyOpacity: shirtSceneSpies.setJerseyOpacity,
          updateShirtTransform: shirtSceneSpies.updateShirtTransform,
          updateSleeves: shirtSceneSpies.updateSleeves,
        })}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => landmarkerFrame,
          error: null,
          isLoading: false,
        })}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    flushNextFrame();

    expect(onStatusChange).toHaveBeenCalledWith(expect.stringMatching(/improve lighting/i));
    expect(shirtSceneSpies.setJerseyOpacity).toHaveBeenCalledWith(0.1);
    expect(
      shirtSceneSpies.updateShirtTransform.mock.calls.some(([transform]) => Boolean(transform))
    ).toBe(true);
  });

  it('applies the shared sleeve render twist before updating the live sleeves', async () => {
    const poseFrame = createPoseFrame(buildNormalizedLandmarks(), buildWorldLandmarks(), 1000);
    const landmarkerFrame: LandmarkerFrame = {
      poseFrame,
      segmentationFrame: null,
    };

    render(
      <MirrorStage
        jerseyOpacity={0.1}
        showPosePoints={false}
        createSceneController={() => ({
          canvas: document.createElement('canvas'),
          dispose: shirtSceneSpies.dispose,
          loadShirtModel: shirtSceneSpies.loadShirtModel,
          render: shirtSceneSpies.render,
          resize: shirtSceneSpies.resize,
          setJerseyOpacity: shirtSceneSpies.setJerseyOpacity,
          updateShirtTransform: shirtSceneSpies.updateShirtTransform,
          updateSleeves: shirtSceneSpies.updateSleeves,
        })}
        usePoseLandmarkerRuntime={() => ({
          detectFrame: () => landmarkerFrame,
          error: null,
          isLoading: false,
        })}
      />
    );

    await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1));
    await act(async () => {});
    flushNextFrame();

    const stageSize = { width: 960, height: 540 };
    const coverLayout = getCoverLayout({ width: 1280, height: 720 }, stageSize);
    const torsoTransform = computeTorsoTransform(poseFrame, stageSize, coverLayout);

    expect(torsoTransform).not.toBeNull();

    const expectedLeftSleeve = applySleeveRenderTwist(
      computeSleeveTransform(poseFrame!.leftArm, torsoTransform!, stageSize, coverLayout)!
    );
    const sleeveCall = shirtSceneSpies.updateSleeves.mock.calls.find(([leftSleeve]) => Boolean(leftSleeve));

    expect(sleeveCall).toBeTruthy();
    expect(sleeveCall?.[0]?.rotation.angleTo(expectedLeftSleeve.rotation)).toBeLessThan(1e-6);
  });
});
