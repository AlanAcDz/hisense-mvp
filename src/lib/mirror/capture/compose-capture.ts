import type { CaptureCompositionOptions } from '@/lib/mirror/types';

function getScratchContext(
  scratchCanvas: HTMLCanvasElement | null | undefined,
  width: number,
  height: number
) {
  const canvas = scratchCanvas ?? document.createElement('canvas');
  if (canvas.width !== width) {
    canvas.width = width;
  }
  if (canvas.height !== height) {
    canvas.height = height;
  }

  return canvas.getContext('2d');
}

function drawRendererLayer(
  ctx: CanvasRenderingContext2D,
  {
    rendererCanvas,
    shirtCutoutMaskCanvas,
    scratchCanvas,
    outputWidth,
    outputHeight,
  }: Pick<
    CaptureCompositionOptions,
    'rendererCanvas' | 'shirtCutoutMaskCanvas' | 'scratchCanvas' | 'outputWidth' | 'outputHeight'
  >
) {
  if (!shirtCutoutMaskCanvas) {
    ctx.drawImage(rendererCanvas, 0, 0, outputWidth, outputHeight);
    return;
  }

  const scratchContext = getScratchContext(scratchCanvas, outputWidth, outputHeight);
  if (!scratchContext) {
    ctx.drawImage(rendererCanvas, 0, 0, outputWidth, outputHeight);
    return;
  }

  scratchContext.clearRect(0, 0, outputWidth, outputHeight);
  scratchContext.drawImage(rendererCanvas, 0, 0, outputWidth, outputHeight);
  scratchContext.save();
  scratchContext.globalCompositeOperation = 'destination-out';
  scratchContext.drawImage(shirtCutoutMaskCanvas, 0, 0, outputWidth, outputHeight);
  scratchContext.restore();
  scratchContext.globalCompositeOperation = 'source-over';

  ctx.drawImage(scratchContext.canvas, 0, 0, outputWidth, outputHeight);
}

export function drawCaptureLayers(
  ctx: CanvasRenderingContext2D,
  options: CaptureCompositionOptions
) {
  const {
    backgroundCanvas,
    foregroundCanvas,
    rendererCanvas,
    shirtCutoutMaskCanvas,
    armOverlayCanvas,
    poseCanvas,
    scratchCanvas,
    outputWidth,
    outputHeight,
    showPosePoints,
  } = options;

  ctx.clearRect(0, 0, outputWidth, outputHeight);

  if (backgroundCanvas) {
    ctx.drawImage(backgroundCanvas, 0, 0, outputWidth, outputHeight);
  }

  if (foregroundCanvas) {
    ctx.drawImage(foregroundCanvas, 0, 0, outputWidth, outputHeight);
  }

  drawRendererLayer(ctx, {
    rendererCanvas,
    shirtCutoutMaskCanvas,
    scratchCanvas,
    outputWidth,
    outputHeight,
  });

  if (armOverlayCanvas) {
    ctx.drawImage(armOverlayCanvas, 0, 0, outputWidth, outputHeight);
  }

  if (showPosePoints && poseCanvas) {
    ctx.drawImage(poseCanvas, 0, 0, outputWidth, outputHeight);
  }
}

export function composeCaptureFrame(options: CaptureCompositionOptions) {
  const canvas = document.createElement('canvas');
  canvas.width = options.outputWidth;
  canvas.height = options.outputHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create capture canvas.');
  }

  drawCaptureLayers(ctx, options);

  return canvas.toDataURL('image/jpeg', 0.95);
}

export function downloadDataUrl(dataUrl: string, filename: string) {
  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}
