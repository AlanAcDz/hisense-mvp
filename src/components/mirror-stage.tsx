import {
  type RefObject,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  drawBackgroundLayer,
  drawForegroundLayer,
  getBackgroundGuidance,
  resolveBackgroundMatte,
  syncMatteCanvas,
} from '@/lib/mirror/background/compositor';
import { composeCaptureFrame, downloadDataUrl } from '@/lib/mirror/capture/compose-capture';
import { BACKGROUND_ASSET_URL } from '@/lib/mirror/constants';
import { drawPoseOverlay } from '@/lib/mirror/pose/drawing';
import { computeSleeveTransform, computeTorsoTransform, getCoverLayout } from '@/lib/mirror/pose/torso';
import { usePoseLandmarker } from '@/lib/mirror/pose/use-pose-landmarker';
import { applySleeveRenderTwist } from '@/lib/mirror/sleeve-render';
import { ShirtSceneController } from '@/lib/mirror/three/shirt-scene';
import type { MirrorSceneState, StageSize } from '@/lib/mirror/types';

type ShirtSceneControllerRuntime = Pick<
  ShirtSceneController,
  | 'canvas'
  | 'dispose'
  | 'loadShirtModel'
  | 'render'
  | 'resize'
  | 'setJerseyOpacity'
  | 'updateShirtTransform'
  | 'updateSleeves'
>;

const DEFAULT_CREATE_SCENE_CONTROLLER = () => new ShirtSceneController();

export interface MirrorStageHandle {
  capture: () => void;
}

export interface MirrorStageProps {
  jerseyOpacity: number;
  showPosePoints: boolean;
  onStatusChange?: (status: string | null) => void;
  createSceneController?: () => ShirtSceneControllerRuntime;
  usePoseLandmarkerRuntime?: () => Pick<
    ReturnType<typeof usePoseLandmarker>,
    'detectFrame' | 'error' | 'isLoading'
  >;
}

function useStageSize(stageRef: RefObject<HTMLDivElement | null>) {
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 });

  useEffect(() => {
    if (!stageRef.current) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextEntry = entries[0];
      if (!nextEntry) {
        return;
      }

      const nextSize = {
        width: Math.round(nextEntry.contentRect.width),
        height: Math.round(nextEntry.contentRect.height),
      };

      setStageSize((previous) => {
        if (previous.width === nextSize.width && previous.height === nextSize.height) {
          return previous;
        }
        return nextSize;
      });
    });

    observer.observe(stageRef.current);

    return () => observer.disconnect();
  }, [stageRef]);

  return stageSize;
}

function clearCanvas(canvas: HTMLCanvasElement | null, stageSize: StageSize) {
  const ctx = canvas?.getContext('2d');
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, stageSize.width, stageSize.height);
}

