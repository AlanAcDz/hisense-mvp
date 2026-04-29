import {
  applyJointBilateralFilter,
  copySegmentationAlpha,
  createBackgroundMatte,
  dilateAlphaMask,
  drawArmOcclusionLayer,
  drawBackgroundLayer,
  resolveBackgroundMatte,
} from '@/lib/mirror/background/compositor';
import type { BackgroundMatte, PoseFrame, PoseLandmark2D, SegmentationFrame } from '@/lib/mirror/types';

function createSegmentationFrame(
  width: number,
  height: number,
  values: Float32Array,
  timestamp = 1000
): SegmentationFrame {
  return {
    width,
    height,
    alpha: values,
    timestamp,
  };
}

function createPoseFrameWithForearm() {
  const normalizedLandmarks = [] as PoseLandmark2D[];
  normalizedLandmarks[13] = { x: 0.25, y: 0.4, z: 0, visibility: 1 };
  normalizedLandmarks[15] = { x: 0.5, y: 0.55, z: 0, visibility: 1 };

  return {
    normalizedLandmarks,
    worldLandmarks: [],
    timestamp: 1000,
    torso: null,
    leftArm: null,
    rightArm: null,
  } satisfies PoseFrame;
}

function createArmLayerContext() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  const ctx = {
    arc: record('arc'),
    beginPath: record('beginPath'),
    clearRect: record('clearRect'),
    drawImage: record('drawImage'),
    fill: record('fill'),
    lineTo: record('lineTo'),
    moveTo: record('moveTo'),
    restore: record('restore'),
    save: record('save'),
    scale: record('scale'),
    stroke: record('stroke'),
    translate: record('translate'),
    set fillStyle(_value: string) {},
    set globalCompositeOperation(_value: GlobalCompositeOperation) {},
    set lineCap(_value: CanvasLineCap) {},
    set lineJoin(_value: CanvasLineJoin) {},
    set lineWidth(_value: number) {},
    set strokeStyle(_value: string) {},
  } as unknown as CanvasRenderingContext2D;

  return { calls, ctx };
}

