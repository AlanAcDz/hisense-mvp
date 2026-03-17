import type { CaptureCompositionOptions } from '@/lib/mirror/types';

export function composeCaptureFrame(options: CaptureCompositionOptions) {
  const {
    backgroundCanvas,
    foregroundCanvas,
    rendererCanvas,
    poseCanvas,
    outputWidth,
    outputHeight,
    showPosePoints,
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Could not create capture canvas.');
  }

  if (backgroundCanvas) {
    ctx.drawImage(backgroundCanvas, 0, 0, outputWidth, outputHeight);
  }

  if (foregroundCanvas) {
    ctx.drawImage(foregroundCanvas, 0, 0, outputWidth, outputHeight);
  }

  ctx.drawImage(rendererCanvas, 0, 0, outputWidth, outputHeight);
  if (showPosePoints && poseCanvas) {
    ctx.drawImage(poseCanvas, 0, 0, outputWidth, outputHeight);
  }

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