export const MirrorStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function MirrorStage(
  {
    jerseyOpacity,
    showPosePoints,
    onStatusChange,
    createSceneController = DEFAULT_CREATE_SCENE_CONTROLLER,
    usePoseLandmarkerRuntime = usePoseLandmarker,
  },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const shirtLayerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const foregroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectAtRef = useRef(0);
  const sceneControllerRef = useRef<ShirtSceneControllerRuntime | null>(null);
  const backgroundImageRef = useRef<HTMLImageElement | null>(null);
  const matteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const syncedMatteTimestampRef = useRef<number | null>(null);
  const lastGoodMatteRef = useRef<ReturnType<typeof resolveBackgroundMatte>['matte']>(null);
  const [sceneState, setSceneState] = useState<MirrorSceneState>({
    cameraError: null,
    poseError: null,
    poseModelLoading: true,
    shirtAssetLoading: true,
    shirtAssetError: null,
    backgroundMode: 'loading',
    backgroundGuidance: null,
  });

  const { detectFrame, error: poseError, isLoading: poseModelLoading } = usePoseLandmarkerRuntime();
  const stageSize = useStageSize(stageRef);
  const statusMessage = useMemo(
    () =>
      sceneState.cameraError ??
      (poseModelLoading ? 'Loading pose model...' : null) ??
      poseError ??
      sceneState.poseError ??
      (sceneState.shirtAssetLoading ? 'Loading jersey assets...' : null) ??
      sceneState.shirtAssetError ??
      (sceneState.backgroundMode === 'loading' ? 'Loading background replacement...' : null) ??
      (sceneState.backgroundMode === 'paused' ? sceneState.backgroundGuidance : null) ??
      null,
    [
      poseError,
      poseModelLoading,
      sceneState.backgroundMode,
      sceneState.cameraError,
      sceneState.backgroundGuidance,
      sceneState.poseError,
      sceneState.shirtAssetError,
      sceneState.shirtAssetLoading,
    ]
  );

  useEffect(() => {
    onStatusChange?.(statusMessage);
  }, [onStatusChange, statusMessage]);

  useEffect(() => {
    const backgroundImage = new Image();
    backgroundImage.src = BACKGROUND_ASSET_URL;
    backgroundImageRef.current = backgroundImage;

    return () => {
      backgroundImageRef.current = null;
    };
  }, []);

  useEffect(() => {
    let mounted = true;

    const controller = createSceneController();
    sceneControllerRef.current = controller;

    if (shirtLayerRef.current) {
      controller.canvas.className = 'absolute inset-0 h-full w-full pointer-events-none';
      shirtLayerRef.current.appendChild(controller.canvas);
    }

    async function loadShirt() {
      const result = await controller.loadShirtModel();
      if (!mounted) {
        return;
      }

      setSceneState((previous) => ({
        ...previous,
        shirtAssetLoading: false,
        shirtAssetError: result.errorMessage,
      }));
    }

    void loadShirt();

    return () => {
      mounted = false;
      controller.dispose();
      controller.canvas.remove();
      sceneControllerRef.current = null;
    };
  }, [createSceneController]);

  useEffect(() => {
    sceneControllerRef.current?.setJerseyOpacity(jerseyOpacity);
  }, [jerseyOpacity]);

  useEffect(() => {
    setSceneState((previous) => ({
      ...previous,
      poseModelLoading,
      poseError,
    }));
  }, [poseError, poseModelLoading]);

  useEffect(() => {
    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        setSceneState((previous) => ({
          ...previous,
          cameraError: null,
        }));
      } catch (cameraError) {
        setSceneState((previous) => ({
          ...previous,
          cameraError:
            cameraError instanceof Error
              ? cameraError.message
              : 'Camera permission was denied or unavailable.',
        }));
      }
    }

    void startCamera();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = sceneControllerRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    const foregroundCanvas = foregroundCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;

    if (!controller || !backgroundCanvas || !foregroundCanvas || !poseCanvas || !stageSize.width || !stageSize.height) {
      return;
    }

    backgroundCanvas.width = stageSize.width;
    backgroundCanvas.height = stageSize.height;
    foregroundCanvas.width = stageSize.width;
    foregroundCanvas.height = stageSize.height;
    poseCanvas.width = stageSize.width;
    poseCanvas.height = stageSize.height;
    controller.resize(stageSize);
  }, [stageSize]);

  useEffect(() => {
    const controller = sceneControllerRef.current;
    const videoElement = videoRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    const foregroundCanvas = foregroundCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;

    if (
      !controller ||
      !videoElement ||
      !backgroundCanvas ||
      !foregroundCanvas ||
      !poseCanvas ||
      !stageSize.width ||
      !stageSize.height
    ) {
      return;
    }

    const backgroundContext = backgroundCanvas.getContext('2d');
    const foregroundContext = foregroundCanvas.getContext('2d');
    const poseContext = poseCanvas.getContext('2d');
    if (!backgroundContext || !foregroundContext || !poseContext) {
      return;
    }

    const renderFrame = (now: number) => {
      const currentVideo = videoRef.current;
      const currentController = sceneControllerRef.current;
      const currentBackgroundCanvas = backgroundCanvasRef.current;
      const currentForegroundCanvas = foregroundCanvasRef.current;
      const currentPoseCanvas = poseCanvasRef.current;

      if (
        !currentVideo ||
        !currentController ||
        !currentBackgroundCanvas ||
        !currentForegroundCanvas ||
        !currentPoseCanvas
      ) {
        return;
      }

      const currentBackgroundContext = currentBackgroundCanvas.getContext('2d');
      const currentForegroundContext = currentForegroundCanvas.getContext('2d');
      const currentPoseContext = currentPoseCanvas.getContext('2d');
      if (!currentBackgroundContext || !currentForegroundContext || !currentPoseContext) {
        return;
      }

      if (!currentVideo.videoWidth || !currentVideo.videoHeight) {
        clearCanvas(currentBackgroundCanvas, stageSize);
        clearCanvas(currentForegroundCanvas, stageSize);
        currentPoseContext.clearRect(0, 0, stageSize.width, stageSize.height);
        currentController.updateShirtTransform(null);
        currentController.updateSleeves(null, null);

        setSceneState((previous) =>
          previous.backgroundMode === 'loading' && previous.backgroundGuidance === null
            ? previous
            : {
                ...previous,
                backgroundMode: 'loading',
                backgroundGuidance: null,
              }
        );

        currentController.render();
        animationFrameRef.current = window.requestAnimationFrame(renderFrame);
        return;
      }

      const coverLayout = getCoverLayout(
        {
          width: currentVideo.videoWidth,
          height: currentVideo.videoHeight,
        },
        stageSize
      );
      const nextFrame = detectFrame(currentVideo, now, lastDetectAtRef);
      const nextPoseFrame = nextFrame.poseFrame;
      const nextSegmentationFrame = nextFrame.segmentationFrame;

      drawPoseOverlay(currentPoseContext, nextPoseFrame, stageSize, coverLayout, showPosePoints);

      const torsoTransform = computeTorsoTransform(nextPoseFrame, stageSize, coverLayout);
      currentController.updateShirtTransform(torsoTransform);

      if (torsoTransform) {
        const leftSleeveTransform = computeSleeveTransform(
          nextPoseFrame?.leftArm ?? null,
          torsoTransform,
          stageSize,
          coverLayout
        );
        const rightSleeveTransform = computeSleeveTransform(
          nextPoseFrame?.rightArm ?? null,
          torsoTransform,
          stageSize,
          coverLayout
        );

        currentController.updateSleeves(
          leftSleeveTransform ? applySleeveRenderTwist(leftSleeveTransform) : null,
          rightSleeveTransform ? applySleeveRenderTwist(rightSleeveTransform) : null
        );
      } else {
        currentController.updateSleeves(null, null);
      }

      const backgroundMatte = resolveBackgroundMatte({
        segmentationFrame: nextSegmentationFrame,
        previousMatte: lastGoodMatteRef.current,
        now,
      });
      const nextMatte = backgroundMatte.matte;

      if (torsoTransform && nextMatte) {
        lastGoodMatteRef.current = nextMatte;

        if (!matteCanvasRef.current) {
          matteCanvasRef.current = document.createElement('canvas');
        }

        if (
          syncedMatteTimestampRef.current !== nextMatte.timestamp ||
          matteCanvasRef.current.width !== nextMatte.width ||
          matteCanvasRef.current.height !== nextMatte.height
        ) {
          syncMatteCanvas(matteCanvasRef.current, nextMatte);
          syncedMatteTimestampRef.current = nextMatte.timestamp;
        }

        drawBackgroundLayer(currentBackgroundContext, stageSize, backgroundImageRef.current);
        drawForegroundLayer({
          ctx: currentForegroundContext,
          coverLayout,
          stageSize,
          source: currentVideo,
          maskCanvas: matteCanvasRef.current,
        });

        setSceneState((previous) =>
          previous.backgroundMode === 'active' && previous.backgroundGuidance === null
            ? previous
            : {
                ...previous,
                backgroundMode: 'active',
                backgroundGuidance: null,
              }
        );
      } else {
        currentBackgroundContext.clearRect(0, 0, stageSize.width, stageSize.height);
        drawForegroundLayer({
          ctx: currentForegroundContext,
          coverLayout,
          stageSize,
          source: currentVideo,
        });

        const guidance = getBackgroundGuidance(
          Boolean(torsoTransform),
          Boolean(nextSegmentationFrame),
          backgroundMatte.reusedPrevious
        );

        setSceneState((previous) =>
          previous.backgroundMode === 'paused' && previous.backgroundGuidance === guidance
            ? previous
            : {
                ...previous,
                backgroundMode: 'paused',
                backgroundGuidance: guidance,
              }
        );
      }

      currentController.render();
      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [detectFrame, showPosePoints, stageSize]);

  useImperativeHandle(
    ref,
    () => ({
      capture() {
        const backgroundCanvas = backgroundCanvasRef.current;
        const foregroundCanvas = foregroundCanvasRef.current;
        const poseCanvas = poseCanvasRef.current;
        const rendererCanvas = sceneControllerRef.current?.canvas;

        if (!foregroundCanvas || !rendererCanvas || !stageSize.width || !stageSize.height) {
          return;
        }

        const outputWidth = Math.round(stageSize.width * Math.min(window.devicePixelRatio || 1, 2));
        const outputHeight = Math.round(stageSize.height * Math.min(window.devicePixelRatio || 1, 2));
        const dataUrl = composeCaptureFrame({
          backgroundCanvas,
          foregroundCanvas,
          rendererCanvas,
          poseCanvas,
          outputWidth,
          outputHeight,
          showPosePoints,
        });

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        downloadDataUrl(dataUrl, `hisense-mirror-${timestamp}.jpg`);
      },
    }),
    [showPosePoints, stageSize]
  );

  return (
    <div
      ref={stageRef}
      className="relative h-dvh w-screen overflow-hidden bg-black"
    >
      <video ref={videoRef} className="hidden" autoPlay muted playsInline />
      <canvas
        ref={backgroundCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <canvas
        ref={foregroundCanvasRef}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
      <div ref={shirtLayerRef} className="pointer-events-none absolute inset-0" />
      <canvas ref={poseCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  );
});
