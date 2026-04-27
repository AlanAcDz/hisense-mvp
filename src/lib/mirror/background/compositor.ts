import {
  BACKGROUND_MASK_ALPHA_CURVE,
  BACKGROUND_MASK_DILATION_RADIUS,
  BACKGROUND_MASK_DRAW_BLUR_PX,
  BACKGROUND_MASK_FEATHER_PASSES,
  BACKGROUND_MASK_JOINT_BILATERAL_EDGE_THRESHOLD,
  BACKGROUND_MASK_JOINT_BILATERAL_ENABLED,
  BACKGROUND_MASK_JOINT_BILATERAL_RADIUS,
  BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_COLOR,
  BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_SPATIAL,
  BACKGROUND_MASK_MIN_COVERAGE,
  BACKGROUND_MASK_STAY_THRESHOLD,
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

interface JointBilateralFilterOptions {
  edgeThreshold?: number;
  radius?: number;
  sigmaColor?: number;
  sigmaSpatial?: number;
}

const colorWeightCache = new Map<number, Float32Array>();

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function getColorWeightLookup(sigmaColor: number) {
  const cacheKey = Math.round(sigmaColor * 1000);
  const cached = colorWeightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const maxColorDistanceSquared = 255 * 255 * 3;
  const colorWeights = new Float32Array(maxColorDistanceSquared + 1);
  const colorDenominator = 2 * sigmaColor * sigmaColor;
  for (let distanceSquared = 0; distanceSquared <= maxColorDistanceSquared; distanceSquared += 1) {
    colorWeights[distanceSquared] = Math.exp(-distanceSquared / colorDenominator);
  }

  colorWeightCache.set(cacheKey, colorWeights);
  return colorWeights;
}

function isLikelyMatteEdge(
  alpha: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
  edgeThreshold: number
) {
  const index = y * width + x;
  const centerAlpha = alpha[index] ?? 0;
  if (centerAlpha > edgeThreshold && centerAlpha < 1 - edgeThreshold) {
    return true;
  }

  const left = x > 0 ? alpha[index - 1] ?? centerAlpha : centerAlpha;
  const right = x < width - 1 ? alpha[index + 1] ?? centerAlpha : centerAlpha;
  const top = y > 0 ? alpha[index - width] ?? centerAlpha : centerAlpha;
  const bottom = y < height - 1 ? alpha[index + width] ?? centerAlpha : centerAlpha;

  return (
    Math.abs(centerAlpha - left) > edgeThreshold ||
    Math.abs(centerAlpha - right) > edgeThreshold ||
    Math.abs(centerAlpha - top) > edgeThreshold ||
    Math.abs(centerAlpha - bottom) > edgeThreshold
  );
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

function hasNumericProperty<Value extends string>(
  value: unknown,
  property: Value
): value is Record<Value, number> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[property] === 'number';
}

function hasBooleanProperty<Value extends string>(
  value: unknown,
  property: Value
): value is Record<Value, boolean> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return typeof (value as Record<string, unknown>)[property] === 'boolean';
}

function getRenderableSourceSize(source: CanvasImageSource | null) {
  if (!source) {
    return null;
  }

  if (hasNumericProperty(source, 'videoWidth') && hasNumericProperty(source, 'videoHeight')) {
    if (
      (hasNumericProperty(source, 'readyState')
        ? source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        : false) ||
      source.videoWidth <= 0
    ) {
      return null;
    }

    return {
      width: source.videoWidth,
      height: source.videoHeight,
    };
  }

  if (
    hasNumericProperty(source, 'naturalWidth') &&
    hasNumericProperty(source, 'naturalHeight') &&
    hasBooleanProperty(source, 'complete')
  ) {
    if (!source.complete || source.naturalWidth <= 0) {
      return null;
    }

    return {
      width: source.naturalWidth,
      height: source.naturalHeight,
    };
  }

  if (hasNumericProperty(source, 'width') && hasNumericProperty(source, 'height')) {
    if (source.width <= 0 || source.height <= 0) {
      return null;
    }

    return {
      width: source.width,
      height: source.height,
    };
  }

  return null;
}

export function copySegmentationAlpha(
  segmentationFrame: SegmentationFrame,
  threshold = BACKGROUND_MASK_THRESHOLD,
  alphaCurve = BACKGROUND_MASK_ALPHA_CURVE,
  previousAlpha?: Uint8ClampedArray | null,
  stayThreshold = BACKGROUND_MASK_STAY_THRESHOLD
) {
  const alpha = new Uint8ClampedArray(segmentationFrame.alpha.length);
  const canUsePreviousAlpha = previousAlpha?.length === segmentationFrame.alpha.length;

  for (let index = 0; index < segmentationFrame.alpha.length; index += 1) {
    const wasForeground = canUsePreviousAlpha && (previousAlpha?.[index] ?? 0) >= 64;
    const activeThreshold = wasForeground ? stayThreshold : threshold;
    const rawConfidence = segmentationFrame.alpha[index] ?? 0;
    const confidence = clamp01(
      (rawConfidence - activeThreshold) / (1 - activeThreshold)
    );
    const curvedAlpha = Math.pow(confidence, alphaCurve) * 255;
    alpha[index] = Math.round(
      wasForeground && rawConfidence >= stayThreshold
        ? Math.max(curvedAlpha, previousAlpha?.[index] ?? 0)
        : curvedAlpha
    );
  }

  return alpha;
}

