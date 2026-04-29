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
  drawStageForegroundLayer,
  getBackgroundGuidance,
  resolveBackgroundMatte,
  syncMatteCanvas,
} from '@/lib/mirror/background/compositor';
import {
  composeCaptureFrame,
  downloadDataUrl,
  drawCaptureLayers,
} from '@/lib/mirror/capture/compose-capture';
import {
  BACKGROUND_VIDEO_ASSET_URL,
  DEBUG_FPS_UPDATE_INTERVAL_MS,
  VIDEO_MATTING_ENABLED,
  VIDEO_MATTING_STALE_MS,
} from '@/lib/mirror/constants';
import {
  useRobustVideoMatting,
  type RobustVideoMattingOptions,
} from '@/lib/mirror/matting/use-robust-video-matting';
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
const PREFERRED_CAMERA_WIDTH_PX = 3840;
const PREFERRED_CAMERA_HEIGHT_PX = 2160;
const PREFERRED_CAMERA_FRAME_RATE = 30;

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
  useVideoMattingRuntime?: (options?: RobustVideoMattingOptions) => Pick<
    ReturnType<typeof useRobustVideoMatting>,
    'detectMattingFrame' | 'error' | 'isLoading' | 'stats'
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

function getMaxCameraConstraint(
  range: MediaSettingsRange | undefined,
  preferredValue: number,
  exact = false
): ConstrainULong | undefined {
  if (!range?.max) {
    return { ideal: preferredValue };
  }

  const targetValue = Math.min(range.max, preferredValue);

  return exact ? { exact: targetValue } : { ideal: targetValue };
}

