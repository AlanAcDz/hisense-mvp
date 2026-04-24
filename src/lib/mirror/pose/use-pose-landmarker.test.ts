import {
  MEDIAPIPE_WASM_URL,
  POSE_MODEL_URL,
} from '@/lib/mirror/constants';
import { isSegmentationFrameLikelyEmpty } from '@/lib/mirror/pose/use-pose-landmarker';
import type { SegmentationFrame } from '@/lib/mirror/types';

function createSegmentationFrame(values: number[], timestamp = 1000): SegmentationFrame {
  return {
    width: values.length,
    height: 1,
    alpha: Float32Array.from(values),
    timestamp,
  };
}

describe('usePoseLandmarker segmentation health', () => {
  it('uses vendored local MediaPipe runtime assets', () => {
    expect(MEDIAPIPE_WASM_URL).toMatch(/assets\/mediapipe\/wasm$/);
    expect(POSE_MODEL_URL).toMatch(/assets\/mediapipe\/models\/pose_landmarker_full\.task$/);
  });

  it('treats missing segmentation as unusable', () => {
    expect(isSegmentationFrameLikelyEmpty(null)).toBe(true);
  });

  it('treats all-zero segmentation as unusable', () => {
    expect(isSegmentationFrameLikelyEmpty(createSegmentationFrame([0, 0, 0]))).toBe(true);
  });

  it('accepts segmentation once any pixel rises above the empty floor', () => {
    expect(isSegmentationFrameLikelyEmpty(createSegmentationFrame([0, 0.002, 0]))).toBe(false);
  });
});
