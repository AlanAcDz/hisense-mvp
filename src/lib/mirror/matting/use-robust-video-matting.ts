import { useCallback, useEffect, useRef, useState } from 'react';
import {
  VIDEO_MATTING_DOWNSAMPLE_RATIO,
  VIDEO_MATTING_INPUT_LONG_EDGE_PX,
  VIDEO_MATTING_INTERVAL_MS,
  VIDEO_MATTING_MODEL_URL,
} from '@/lib/mirror/constants';

type Tf = typeof import('@tensorflow/tfjs');
type GraphModel = import('@tensorflow/tfjs').GraphModel;
type Tensor = import('@tensorflow/tfjs').Tensor;
type Tensor3D = import('@tensorflow/tfjs').Tensor3D;

interface MattingInputSize {
  width: number;
  height: number;
}

export interface RobustVideoMattingOptions {
  enabled?: boolean;
  modelUrl?: string;
  inputLongEdgePx?: number;
  downsampleRatio?: number;
  intervalMs?: number;
}

export interface VideoMattingStats {
  fps: number;
  inferenceMs: number;
  inputWidth: number;
  inputHeight: number;
  backend: string | null;
}

export interface VideoMattingFrame {
  width: number;
  height: number;
  maskCanvas: HTMLCanvasElement;
  sourceCanvas: HTMLCanvasElement;
  timestamp: number;
}

let tfPromise: Promise<Tf> | null = null;
let modelPromise: Promise<GraphModel> | null = null;
let modelInstance: GraphModel | null = null;
let modelInstanceUrl: string | null = null;

function getMattingInputSize(videoWidth: number, videoHeight: number, inputLongEdgePx: number) {
  const longEdge = Math.max(videoWidth, videoHeight);
  if (!longEdge) {
    return null;
  }

  const scale = Math.min(1, inputLongEdgePx / longEdge);
  return {
    width: Math.max(1, Math.round(videoWidth * scale)),
    height: Math.max(1, Math.round(videoHeight * scale)),
  };
}

async function loadTensorFlow() {
  if (!tfPromise) {
    tfPromise = import('@tensorflow/tfjs').then(async (tf) => {
      try {
        await tf.setBackend('webgl');
      } catch {
        await tf.setBackend('cpu');
      }
      await tf.ready();
      return tf;
    });
  }

  return tfPromise;
}

async function loadMattingModel(modelUrl: string) {
  if (modelInstance && modelInstanceUrl === modelUrl) {
    return modelInstance;
  }

  if (modelInstanceUrl !== modelUrl) {
    modelPromise = null;
    modelInstance = null;
    modelInstanceUrl = null;
  }

  if (!modelPromise) {
    modelPromise = loadTensorFlow().then(async (tf) => {
      const model = await tf.loadGraphModel(modelUrl);
      modelInstance = model;
      modelInstanceUrl = modelUrl;
      return model;
    });
  }

  return modelPromise;
}

function disposeTensors(tf: Tf | null, tensors: Array<Tensor | null | undefined>) {
  if (!tf) {
    return;
  }

  tf.dispose(tensors.filter(Boolean) as Tensor[]);
}

function createInitialRecurrentState(tf: Tf) {
  return [tf.scalar(0), tf.scalar(0), tf.scalar(0), tf.scalar(0)] as [
    Tensor,
    Tensor,
    Tensor,
    Tensor,
  ];
}

function resetRecurrentState(tf: Tf | null, stateRef: { current: [Tensor, Tensor, Tensor, Tensor] | null }) {
  disposeTensors(tf, stateRef.current ?? []);
  stateRef.current = null;
}

function normalizeOutputs(outputs: Tensor | Tensor[]) {
  if (!Array.isArray(outputs) || outputs.length !== 6) {
    throw new Error('RVM returned an unexpected output shape.');
  }

  return outputs as [Tensor, Tensor, Tensor, Tensor, Tensor, Tensor];
}

