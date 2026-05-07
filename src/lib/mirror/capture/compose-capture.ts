import type { CaptureCompositionOptions } from '@/lib/mirror/types';

export function drawCaptureLayers(
  ctx: CanvasRenderingContext2D,
  options: CaptureCompositionOptions
) {
  const {
    backgroundCanvas,
    foregroundCanvas,
    poseCanvas,
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
