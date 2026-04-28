import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  BACKGROUND_MASK_JOINT_BILATERAL_ENABLED,
  type DetectionInputLongEdgePx,
  DETECTION_INPUT_LONG_EDGE_PX,
  DETECTION_INTERVAL_MS,
  MEDIAPIPE_WASM_URL,
  POSE_CONFIDENCE,
  type PoseModelVariant,
  POSE_MODEL_VARIANT,
  POSE_USE_GPU_DELEGATE,
  getPoseModelUrl,
} from '@/lib/mirror/constants';
import { createPoseFrame } from '@/lib/mirror/pose/torso';
import type {
  LandmarkerFrame,
  PoseLandmark2D,
  PoseLandmark3D,
  SegmentationFrame,
} from '@/lib/mirror/types';

let poseLandmarkerPromise: Promise<PoseLandmarker> | null = null;
let poseLandmarkerInstance: PoseLandmarker | null = null;
let poseLandmarkerDelegate: 'CPU' | 'GPU' | null = null;
let poseLandmarkerModelVariant: PoseModelVariant | null = null;
let poseLandmarkerLoadId = 0;
let gpuDelegateCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;

const GPU_SEGMENTATION_FAILURE_LIMIT = 3;
const GPU_SEGMENTATION_EMPTY_MAX_CONFIDENCE = 0.001;

export interface PoseLandmarkerOptions {
  modelVariant?: PoseModelVariant;
  inputLongEdgePx?: DetectionInputLongEdgePx;
}

function getGpuDelegateCanvas() {
  if (gpuDelegateCanvas) {
    return gpuDelegateCanvas;
  }

  if (typeof OffscreenCanvas !== 'undefined') {
    gpuDelegateCanvas = new OffscreenCanvas(1, 1);
    return gpuDelegateCanvas;
  }

  if (typeof document !== 'undefined') {
    gpuDelegateCanvas = document.createElement('canvas');
    return gpuDelegateCanvas;
  }

  return null;
}

async function createPoseLandmarker(delegate: 'CPU' | 'GPU', modelVariant: PoseModelVariant) {
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_URL);
  const delegateCanvas = delegate === 'GPU' ? getGpuDelegateCanvas() : null;

  return PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: getPoseModelUrl(modelVariant),
      ...(delegate === 'GPU' ? { delegate: 'GPU' as const } : {}),
    },
    ...(delegateCanvas ? { canvas: delegateCanvas } : {}),
    runningMode: 'VIDEO',
    numPoses: 1,
    outputSegmentationMasks: true,
    ...POSE_CONFIDENCE,
  });
}

function disposePoseLandmarker() {
  poseLandmarkerLoadId += 1;
  poseLandmarkerInstance?.close();
  poseLandmarkerInstance = null;
  poseLandmarkerPromise = null;
  poseLandmarkerDelegate = null;
  poseLandmarkerModelVariant = null;
}

async function replacePoseLandmarker(delegate: 'CPU' | 'GPU', modelVariant: PoseModelVariant) {
  disposePoseLandmarker();
  const loadId = poseLandmarkerLoadId;
  const nextPoseLandmarker = await createPoseLandmarker(delegate, modelVariant);
  if (loadId !== poseLandmarkerLoadId) {
    nextPoseLandmarker.close();
    throw new Error('Pose model load was superseded.');
  }

  poseLandmarkerInstance = nextPoseLandmarker;
  poseLandmarkerDelegate = delegate;
  poseLandmarkerModelVariant = modelVariant;
  return poseLandmarkerInstance;
}