export function applyJointBilateralFilter(
  alpha: Float32Array,
  width: number,
  height: number,
  guideRgba: Uint8ClampedArray | undefined,
  {
    edgeThreshold = BACKGROUND_MASK_JOINT_BILATERAL_EDGE_THRESHOLD,
    radius = BACKGROUND_MASK_JOINT_BILATERAL_RADIUS,
    sigmaColor = BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_COLOR,
    sigmaSpatial = BACKGROUND_MASK_JOINT_BILATERAL_SIGMA_SPATIAL,
  }: JointBilateralFilterOptions = {}
) {
  const filterRadius = Math.floor(radius);
  if (
    filterRadius <= 0 ||
    !guideRgba ||
    guideRgba.length !== width * height * 4 ||
    alpha.length !== width * height
  ) {
    return new Float32Array(alpha);
  }

  const refined = new Float32Array(alpha.length);
  const colorWeights = getColorWeightLookup(sigmaColor);
  const offsets: Array<{ dx: number; dy: number; spatialWeight: number }> = [];
  const spatialDenominator = 2 * sigmaSpatial * sigmaSpatial;

  for (let dy = -filterRadius; dy <= filterRadius; dy += 1) {
    for (let dx = -filterRadius; dx <= filterRadius; dx += 1) {
      if (dx * dx + dy * dy > filterRadius * filterRadius) {
        continue;
      }

      offsets.push({
        dx,
        dy,
        spatialWeight: Math.exp(-(dx * dx + dy * dy) / spatialDenominator),
      });
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const centerAlpha = alpha[index] ?? 0;

      if (!isLikelyMatteEdge(alpha, width, height, x, y, edgeThreshold)) {
        refined[index] = centerAlpha;
        continue;
      }

      const centerRgbaOffset = index * 4;
      const centerRed = guideRgba[centerRgbaOffset] ?? 0;
      const centerGreen = guideRgba[centerRgbaOffset + 1] ?? 0;
      const centerBlue = guideRgba[centerRgbaOffset + 2] ?? 0;
      let weightedAlpha = 0;
      let totalWeight = 0;

      for (const { dx, dy, spatialWeight } of offsets) {
        const sampleX = x + dx;
        const sampleY = y + dy;
        if (sampleX < 0 || sampleX >= width || sampleY < 0 || sampleY >= height) {
          continue;
        }

        const sampleIndex = sampleY * width + sampleX;
        const sampleRgbaOffset = sampleIndex * 4;
        const redDistance = centerRed - (guideRgba[sampleRgbaOffset] ?? 0);
        const greenDistance = centerGreen - (guideRgba[sampleRgbaOffset + 1] ?? 0);
        const blueDistance = centerBlue - (guideRgba[sampleRgbaOffset + 2] ?? 0);
        const colorDistanceSquared =
          redDistance * redDistance +
          greenDistance * greenDistance +
          blueDistance * blueDistance;
        const weight = spatialWeight * (colorWeights[colorDistanceSquared] ?? 0);

        weightedAlpha += (alpha[sampleIndex] ?? 0) * weight;
        totalWeight += weight;
      }

      refined[index] = totalWeight > 0 ? weightedAlpha / totalWeight : centerAlpha;
    }
  }

  return refined;
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
        const index = y * width + x;
        let total = 0;
        let samples = 0;
        let minAlpha = 255;
        let maxAlpha = 0;

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

            const sampleAlpha = current[sampleY * width + sampleX] ?? 0;
            total += sampleAlpha;
            samples += 1;
            minAlpha = Math.min(minAlpha, sampleAlpha);
            maxAlpha = Math.max(maxAlpha, sampleAlpha);
          }
        }

        const currentAlpha = current[index] ?? 0;
        const averageAlpha = Math.round(total / Math.max(samples, 1));
        const isEdgePixel = minAlpha < 240 && maxAlpha > 16;
        next[index] = isEdgePixel
          ? Math.round(currentAlpha * 0.45 + averageAlpha * 0.55)
          : currentAlpha;
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

export function createBackgroundMatte(
  segmentationFrame: SegmentationFrame,
  previousMatte?: BackgroundMatte | null
): BackgroundMatte {
  const segmentationAlpha =
    BACKGROUND_MASK_JOINT_BILATERAL_ENABLED
      ? applyJointBilateralFilter(
          segmentationFrame.alpha,
          segmentationFrame.width,
          segmentationFrame.height,
          segmentationFrame.guideRgba
        )
      : segmentationFrame.alpha;
  const refinedSegmentationFrame = {
    ...segmentationFrame,
    alpha: segmentationAlpha,
  };
  const previousAlpha =
    previousMatte?.width === segmentationFrame.width && previousMatte.height === segmentationFrame.height
      ? previousMatte.alpha
      : null;
  const copiedAlpha = copySegmentationAlpha(refinedSegmentationFrame, undefined, undefined, previousAlpha);
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

    const nextMatte = createBackgroundMatte(segmentationFrame, previousMatte);
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
  backgroundSource: CanvasImageSource | null
) {
  ctx.clearRect(0, 0, stageSize.width, stageSize.height);

  const sourceSize = getRenderableSourceSize(backgroundSource);

  if (backgroundSource && sourceSize) {
    const coverLayout = getCoverLayoutForSource(
      sourceSize.width,
      sourceSize.height,
      stageSize
    );

    ctx.drawImage(
      backgroundSource,
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
