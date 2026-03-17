import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import { DETECTION_INTERVAL_MS, POSE_CONFIDENCE } from '@/lib/mirror/constants';
import { createPoseFrame } from '@/lib/mirror/pose/torso';
import type {
  LandmarkerFrame,
  PoseLandmark2D,
  PoseLandmark3D,
  SegmentationFrame,
} from '@/lib/mirror/types';

const MEDIAPIPE_WASM_URL =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.32/wasm';
const POSE_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task';

let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;
let poseLandmarkerInstance: PoseLandmarker | null = null;

async function loadPoseLandmarker() {
  if (poseLandmarkerInstance) {
    return poseLandmarkerInstance;
  }

  if (!poseLandmarkerPromise) {
    poseLandmarkerPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
      poseLandmarkerInstance = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: POSE_MODEL_URL,
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        outputSegmentationMasks: true,
        ...POSE_CONFIDENCE,
      });
      return poseLandmarkerInstance;
    })();
  }

  return poseLandmarkerPromise;
}

function mapPoseLandmarks(landmarks: PoseLandmark2D[] | undefined) {
  return (
    landmarks?.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility,
    })) ?? []
  );
}

function mapWorldLandmarks(landmarks: PoseLandmark3D[] | undefined) {
  return (
    landmarks?.map((landmark) => ({
      x: landmark.x,
      y: landmark.y,
      z: landmark.z,
      visibility: landmark.visibility,
    })) ?? []
  );
}

function copySegmentationFrame(
  segmentationMasks: { width: number; height: number; getAsFloat32Array(): Float32Array }[] | undefined,
  timestamp: number
): SegmentationFrame | null {
  const firstMask = segmentationMasks?.[0];
  if (!firstMask) {
    return null;
  }

  return {
    width: firstMask.width,
    height: firstMask.height,
    alpha: Float32Array.from(firstMask.getAsFloat32Array()),
    timestamp,
  };
}

export function usePoseLandmarker() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frame, setFrame] = useState<LandmarkerFrame>({
    poseFrame: null,
    segmentationFrame: null,
  });
  const frameRef = useRef<LandmarkerFrame>({
    poseFrame: null,
    segmentationFrame: null,
  });

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setIsLoading(true);
      setError(null);

      try {
        await loadPoseLandmarker();
        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : 'Unable to load pose model.');
          setIsLoading(false);
        }
      }
    }

    void initialize();

    return () => {
      cancelled = true;
    };
  }, []);

  const detectFrame = useCallback(
    (
      videoElement: HTMLVideoElement,
      now: number,
      lastDetectedAtRef: { current: number }
    ) => {
      if (!poseLandmarkerInstance || now - lastDetectedAtRef.current < DETECTION_INTERVAL_MS) {
        return frameRef.current;
      }

      if (videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return frameRef.current;
      }

      lastDetectedAtRef.current = now;

      try {
        const result = poseLandmarkerInstance.detectForVideo(videoElement, now);
        const nextPoseFrame = createPoseFrame(
          mapPoseLandmarks(result.landmarks[0] as PoseLandmark2D[] | undefined),
          mapWorldLandmarks(result.worldLandmarks[0] as PoseLandmark3D[] | undefined),
          now
        );
        const nextSegmentationFrame = copySegmentationFrame(
          result.segmentationMasks as
            | { width: number; height: number; getAsFloat32Array(): Float32Array }[]
            | undefined,
          now
        );

        result.close();

        const nextFrame = {
          poseFrame: nextPoseFrame,
          segmentationFrame: nextSegmentationFrame,
        } satisfies LandmarkerFrame;

        frameRef.current = nextFrame;
        setFrame(nextFrame);
        return nextFrame;
      } catch (detectError) {
        const message =
          detectError instanceof Error ? detectError.message : 'Pose tracking failed during rendering.';
        setError(message);
        return frameRef.current;
      }
    },
    []
  );

  return {
    detectFrame,
    error,
    frame,
    isLoading,
  };
}
