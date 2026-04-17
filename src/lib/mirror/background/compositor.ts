import {
  BACKGROUND_MASK_ALPHA_CURVE,
  BACKGROUND_MASK_DILATION_RADIUS,
  BACKGROUND_MASK_DRAW_BLUR_PX,
  BACKGROUND_MASK_FEATHER_PASSES,
  BACKGROUND_MASK_MIN_COVERAGE,
  BACKGROUND_MASK_STALE_MS,
  BACKGROUND_MASK_THRESHOLD,
} from '@/lib/mirror/constants';
import type { BackgroundMatte, CoverLayout, SegmentationFrame, StageSize } from '@/lib/mirror/types';

interface BackgroundMatteResolution {
  matte: BackgroundMatte | null;
  reusedPrevious: boolean;
}

interface ResolveBackgroundMatteOptions {
  segmentationFrame: SegmentationFrame | null;
  previousMatte: BackgroundMatte | null;
  now: number;
  staleAfterMs?: number;
  minCoverage?: number;
}

interface DrawForegroundLayerOptions {
  ctx: CanvasRenderingContext2D;
  coverLayout: CoverLayout;
  stageSize: StageSize;
  source: CanvasImageSource;
  maskCanvas?: HTMLCanvasElement | null;
  mirror?: boolean;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getCoverLayoutForSource(
  sourceWidth: number,
  sourceHeight: number,
  stageSize: StageSize
): CoverLayout {
  const sourceAspect = sourceWidth / sourceHeight;
  const stageAspect = stageSize.width / stageSize.height;

  if (sourceAspect > stageAspect) {
    const height = stageSize.height;
    const width = height * sourceAspect;

    return {
      width,
      height,
      offsetX: (stageSize.width - width) / 2,
      offsetY: 0,
    };
  }

  const width = stageSize.width;
  const height = width / sourceAspect;

  return {
    width,
    height,
    offsetX: 0,
    offsetY: (stageSize.height - height) / 2,
  };
}

export function copySegmentationAlpha(
  segmentationFrame: SegmentationFrame,
  threshold = BACKGROUND_MASK_THRESHOLD,
  alphaCurve = BACKGROUND_MASK_ALPHA_CURVE
) {
  const alpha = new Uint8ClampedArray(segmentationFrame.alpha.length);
  for (let index = 0; index < segmentationFrame.alpha.length; index += 1) {
    const confidence = clamp01((segmentationFrame.alpha[index] - threshold) / (1 - threshold));
    alpha[index] = Math.round(Math.pow(confidence, alphaCurve) * 255);
  }
  return alpha;
}

export function dilateAlphaMask(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  radius = BACKGROUND_MASK_DILATION_RADIUS
) {
  if (radius <= 0) {
    return new Uint8ClampedArray(alpha);
  }

  const dilated = new Uint8ClampedArray(alpha.length);
  const maxOffset = Math.ceil(radius);
  const radiusSquared = radius * radius;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let maxAlpha = 0;

      for (let offsetY = -maxOffset; offsetY <= maxOffset; offsetY += 1) {
        const sampleY = y + offsetY;
        if (sampleY < 0 || sampleY >= height) {
          continue;
        }

        for (let offsetX = -maxOffset; offsetX <= maxOffset; offsetX += 1) {
          const sampleX = x + offsetX;
          if (sampleX < 0 || sampleX >= width) {
            continue;
          }

          if (offsetX * offsetX + offsetY * offsetY > radiusSquared) {
            continue;
          }

          maxAlpha = Math.max(maxAlpha, alpha[sampleY * width + sampleX] ?? 0);
        }
      }

      dilated[y * width + x] = maxAlpha;
    }
  }

  return dilated;
}

export function featherAlphaMask(
  alpha: Uint8ClampedArray,
  width: number,
  height: number,
  passes = BACKGROUND_MASK_FEATHER_PASSES
) {
  let current = new Uint8ClampedArray(alpha);

  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Uint8ClampedArray(current.length);

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let total = 0;
        let samples = 0;

        for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
          const sampleY = y + offsetY;
          if (sampleY < 0 || sampleY >= height) {
            continue;
          }

          for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
            const sampleX = x + offsetX;
            if (sampleX < 0 || sampleX >= width) {
              continue;
            }

            total += current[sampleY * width + sampleX] ?? 0;
            samples += 1;
          }
        }

        next[y * width + x] = Math.round(total / Math.max(samples, 1));
      }
    }

    current = next;
  }

  return current;
}

export function computeMaskCoverage(alpha: Uint8ClampedArray) {
  let solidPixels = 0;

  for (let index = 0; index < alpha.length; index += 1) {
    if ((alpha[index] ?? 0) >= 64) {
      solidPixels += 1;
    }
  }

  return solidPixels / Math.max(alpha.length, 1);
}

