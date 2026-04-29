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
  drawArmOcclusionLayer,
  drawArmOcclusionMaskLayer,
  drawBackgroundLayer,
  drawForegroundLayer,
  getBackgroundGuidance,
  resolveBackgroundMatte,
  syncMatteCanvas,
} from '@/lib/mirror/background/compositor';
import {
  composeCaptureFrame,
  downloadDataUrl,
  drawCaptureLayers,
} from '@/lib/mirror/capture/compose-capture';
import { BACKGROUND_VIDEO_ASSET_URL } from '@/lib/mirror/constants';
import { drawPoseOverlay } from '@/lib/mirror/pose/drawing';
import { computeRigPose, computeTorsoTransform, getCoverLayout } from '@/lib/mirror/pose/torso';
import {
  usePoseLandmarker,
  type PoseLandmarkerOptions,
} from '@/lib/mirror/pose/use-pose-landmarker';
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
  | 'updateRigPose'
  | 'updateShirtTransform'
>;

const DEFAULT_CREATE_SCENE_CONTROLLER = () => new ShirtSceneController();

export interface MirrorStageHandle {
  capture: () => void;
}

export interface MirrorStageProps {
  jerseyOpacity: number;
  showPosePoints: boolean;
  poseLandmarkerOptions?: PoseLandmarkerOptions;
  onStatusChange?: (status: string | null) => void;
  onSubjectDetectedChange?: (detected: boolean) => void;
  createSceneController?: () => ShirtSceneControllerRuntime;
  usePoseLandmarkerRuntime?: (options?: PoseLandmarkerOptions) => Pick<
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
    poseLandmarkerOptions,
    onStatusChange,
    onSubjectDetectedChange,
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
  const armOverlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const armMaskCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);
  const displayCanvasRef = useRef<HTMLCanvasElement>(null);
  const shirtScratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectAtRef = useRef(0);
  const subjectDetectedRef = useRef(false);
  const sceneControllerRef = useRef<ShirtSceneControllerRuntime | null>(null);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
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

  const { detectFrame, error: poseError, isLoading: poseModelLoading } =
    usePoseLandmarkerRuntime(poseLandmarkerOptions);
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

  function syncSubjectDetected(detected: boolean) {
    if (subjectDetectedRef.current === detected) {
      return;
    }

    subjectDetectedRef.current = detected;
    onSubjectDetectedChange?.(detected);
  }

  useEffect(
    () => () => {
      syncSubjectDetected(false);
    },
    [onSubjectDetectedChange]
  );

  useEffect(() => {
    const backgroundVideo = document.createElement('video');
    backgroundVideo.src = BACKGROUND_VIDEO_ASSET_URL;
    backgroundVideo.loop = true;
    backgroundVideo.muted = true;
    backgroundVideo.playsInline = true;
    backgroundVideo.preload = 'auto';
    backgroundVideoRef.current = backgroundVideo;

    void backgroundVideo.play().catch(() => {
      // Autoplay can be blocked transiently; the next render pass will keep
      // using the gradient fallback until the media starts.
    });

    return () => {
      backgroundVideoRef.current = null;
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
    const armOverlayCanvas = armOverlayCanvasRef.current;
    const armMaskCanvas = armMaskCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;
    const displayCanvas = displayCanvasRef.current;

    if (
      !controller ||
      !backgroundCanvas ||
      !foregroundCanvas ||
      !armOverlayCanvas ||
      !armMaskCanvas ||
      !poseCanvas ||
      !displayCanvas ||
      !stageSize.width ||
      !stageSize.height
    ) {
      return;
    }

    backgroundCanvas.width = stageSize.width;
    backgroundCanvas.height = stageSize.height;
    foregroundCanvas.width = stageSize.width;
    foregroundCanvas.height = stageSize.height;
    armOverlayCanvas.width = stageSize.width;
    armOverlayCanvas.height = stageSize.height;
    armMaskCanvas.width = stageSize.width;
    armMaskCanvas.height = stageSize.height;
    poseCanvas.width = stageSize.width;
    poseCanvas.height = stageSize.height;
    displayCanvas.width = stageSize.width;
    displayCanvas.height = stageSize.height;
    if (!shirtScratchCanvasRef.current) {
      shirtScratchCanvasRef.current = document.createElement('canvas');
    }
    shirtScratchCanvasRef.current.width = stageSize.width;
    shirtScratchCanvasRef.current.height = stageSize.height;
    controller.resize(stageSize);
  }, [stageSize]);

  useEffect(() => {
    const controller = sceneControllerRef.current;
    const videoElement = videoRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    const foregroundCanvas = foregroundCanvasRef.current;
    const armOverlayCanvas = armOverlayCanvasRef.current;
    const armMaskCanvas = armMaskCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;
    const displayCanvas = displayCanvasRef.current;

    if (
      !controller ||
      !videoElement ||
      !backgroundCanvas ||
      !foregroundCanvas ||
      !armOverlayCanvas ||
      !armMaskCanvas ||
      !poseCanvas ||
      !displayCanvas ||
      !stageSize.width ||
      !stageSize.height
    ) {
      return;
    }

    const backgroundContext = backgroundCanvas.getContext('2d');
    const foregroundContext = foregroundCanvas.getContext('2d');
    const armOverlayContext = armOverlayCanvas.getContext('2d');
    const armMaskContext = armMaskCanvas.getContext('2d');
    const poseContext = poseCanvas.getContext('2d');
    const displayContext = displayCanvas.getContext('2d');
    if (
      !backgroundContext ||
      !foregroundContext ||
      !armOverlayContext ||
      !armMaskContext ||
      !poseContext ||
      !displayContext
    ) {
      return;
    }

    const renderFrame = (now: number) => {
      const currentVideo = videoRef.current;
      const currentController = sceneControllerRef.current;
      const currentBackgroundCanvas = backgroundCanvasRef.current;
      const currentForegroundCanvas = foregroundCanvasRef.current;
      const currentArmOverlayCanvas = armOverlayCanvasRef.current;
      const currentArmMaskCanvas = armMaskCanvasRef.current;
      const currentPoseCanvas = poseCanvasRef.current;
      const currentDisplayCanvas = displayCanvasRef.current;

      if (
        !currentVideo ||
        !currentController ||
        !currentBackgroundCanvas ||
        !currentForegroundCanvas ||
        !currentArmOverlayCanvas ||
        !currentArmMaskCanvas ||
        !currentPoseCanvas ||
        !currentDisplayCanvas
      ) {
        return;
      }

      const currentBackgroundContext = currentBackgroundCanvas.getContext('2d');
      const currentForegroundContext = currentForegroundCanvas.getContext('2d');
      const currentArmOverlayContext = currentArmOverlayCanvas.getContext('2d');
      const currentArmMaskContext = currentArmMaskCanvas.getContext('2d');
      const currentPoseContext = currentPoseCanvas.getContext('2d');
      const currentDisplayContext = currentDisplayCanvas.getContext('2d');
      if (
        !currentBackgroundContext ||
        !currentForegroundContext ||
        !currentArmOverlayContext ||
        !currentArmMaskContext ||
        !currentPoseContext ||
        !currentDisplayContext
      ) {
        return;
      }

      if (!currentVideo.videoWidth || !currentVideo.videoHeight) {
        syncSubjectDetected(false);
        clearCanvas(currentBackgroundCanvas, stageSize);
        clearCanvas(currentForegroundCanvas, stageSize);
        clearCanvas(currentArmOverlayCanvas, stageSize);
        clearCanvas(currentArmMaskCanvas, stageSize);
        currentPoseContext.clearRect(0, 0, stageSize.width, stageSize.height);
        currentDisplayContext.clearRect(0, 0, stageSize.width, stageSize.height);
        currentController.updateShirtTransform(null);
        currentController.updateRigPose(null);

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
        drawCaptureLayers(currentDisplayContext, {
          backgroundCanvas: currentBackgroundCanvas,
          foregroundCanvas: currentForegroundCanvas,
          rendererCanvas: currentController.canvas,
          shirtCutoutMaskCanvas: currentArmMaskCanvas,
          armOverlayCanvas: currentArmOverlayCanvas,
          poseCanvas: currentPoseCanvas,
          scratchCanvas: shirtScratchCanvasRef.current,
          outputWidth: stageSize.width,
          outputHeight: stageSize.height,
          showPosePoints,
        });
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
      syncSubjectDetected(Boolean(torsoTransform));
      currentController.updateShirtTransform(torsoTransform);
      currentController.updateRigPose(
        computeRigPose(nextPoseFrame, torsoTransform, stageSize, coverLayout)
      );

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

        drawBackgroundLayer(currentBackgroundContext, stageSize, backgroundVideoRef.current);
        drawForegroundLayer({
          ctx: currentForegroundContext,
          coverLayout,
          stageSize,
          source: currentVideo,
          maskCanvas: matteCanvasRef.current,
        });
        drawArmOcclusionLayer({
          ctx: currentArmOverlayContext,
          coverLayout,
          stageSize,
          source: currentForegroundCanvas,
          sourceSpace: 'stage',
          poseFrame: nextPoseFrame,
          debug: showPosePoints,
        });
        drawArmOcclusionMaskLayer({
          ctx: currentArmMaskContext,
          coverLayout,
          stageSize,
          poseFrame: nextPoseFrame,
          clipCanvas: currentForegroundCanvas,
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
        clearCanvas(currentArmOverlayCanvas, stageSize);
        clearCanvas(currentArmMaskCanvas, stageSize);
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
      drawCaptureLayers(currentDisplayContext, {
        backgroundCanvas: currentBackgroundCanvas,
        foregroundCanvas: currentForegroundCanvas,
        rendererCanvas: currentController.canvas,
        shirtCutoutMaskCanvas: currentArmMaskCanvas,
        armOverlayCanvas: currentArmOverlayCanvas,
        poseCanvas: currentPoseCanvas,
        scratchCanvas: shirtScratchCanvasRef.current,
        outputWidth: stageSize.width,
        outputHeight: stageSize.height,
        showPosePoints,
      });
      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [detectFrame, onSubjectDetectedChange, showPosePoints, stageSize]);

  useImperativeHandle(
    ref,
    () => ({
      capture() {
        const backgroundCanvas = backgroundCanvasRef.current;
        const foregroundCanvas = foregroundCanvasRef.current;
        const armOverlayCanvas = armOverlayCanvasRef.current;
        const armMaskCanvas = armMaskCanvasRef.current;
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
          shirtCutoutMaskCanvas: armMaskCanvas,
          armOverlayCanvas,
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
      className="relative z-0 h-dvh w-screen overflow-hidden bg-black"
    >
      <video ref={videoRef} className="hidden" autoPlay muted playsInline />
      <canvas
        ref={backgroundCanvasRef}
        className="pointer-events-none absolute inset-0 z-0 h-full w-full opacity-0"
      />
      <canvas
        ref={foregroundCanvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full opacity-0"
      />
      <div ref={shirtLayerRef} className="pointer-events-none absolute inset-0 z-20 opacity-0" />
      <canvas
        ref={armOverlayCanvasRef}
        className="pointer-events-none absolute inset-0 z-30 h-full w-full opacity-0"
      />
      <canvas
        ref={armMaskCanvasRef}
        className="pointer-events-none absolute inset-0 z-30 h-full w-full opacity-0"
      />
      <canvas
        ref={poseCanvasRef}
        className="pointer-events-none absolute inset-0 z-40 h-full w-full opacity-0"
      />
      <canvas
        ref={displayCanvasRef}
        className="pointer-events-none absolute inset-0 z-50 h-full w-full"
      />
    </div>
  );
});