async function requestMaximumCameraResolution(stream: MediaStream) {
  const track = stream.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) {
    return;
  }

  const capabilities = track.getCapabilities();
  const constraints: MediaTrackConstraints = {
    width: getMaxCameraConstraint(capabilities.width, PREFERRED_CAMERA_WIDTH_PX, true),
    height: getMaxCameraConstraint(capabilities.height, PREFERRED_CAMERA_HEIGHT_PX, true),
    frameRate: capabilities.frameRate?.max
      ? { ideal: Math.min(capabilities.frameRate.max, PREFERRED_CAMERA_FRAME_RATE) }
      : { ideal: PREFERRED_CAMERA_FRAME_RATE },
  };

  try {
    await track.applyConstraints(constraints);
  } catch {
    await track.applyConstraints({
      width: getMaxCameraConstraint(capabilities.width, PREFERRED_CAMERA_WIDTH_PX),
      height: getMaxCameraConstraint(capabilities.height, PREFERRED_CAMERA_HEIGHT_PX),
      frameRate: { ideal: PREFERRED_CAMERA_FRAME_RATE },
    });
  }
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
    useVideoMattingRuntime = useRobustVideoMatting,
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
  const lastMattingDetectAtRef = useRef(0);
  const renderFpsRef = useRef({ frames: 0, lastUpdatedAt: 0 });
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
  const [renderFps, setRenderFps] = useState(0);

  const effectivePoseLandmarkerOptions = useMemo(
    () => ({
      ...poseLandmarkerOptions,
      outputSegmentationMasks: !VIDEO_MATTING_ENABLED,
    }),
    [poseLandmarkerOptions]
  );
  const { detectFrame, error: poseError, isLoading: poseModelLoading } =
    usePoseLandmarkerRuntime(effectivePoseLandmarkerOptions);
  const {
    detectMattingFrame,
    error: mattingError,
    isLoading: mattingModelLoading,
    stats: mattingStats,
  } = useVideoMattingRuntime({
    enabled: VIDEO_MATTING_ENABLED,
  });
  const stageSize = useStageSize(stageRef);
  const statusMessage = useMemo(
    () =>
      sceneState.cameraError ??
      (poseModelLoading ? 'Loading pose model...' : null) ??
      poseError ??
      (mattingModelLoading ? 'Loading video matting model...' : null) ??
      mattingError ??
      sceneState.poseError ??
      (sceneState.shirtAssetLoading ? 'Loading jersey assets...' : null) ??
      sceneState.shirtAssetError ??
      (sceneState.backgroundMode === 'loading' ? 'Loading background replacement...' : null) ??
      (sceneState.backgroundMode === 'paused' ? sceneState.backgroundGuidance : null) ??
      null,
    [
      mattingError,
      mattingModelLoading,
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

  function updateRenderFps(now: number) {
    if (!import.meta.env.DEV) {
      return;
    }

    const nextFrames = renderFpsRef.current.frames + 1;
    if (!renderFpsRef.current.lastUpdatedAt) {
      renderFpsRef.current = {
        frames: nextFrames,
        lastUpdatedAt: now,
      };
      return;
    }

    if (now - renderFpsRef.current.lastUpdatedAt < DEBUG_FPS_UPDATE_INTERVAL_MS) {
      renderFpsRef.current.frames = nextFrames;
      return;
    }

    setRenderFps(
      Math.round((nextFrames * 1000) / (now - renderFpsRef.current.lastUpdatedAt))
    );
    renderFpsRef.current = {
      frames: 0,
      lastUpdatedAt: now,
    };
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
            width: { ideal: PREFERRED_CAMERA_WIDTH_PX },
            height: { ideal: PREFERRED_CAMERA_HEIGHT_PX },
            frameRate: { ideal: PREFERRED_CAMERA_FRAME_RATE },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        await requestMaximumCameraResolution(stream);

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
      updateRenderFps(now);

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
      const nextMattingFrame = detectMattingFrame(currentVideo, now, lastMattingDetectAtRef, {
        coverLayout,
        stageSize,
      });
      const nextSegmentationFrame = VIDEO_MATTING_ENABLED ? null : nextFrame.segmentationFrame;
      const nextMattingMaskCanvas =
        VIDEO_MATTING_ENABLED &&
        nextMattingFrame &&
        now - nextMattingFrame.timestamp <= VIDEO_MATTING_STALE_MS
          ? nextMattingFrame.maskCanvas
          : null;
      const nextMattingSourceCanvas =
        VIDEO_MATTING_ENABLED &&
        nextMattingFrame &&
        now - nextMattingFrame.timestamp <= VIDEO_MATTING_STALE_MS
          ? nextMattingFrame.sourceCanvas
          : null;

      drawPoseOverlay(currentPoseContext, nextPoseFrame, stageSize, coverLayout, showPosePoints);

      const torsoTransform = computeTorsoTransform(nextPoseFrame, stageSize, coverLayout);
      syncSubjectDetected(Boolean(torsoTransform));
      currentController.updateShirtTransform(torsoTransform);
      currentController.updateRigPose(
        computeRigPose(nextPoseFrame, torsoTransform, stageSize, coverLayout)
      );

      const backgroundMatte = VIDEO_MATTING_ENABLED
        ? {
            matte: null,
            reusedPrevious: false,
          }
        : resolveBackgroundMatte({
            segmentationFrame: nextSegmentationFrame,
            previousMatte: lastGoodMatteRef.current,
            now,
          });
      const nextMatte = backgroundMatte.matte;
      let foregroundMaskCanvas = nextMattingMaskCanvas;
      let foregroundSource: CanvasImageSource = nextMattingSourceCanvas ?? currentVideo;

      if (!foregroundMaskCanvas && nextMatte) {
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

        foregroundMaskCanvas = matteCanvasRef.current;
        foregroundSource = currentVideo;
      }

      if (torsoTransform && foregroundMaskCanvas) {
        drawBackgroundLayer(currentBackgroundContext, stageSize, backgroundVideoRef.current);
        if (nextMattingSourceCanvas && nextMattingMaskCanvas) {
          drawStageForegroundLayer({
            ctx: currentForegroundContext,
            stageSize,
            source: nextMattingSourceCanvas,
            maskCanvas: nextMattingMaskCanvas,
          });
        } else {
          drawForegroundLayer({
            ctx: currentForegroundContext,
            coverLayout,
            stageSize,
            source: foregroundSource,
            maskCanvas: foregroundMaskCanvas,
          });
        }
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
          Boolean(nextMattingMaskCanvas || nextSegmentationFrame),
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
  }, [detectFrame, detectMattingFrame, onSubjectDetectedChange, showPosePoints, stageSize]);

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
      {import.meta.env.DEV ? (
        <div
          className="pointer-events-none absolute left-3 top-3 z-[60] rounded-md border border-white/14 bg-black/58 px-3 py-2 font-mono text-[0.68rem] leading-tight text-white/86 shadow-[0_12px_30px_rgba(0,0,0,0.32)] backdrop-blur-md sm:left-4 sm:top-4"
          aria-hidden="true">
          <div>render {renderFps} fps</div>
          <div>
            matte {mattingStats.fps} fps
            {mattingStats.inputWidth && mattingStats.inputHeight
              ? ` ${mattingStats.inputWidth}x${mattingStats.inputHeight}`
              : ''}
          </div>
          <div>{mattingStats.inferenceMs ? `${mattingStats.inferenceMs} ms` : 'warming up'}</div>
          {mattingStats.modelMs ? (
            <div>
              m {mattingStats.modelMs} / s {mattingStats.snapshotMs} / k {mattingStats.maskMs}
            </div>
          ) : null}
          <div>{mattingStats.backend ? `tfjs ${mattingStats.backend}` : 'tfjs loading'}</div>
          {mattingError ? <div className="max-w-52 truncate text-red-200">{mattingError}</div> : null}
        </div>
      ) : null}
    </div>
  );
});