export function createBackgroundMatte(segmentationFrame: SegmentationFrame): BackgroundMatte {
  const copiedAlpha = copySegmentationAlpha(segmentationFrame);
  const dilatedAlpha = dilateAlphaMask(
    copiedAlpha,
    segmentationFrame.width,
    segmentationFrame.height
  );
  const featheredAlpha = featherAlphaMask(
    dilatedAlpha,
    segmentationFrame.width,
    segmentationFrame.height
  );

  return {
    width: segmentationFrame.width,
    height: segmentationFrame.height,
    alpha: featheredAlpha,
    coverage: computeMaskCoverage(featheredAlpha),
    timestamp: segmentationFrame.timestamp,
  };
}

export function resolveBackgroundMatte({
  segmentationFrame,
  previousMatte,
  now,
  staleAfterMs = BACKGROUND_MASK_STALE_MS,
  minCoverage = BACKGROUND_MASK_MIN_COVERAGE,
}: ResolveBackgroundMatteOptions): BackgroundMatteResolution {
  const hasFreshSegmentationFrame =
    Boolean(segmentationFrame) &&
    now - (segmentationFrame?.timestamp ?? 0) <= staleAfterMs;

  if (hasFreshSegmentationFrame && segmentationFrame) {
    if (previousMatte && previousMatte.timestamp === segmentationFrame.timestamp) {
      return {
        matte: previousMatte,
        reusedPrevious: false,
      };
    }

    const nextMatte = createBackgroundMatte(segmentationFrame);
    if (nextMatte.coverage >= minCoverage) {
      return {
        matte: nextMatte,
        reusedPrevious: false,
      };
    }
  }

  if (previousMatte && now - previousMatte.timestamp <= staleAfterMs) {
    return {
      matte: previousMatte,
      reusedPrevious: true,
    };
  }

  return {
    matte: null,
    reusedPrevious: false,
  };
}

export function syncMatteCanvas(
  canvas: HTMLCanvasElement,
  matte: BackgroundMatte
) {
  canvas.width = matte.width;
  canvas.height = matte.height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }

  const imageData = ctx.createImageData(matte.width, matte.height);
  for (let index = 0; index < matte.alpha.length; index += 1) {
    const pixelOffset = index * 4;
    imageData.data[pixelOffset] = 255;
    imageData.data[pixelOffset + 1] = 255;
    imageData.data[pixelOffset + 2] = 255;
    imageData.data[pixelOffset + 3] = matte.alpha[index] ?? 0;
  }

  ctx.putImageData(imageData, 0, 0);
}

export function drawBackgroundLayer(
  ctx: CanvasRenderingContext2D,
  stageSize: StageSize,
  backgroundImage: HTMLImageElement | null
) {
  ctx.clearRect(0, 0, stageSize.width, stageSize.height);

  if (backgroundImage?.complete && backgroundImage.naturalWidth > 0) {
    const coverLayout = getCoverLayoutForSource(
      backgroundImage.naturalWidth,
      backgroundImage.naturalHeight,
      stageSize
    );

    ctx.drawImage(
      backgroundImage,
      coverLayout.offsetX,
      coverLayout.offsetY,
      coverLayout.width,
      coverLayout.height
    );
    return;
  }

  const gradient = ctx.createLinearGradient(0, 0, 0, stageSize.height);
  gradient.addColorStop(0, '#0d395e');
  gradient.addColorStop(0.55, '#06223b');
  gradient.addColorStop(1, '#01060d');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, stageSize.width, stageSize.height);
}

export function drawForegroundLayer({
  ctx,
  coverLayout,
  stageSize,
  source,
  maskCanvas,
  mirror = true,
}: DrawForegroundLayerOptions) {
  ctx.clearRect(0, 0, stageSize.width, stageSize.height);

  ctx.save();
  if (mirror) {
    ctx.translate(stageSize.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, coverLayout.offsetX, coverLayout.offsetY, coverLayout.width, coverLayout.height);
  ctx.restore();

  if (!maskCanvas) {
    return;
  }

  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  if (BACKGROUND_MASK_DRAW_BLUR_PX > 0) {
    ctx.filter = `blur(${BACKGROUND_MASK_DRAW_BLUR_PX}px)`;
  }
  if (mirror) {
    ctx.translate(stageSize.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    maskCanvas,
    coverLayout.offsetX,
    coverLayout.offsetY,
    coverLayout.width,
    coverLayout.height
  );
  ctx.restore();
  ctx.globalCompositeOperation = 'source-over';
}

export function getBackgroundGuidance(
  hasTorso: boolean,
  hasSegmentation: boolean,
  reusedCachedMatte: boolean
) {
  if (!hasTorso) {
    return 'Step back and keep your shoulders and hips visible.';
  }

  if (!hasSegmentation) {
    return 'Center your body in frame and improve lighting.';
  }

  if (reusedCachedMatte) {
    return 'Hold still while the background lock stabilizes.';
  }

  return 'Improve lighting and keep your full body clear in frame.';
}