describe('background compositor', () => {
  it('copies segmentation confidence into a reusable alpha mask', () => {
    const segmentationFrame = createSegmentationFrame(
      4,
      1,
      new Float32Array([0.12, 0.48, 0.74, 1])
    );

    expect(Array.from(copySegmentationAlpha(segmentationFrame))).toEqual([0, 0, 141, 255]);
  });

  it('uses the previous alpha as hysteresis for unstable matte edge pixels', () => {
    const segmentationFrame = createSegmentationFrame(
      3,
      1,
      new Float32Array([0.39, 0.43, 0.47])
    );
    const previousAlpha = new Uint8ClampedArray([255, 255, 0]);

    const alpha = copySegmentationAlpha(segmentationFrame, undefined, undefined, previousAlpha);

    expect(alpha[0]).toBe(0);
    expect(alpha[1]).toBeGreaterThan(64);
    expect(alpha[2]).toBe(0);
  });

  it('uses guide colors to keep refined mask edges aligned to image edges', () => {
    const alpha = new Float32Array([0, 0.5, 1]);
    const guideRgba = new Uint8ClampedArray([
      20, 20, 20, 255,
      20, 20, 20, 255,
      240, 240, 240, 255,
    ]);

    const filtered = applyJointBilateralFilter(alpha, 3, 1, guideRgba, {
      edgeThreshold: 0.01,
      radius: 1,
      sigmaColor: 16,
      sigmaSpatial: 1,
    });

    expect(filtered[1]).toBeLessThan(0.35);
    expect(filtered[1]).toBeGreaterThan(0);
  });

  it('leaves the segmentation confidence unchanged without matching guide pixels', () => {
    const alpha = new Float32Array([0, 0.5, 1]);

    const filtered = applyJointBilateralFilter(alpha, 3, 1, undefined);

    expect(Array.from(filtered)).toEqual([0, 0.5, 1]);
    expect(filtered).not.toBe(alpha);
  });

  it('keeps the matte soft without expanding it too far past the subject', () => {
    const alpha = new Float32Array(25);
    alpha[12] = 1;
    const segmentationFrame = createSegmentationFrame(5, 5, alpha);

    const matte = createBackgroundMatte(segmentationFrame);

    expect(matte.alpha[12]).toBeGreaterThan(100);
    expect(matte.alpha[7]).toBeGreaterThan(0);
    expect(matte.alpha[0]).toBeLessThan(128);
    expect(matte.alpha[12]).toBeGreaterThan(matte.alpha[0] ?? 0);
    expect(matte.coverage).toBeGreaterThan(0);
  });

  it('supports fractional dilation radii without sampling sparse half-pixels', () => {
    const alpha = new Uint8ClampedArray(25);
    alpha[12] = 255;

    const dilated = dilateAlphaMask(alpha, 5, 5, 1.5);

    expect(dilated[12]).toBe(255);
    expect(dilated[7]).toBe(255);
    expect(dilated[11]).toBe(255);
    expect(dilated[0]).toBe(0);
  });

  it('reuses the last good matte while the new mask is temporarily missing', () => {
    const previousMatte: BackgroundMatte = {
      width: 3,
      height: 3,
      alpha: new Uint8ClampedArray(9).fill(255),
      coverage: 1,
      timestamp: 1000,
    };

    const result = resolveBackgroundMatte({
      segmentationFrame: null,
      previousMatte,
      now: 1050,
    });

    expect(result.matte).toBe(previousMatte);
    expect(result.reusedPrevious).toBe(true);
  });

  it('falls back to the cached matte when the new mask coverage is too weak', () => {
    const weakMask = new Float32Array(60 * 60);
    weakMask[1830] = 1;
    const previousMatte: BackgroundMatte = {
      width: 10,
      height: 10,
      alpha: new Uint8ClampedArray(100).fill(255),
      coverage: 1,
      timestamp: 980,
    };

    const result = resolveBackgroundMatte({
      segmentationFrame: createSegmentationFrame(60, 60, weakMask, 1000),
      previousMatte,
      now: 1010,
    });

    expect(result.matte).toBe(previousMatte);
    expect(result.reusedPrevious).toBe(true);
  });

  it('reuses the existing matte when the segmentation timestamp has not changed', () => {
    const alpha = new Float32Array(60 * 60).fill(1);
    const previousMatte = createBackgroundMatte(createSegmentationFrame(60, 60, alpha, 1000));

    const result = resolveBackgroundMatte({
      segmentationFrame: createSegmentationFrame(60, 60, alpha, 1000),
      previousMatte,
      now: 1020,
    });

    expect(result.matte).toBe(previousMatte);
    expect(result.reusedPrevious).toBe(false);
  });

  it('drops an old segmentation frame instead of treating it as fresh input forever', () => {
    const alpha = new Float32Array(60 * 60).fill(1);
    const previousMatte = createBackgroundMatte(createSegmentationFrame(60, 60, alpha, 1000));

    const result = resolveBackgroundMatte({
      segmentationFrame: createSegmentationFrame(60, 60, alpha, 1000),
      previousMatte,
      now: 1200,
    });

    expect(result.matte).toBeNull();
    expect(result.reusedPrevious).toBe(false);
  });

  it('drops a stale cached matte after the reuse window expires', () => {
    const previousMatte: BackgroundMatte = {
      width: 3,
      height: 3,
      alpha: new Uint8ClampedArray(9).fill(255),
      coverage: 1,
      timestamp: 1000,
    };

    const result = resolveBackgroundMatte({
      segmentationFrame: null,
      previousMatte,
      now: 1400,
    });

    expect(result.matte).toBeNull();
    expect(result.reusedPrevious).toBe(false);
  });

  it('draws the background image with cover sizing on a wider stage', () => {
    const drawImage = vi.fn();
    const ctx = {
      clearRect: vi.fn(),
      drawImage,
      createLinearGradient: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const backgroundImage = {
      complete: true,
      naturalWidth: 1000,
      naturalHeight: 500,
    } as HTMLImageElement;

    drawBackgroundLayer(ctx, { width: 300, height: 300 }, backgroundImage);

    expect(drawImage).toHaveBeenCalledWith(backgroundImage, -150, 0, 600, 300);
  });

  it('draws a ready background video with cover sizing', () => {
    const drawImage = vi.fn();
    const ctx = {
      clearRect: vi.fn(),
      drawImage,
      createLinearGradient: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const backgroundVideo = document.createElement('video');

    Object.defineProperty(backgroundVideo, 'readyState', {
      configurable: true,
      value: HTMLMediaElement.HAVE_CURRENT_DATA,
    });
    Object.defineProperty(backgroundVideo, 'videoWidth', {
      configurable: true,
      value: 1920,
    });
    Object.defineProperty(backgroundVideo, 'videoHeight', {
      configurable: true,
      value: 1080,
    });

    drawBackgroundLayer(ctx, { width: 300, height: 300 }, backgroundVideo);

    expect(drawImage).toHaveBeenCalledWith(
      backgroundVideo,
      expect.closeTo(-116.66666666666667, 10),
      0,
      expect.closeTo(533.3333333333334, 10),
      300
    );
  });

  it('draws the background image with cover sizing on a taller stage', () => {
    const drawImage = vi.fn();
    const ctx = {
      clearRect: vi.fn(),
      drawImage,
      createLinearGradient: vi.fn(),
      fillRect: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const backgroundImage = {
      complete: true,
      naturalWidth: 500,
      naturalHeight: 1000,
    } as HTMLImageElement;

    drawBackgroundLayer(ctx, { width: 300, height: 300 }, backgroundImage);

    expect(drawImage).toHaveBeenCalledWith(backgroundImage, 0, -150, 300, 600);
  });

  it('can copy arm pixels from the already matted stage foreground', () => {
    const { calls, ctx } = createArmLayerContext();
    const sourceCanvas = document.createElement('canvas');
    const stageSize = { width: 100, height: 100 };

    drawArmOcclusionLayer({
      ctx,
      coverLayout: {
        offsetX: 10,
        offsetY: 0,
        width: 80,
        height: 100,
      },
      stageSize,
      source: sourceCanvas,
      sourceSpace: 'stage',
      poseFrame: createPoseFrameWithForearm(),
    });

    expect(calls.find((call) => call.name === 'drawImage')?.args).toEqual([
      sourceCanvas,
      0,
      0,
      stageSize.width,
      stageSize.height,
    ]);
    expect(calls.some((call) => call.name === 'scale')).toBe(false);
    expect(calls.find((call) => call.name === 'moveTo')?.args).toEqual([70, 40]);
    expect(calls.find((call) => call.name === 'lineTo')?.args).toEqual([50, expect.closeTo(55, 10)]);
  });
});