async function loadPoseLandmarker(modelVariant: PoseModelVariant) {
  if (poseLandmarkerInstance && poseLandmarkerModelVariant === modelVariant) {
    return poseLandmarkerInstance;
  }

  if (poseLandmarkerModelVariant !== modelVariant) {
    disposePoseLandmarker();
  }

  if (!poseLandmarkerPromise) {
    const loadId = poseLandmarkerLoadId;
    const applyPoseLandmarker = (
      landmarker: PoseLandmarker,
      delegate: 'CPU' | 'GPU'
    ) => {
      if (loadId !== poseLandmarkerLoadId) {
        landmarker.close();
        throw new Error('Pose model load was superseded.');
      }

      poseLandmarkerInstance = landmarker;
      poseLandmarkerDelegate = delegate;
      poseLandmarkerModelVariant = modelVariant;
      return poseLandmarkerInstance;
    };

    poseLandmarkerPromise = (async () => {
      if (POSE_USE_GPU_DELEGATE) {
        try {
          return applyPoseLandmarker(await createPoseLandmarker('GPU', modelVariant), 'GPU');
        } catch {
          gpuDelegateCanvas = null;
        }
      }

      return applyPoseLandmarker(await createPoseLandmarker('CPU', modelVariant), 'CPU');
    })().catch((error) => {
      if (loadId === poseLandmarkerLoadId) {
        disposePoseLandmarker();
      }
      throw error;
    });
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
  timestamp: number,
  guideRgba?: Uint8ClampedArray
): SegmentationFrame | null {
  const firstMask = segmentationMasks?.[0];
  if (!firstMask) {
    return null;
  }

  const validGuideRgba =
    guideRgba?.length === firstMask.width * firstMask.height * 4
      ? guideRgba
      : undefined;

  return {
    width: firstMask.width,
    height: firstMask.height,
    alpha: Float32Array.from(firstMask.getAsFloat32Array()),
    ...(validGuideRgba ? { guideRgba: validGuideRgba } : {}),
    timestamp,
  };
}

export function isSegmentationFrameLikelyEmpty(
  segmentationFrame: SegmentationFrame | null,
  maxConfidenceFloor = GPU_SEGMENTATION_EMPTY_MAX_CONFIDENCE
) {
  if (!segmentationFrame) {
    return true;
  }

  let maxConfidence = 0;
  for (let index = 0; index < segmentationFrame.alpha.length; index += 1) {
    maxConfidence = Math.max(maxConfidence, segmentationFrame.alpha[index] ?? 0);
    if (maxConfidence > maxConfidenceFloor) {
      return false;
    }
  }

  return true;
}

function getDetectionScale(videoWidth: number, videoHeight: number, inputLongEdgePx: number) {
  const longEdge = Math.max(videoWidth, videoHeight);
  if (!longEdge || longEdge <= inputLongEdgePx) {
    return 1;
  }

  return inputLongEdgePx / longEdge;
}

export function usePoseLandmarker({
  modelVariant = POSE_MODEL_VARIANT,
  inputLongEdgePx = DETECTION_INPUT_LONG_EDGE_PX,
}: PoseLandmarkerOptions = {}) {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const frameRef = useRef<LandmarkerFrame>({
    poseFrame: null,
    segmentationFrame: null,
  });
  const detectionCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const detectionCanvasContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const gpuSegmentationFailureCountRef = useRef(0);
  const fallbackInFlightRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function initialize() {
      setIsLoading(true);
      setError(null);

      try {
        await loadPoseLandmarker(modelVariant);
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
  }, [modelVariant]);

  const fallbackToCpuDelegate = useCallback(() => {
    if (fallbackInFlightRef.current || poseLandmarkerDelegate !== 'GPU') {
      return;
    }

    fallbackInFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    void replacePoseLandmarker('CPU', modelVariant)
      .then(() => {
        gpuSegmentationFailureCountRef.current = 0;
        setError(null);
      })
      .catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : 'Unable to load pose model.');
      })
      .finally(() => {
        fallbackInFlightRef.current = false;
        setIsLoading(false);
      });
  }, [modelVariant]);

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
        const detectionScale = getDetectionScale(
          videoElement.videoWidth,
          videoElement.videoHeight,
          inputLongEdgePx
        );
        const detectionWidth = Math.max(1, Math.round(videoElement.videoWidth * detectionScale));
        const detectionHeight = Math.max(1, Math.round(videoElement.videoHeight * detectionScale));
        const shouldUseDetectionCanvas =
          detectionScale < 1 || BACKGROUND_MASK_JOINT_BILATERAL_ENABLED;
        let detectionSource: CanvasImageSource = videoElement;
        let guideRgba: Uint8ClampedArray | undefined;

        if (shouldUseDetectionCanvas) {
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
              detectionCanvas.getContext('2d', {
                alpha: false,
                desynchronized: true,
                willReadFrequently: BACKGROUND_MASK_JOINT_BILATERAL_ENABLED,
              }) ??
              detectionCanvas.getContext('2d');
            detectionCanvasContextRef.current = detectionContext;
          }

          if (detectionContext) {
            detectionContext.drawImage(videoElement, 0, 0, detectionWidth, detectionHeight);
            detectionSource = detectionCanvas;

            if (BACKGROUND_MASK_JOINT_BILATERAL_ENABLED) {
              try {
                guideRgba = detectionContext.getImageData(0, 0, detectionWidth, detectionHeight).data;
              } catch {
                guideRgba = undefined;
              }
            }
          }
        }

        let nextFrame = frameRef.current;

        poseLandmarkerInstance.detectForVideo(detectionSource, now, (result) => {
          const segmentationFrame = copySegmentationFrame(
            result.segmentationMasks as
              | { width: number; height: number; getAsFloat32Array(): Float32Array }[]
              | undefined,
            now,
            guideRgba
          );
          const hasPoseLandmarks = Boolean(result.landmarks[0]?.length);

          if (poseLandmarkerDelegate === 'GPU') {
            gpuSegmentationFailureCountRef.current =
              hasPoseLandmarks && isSegmentationFrameLikelyEmpty(segmentationFrame)
                ? gpuSegmentationFailureCountRef.current + 1
                : 0;
          } else {
            gpuSegmentationFailureCountRef.current = 0;
          }

          nextFrame = {
            poseFrame: createPoseFrame(
              mapPoseLandmarks(result.landmarks[0] as PoseLandmark2D[] | undefined),
              mapWorldLandmarks(result.worldLandmarks[0] as PoseLandmark3D[] | undefined),
              now
            ),
            segmentationFrame,
          } satisfies LandmarkerFrame;
        });

        frameRef.current = nextFrame;

        if (gpuSegmentationFailureCountRef.current >= GPU_SEGMENTATION_FAILURE_LIMIT) {
          fallbackToCpuDelegate();
        }

        return nextFrame;
      } catch (detectError) {
        const message =
          detectError instanceof Error ? detectError.message : 'Pose tracking failed during rendering.';
        setError(message);
        return frameRef.current;
      }
    },
    [fallbackToCpuDelegate, inputLongEdgePx]
  );

  return {
    detectFrame,
    error,
    isLoading,
  };
}