export function useRobustVideoMatting({
  enabled = true,
  modelUrl = VIDEO_MATTING_MODEL_URL,
  inputLongEdgePx = VIDEO_MATTING_INPUT_LONG_EDGE_PX,
  downsampleRatio = VIDEO_MATTING_DOWNSAMPLE_RATIO,
  intervalMs = VIDEO_MATTING_INTERVAL_MS,
}: RobustVideoMattingOptions = {}) {
  const [isLoading, setIsLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<VideoMattingStats>({
    fps: 0,
    inferenceMs: 0,
    inputWidth: 0,
    inputHeight: 0,
    backend: null,
  });
  const tfRef = useRef<Tf | null>(null);
  const modelRef = useRef<GraphModel | null>(null);
  const mattingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mattingContextRef = useRef<CanvasRenderingContext2D | null>(null);
  const recurrentStateRef = useRef<[Tensor, Tensor, Tensor, Tensor] | null>(null);
  const recurrentInputSizeRef = useRef<MattingInputSize | null>(null);
  const maskCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const displaySourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pendingSourceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const frameRef = useRef<VideoMattingFrame | null>(null);
  const inFlightRef = useRef(false);
  const statsRef = useRef({
    frames: 0,
    lastUpdatedAt: 0,
  });

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setIsLoading(false);
      setError(null);
      frameRef.current = null;
      resetRecurrentState(tfRef.current, recurrentStateRef);
      recurrentInputSizeRef.current = null;
      return;
    }

    setIsLoading(true);
    setError(null);

    void Promise.all([loadTensorFlow(), loadMattingModel(modelUrl)])
      .then(([tf, model]) => {
        if (cancelled) {
          return;
        }

        tfRef.current = tf;
        modelRef.current = model;
        setStats((previous) => ({
          ...previous,
          backend: tf.getBackend(),
        }));
        setIsLoading(false);
      })
      .catch((loadError) => {
        if (cancelled) {
          return;
        }

        setError(loadError instanceof Error ? loadError.message : 'Unable to load video matting model.');
        setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, modelUrl]);

  useEffect(
    () => () => {
      resetRecurrentState(tfRef.current, recurrentStateRef);
    },
    []
  );

  const detectMattingFrame = useCallback(
    (
      videoElement: HTMLVideoElement,
      now: number,
      lastDetectedAtRef: { current: number }
    ) => {
      if (
        !enabled ||
        !tfRef.current ||
        !modelRef.current ||
        inFlightRef.current ||
        now - lastDetectedAtRef.current < intervalMs ||
        videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        return frameRef.current;
      }

      const inputSize = getMattingInputSize(
        videoElement.videoWidth,
        videoElement.videoHeight,
        inputLongEdgePx
      );
      if (!inputSize) {
        return frameRef.current;
      }

      lastDetectedAtRef.current = now;
      inFlightRef.current = true;

      const tf = tfRef.current;
      const model = modelRef.current;
      void (async () => {
        const startedAt = performance.now();
        let sourceTensor: Tensor | null = null;
        let outputs: [Tensor, Tensor, Tensor, Tensor, Tensor, Tensor] | null = null;
        let maskTensor: Tensor | null = null;
        let downsampleRatioTensor: Tensor | null = null;
        let pendingSourceCanvas: HTMLCanvasElement | null = null;

        try {
          if (!mattingCanvasRef.current) {
            mattingCanvasRef.current = document.createElement('canvas');
          }

          const mattingCanvas = mattingCanvasRef.current;
          if (mattingCanvas.width !== inputSize.width || mattingCanvas.height !== inputSize.height) {
            mattingCanvas.width = inputSize.width;
            mattingCanvas.height = inputSize.height;
            mattingContextRef.current = null;
            recurrentInputSizeRef.current = null;
          }

          let mattingContext = mattingContextRef.current;
          if (!mattingContext) {
            mattingContext =
              mattingCanvas.getContext('2d', {
                alpha: false,
                desynchronized: true,
              }) ?? mattingCanvas.getContext('2d');
            mattingContextRef.current = mattingContext;
          }

          if (!mattingContext) {
            throw new Error('Unable to create video matting canvas context.');
          }

          pendingSourceCanvas = pendingSourceCanvasRef.current ?? document.createElement('canvas');
          if (
            pendingSourceCanvas.width !== videoElement.videoWidth ||
            pendingSourceCanvas.height !== videoElement.videoHeight
          ) {
            pendingSourceCanvas.width = videoElement.videoWidth;
            pendingSourceCanvas.height = videoElement.videoHeight;
          }

          const pendingSourceContext =
            pendingSourceCanvas.getContext('2d', {
              alpha: false,
              desynchronized: true,
            }) ?? pendingSourceCanvas.getContext('2d');

          if (!pendingSourceContext) {
            throw new Error('Unable to create video matting source context.');
          }

          pendingSourceContext.drawImage(
            videoElement,
            0,
            0,
            pendingSourceCanvas.width,
            pendingSourceCanvas.height
          );

          const previousInputSize = recurrentInputSizeRef.current;
          if (
            previousInputSize?.width !== inputSize.width ||
            previousInputSize?.height !== inputSize.height
          ) {
            resetRecurrentState(tf, recurrentStateRef);
            recurrentInputSizeRef.current = inputSize;
          }

          mattingContext.drawImage(pendingSourceCanvas, 0, 0, inputSize.width, inputSize.height);
          recurrentStateRef.current ??= createInitialRecurrentState(tf);
          const [r1i, r2i, r3i, r4i] = recurrentStateRef.current;
          downsampleRatioTensor = tf.scalar(downsampleRatio);

          sourceTensor = tf.tidy(() =>
            tf.browser.fromPixels(mattingCanvas).toFloat().expandDims(0).div(255)
          );

          outputs = normalizeOutputs(
            await model.executeAsync(
              {
                src: sourceTensor,
                r1i,
                r2i,
                r3i,
                r4i,
                downsample_ratio: downsampleRatioTensor,
              },
              ['fgr', 'pha', 'r1o', 'r2o', 'r3o', 'r4o']
            )
          );

          const [fgr, pha, r1o, r2o, r3o, r4o] = outputs;
          const [, height = 0, width = 0] = pha.shape;

          if (!maskCanvasRef.current) {
            maskCanvasRef.current = document.createElement('canvas');
          }

          const maskCanvas = maskCanvasRef.current;
          if (maskCanvas.width !== width || maskCanvas.height !== height) {
            maskCanvas.width = width;
            maskCanvas.height = height;
          }

          maskTensor = tf.tidy(() => {
            const alpha = pha.squeeze([0]);
            const white = tf.ones([height, width, 3]);
            return tf.concat([white, alpha], -1).mul(255).cast('int32') as Tensor3D;
          });

          await tf.browser.toPixels(maskTensor as Tensor3D, maskCanvas);

          disposeTensors(tf, [fgr, pha, sourceTensor, ...recurrentStateRef.current]);
          sourceTensor = null;
          recurrentStateRef.current = [r1o, r2o, r3o, r4o];
          outputs = null;
          const completedAt = performance.now();
          const previousDisplaySourceCanvas = displaySourceCanvasRef.current;
          displaySourceCanvasRef.current = pendingSourceCanvas;
          pendingSourceCanvasRef.current = previousDisplaySourceCanvas;

          frameRef.current = {
            width,
            height,
            maskCanvas,
            sourceCanvas: pendingSourceCanvas,
            timestamp: completedAt,
          };

          const nextFrames = statsRef.current.frames + 1;
          if (!statsRef.current.lastUpdatedAt) {
            statsRef.current = {
              frames: nextFrames,
              lastUpdatedAt: completedAt,
            };
          } else if (completedAt - statsRef.current.lastUpdatedAt >= 500) {
            setStats({
              fps: Math.round((nextFrames * 1000) / (completedAt - statsRef.current.lastUpdatedAt)),
              inferenceMs: Math.round(completedAt - startedAt),
              inputWidth: width,
              inputHeight: height,
              backend: tf.getBackend(),
            });
            statsRef.current = {
              frames: 0,
              lastUpdatedAt: completedAt,
            };
          } else {
            statsRef.current.frames = nextFrames;
          }

          setError(null);
        } catch (mattingError) {
          resetRecurrentState(tf, recurrentStateRef);
          recurrentInputSizeRef.current = null;
          setError(
            mattingError instanceof Error
              ? mattingError.message
              : 'Video matting failed during rendering.'
          );
        } finally {
          maskTensor?.dispose();
          downsampleRatioTensor?.dispose();
          sourceTensor?.dispose();
          if (outputs) {
            disposeTensors(tf, outputs);
          }
          inFlightRef.current = false;
        }
      })();

      return frameRef.current;
    },
    [downsampleRatio, enabled, inputLongEdgePx, intervalMs]
  );

  return {
    detectMattingFrame,
    error,
    isLoading,
    stats,
  };
}
