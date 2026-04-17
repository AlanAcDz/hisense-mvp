import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  DETECTION_INPUT_LONG_EDGE_PX,
  DETECTION_INTERVAL_MS,
  POSE_CONFIDENCE,
} from '@/lib/mirror/constants';
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
  'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task';

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

function getDetectionScale(videoWidth: number, videoHeight: number) {
  const longEdge = Math.max(videoWidth, videoHeight);
  if (!longEdge || longEdge <= DETECTION_INPUT_LONG_EDGE_PX) {
    return 1;
  }

  return DETECTION_INPUT_LONG_EDGE_PX / longEdge;
}

export function usePoseLandmarker() {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<LandmarkerFrame>({
    poseFrame: null,
    segmentationFrame: null,
  });
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null);

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
        const detectionScale = getDetectionScale(videoElement.videoWidth, videoElement.videoHeight);
        let detectionSource: CanvasImageSource = videoElement;

        if (detectionScale < 1) {
          const detectionWidth = Math.max(1, Math.round(videoElement.videoWidth * detectionScale));
          const detectionHeight = Math.max(1, Math.round(videoElement.videoHeight * detectionScale));

          if (!detectionCanvasRef.current) {
            detectionCanvasRef.current = document.createElement('canvas');
          }

          const detectionCanvas = detectionCanvasRef.current;
          if (detectionCanvas.width !== detectionWidth || detectionCanvas.height !== detectionHeight) {
            detectionCanvas.width = detectionWidth;
            detectionCanvas.height = detectionHeight;
            detectionCanvasContextRef.current = null;
          }

          let detectionContext = detectionCanvasContextRef.current;
          if (!detectionContext) {
            detectionContext =
              detectionCanvas.getContext('2d', { alpha: false, desynchronized: true }) ??
              detectionCanvas.getContext('2d');
            detectionCanvasContextRef.current = detectionContext;
          }

          if (detectionContext) {
            detectionContext.drawImage(videoElement, 0, 0, detectionWidth, detectionHeight);
            detectionSource = detectionCanvas;
          }
        }

        let nextFrame = frameRef.current;

        poseLandmarkerInstance.detectForVideo(detectionSource, now, (result) => {
          nextFrame = {
            poseFrame: createPoseFrame(
              mapPoseLandmarks(result.landmarks[0] as PoseLandmark2D[] | undefined),
              mapWorldLandmarks(result.worldLandmarks[0] as PoseLandmark3D[] | undefined),
              now
            ),
            segmentationFrame: copySegmentationFrame(
              result.segmentationMasks as
                | { width: number; height: number; getAsFloat32Array(): Float32Array }[]
                | undefined,
              now
            ),
          } satisfies LandmarkerFrame;
        });

        frameRef.current = nextFrame;
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
    isLoading,
  };
}
