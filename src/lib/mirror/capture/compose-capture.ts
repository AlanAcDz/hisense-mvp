import { getCoverLayout } from '@/lib/mirror/pose/torso';
import type { CaptureCompositionOptions } from '@/lib/mirror/types';

export function composeCaptureFrame(options: CaptureCompositionOptions) {
  const {
    videoElement,
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

  const coverLayout = getCoverLayout(
    {
      width: videoElement.videoWidth,
      height: videoElement.videoHeight,
    },
    {
      width: outputWidth,
      height: outputHeight,
    }
  );

  ctx.save();
  ctx.translate(outputWidth, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(videoElement, coverLayout.offsetX, coverLayout.offsetY, coverLayout.width, coverLayout.height);
  ctx.drawImage(rendererCanvas, 0, 0, outputWidth, outputHeight);
  if (showPosePoints && poseCanvas) {
    ctx.drawImage(poseCanvas, 0, 0, outputWidth, outputHeight);
  }
  ctx.restore();

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
