import {
  copySegmentationAlpha,
  createBackgroundMatte,
  dilateAlphaMask,
  drawBackgroundLayer,
  resolveBackgroundMatte,
} from '@/lib/mirror/background/compositor';
import type { BackgroundMatte, SegmentationFrame } from '@/lib/mirror/types';

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

describe('background compositor', () => {
  it('copies segmentation confidence into a reusable alpha mask', () => {
    const segmentationFrame = createSegmentationFrame(
      4,
      1,
      new Float32Array([0.12, 0.48, 0.74, 1])
    );

    expect(Array.from(copySegmentationAlpha(segmentationFrame))).toEqual([0, 0, 141, 255]);
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
      timestamp: 950,
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
});
