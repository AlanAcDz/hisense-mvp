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
  drawStageForegroundLayer,
  getBackgroundGuidance,
  resolveBackgroundMatte,
  syncMatteCanvas,
} from '@/lib/mirror/background/compositor';
import {
  composeCaptureFrame,
  downloadDataUrl,
} from '@/lib/mirror/capture/compose-capture';
import {
  BACKGROUND_LAYER_INTERVAL_MS,
  BACKGROUND_VIDEO_ASSET_URL,
  CAMERA_CAPTURE_FRAME_RATE,
  CAMERA_CAPTURE_HEIGHT_PX,
  CAMERA_CAPTURE_WIDTH_PX,
  DEBUG_FPS_UPDATE_INTERVAL_MS,
  STAGE_RENDER_LONG_EDGE_PX,
  STAGE_RENDER_TARGET_FPS,
  VIDEO_MATTING_ENABLED,
  VIDEO_MATTING_STALE_MS,
} from '@/lib/mirror/constants';
import {
  useRobustVideoMatting,
  type RobustVideoMattingOptions,
} from '@/lib/mirror/matting/use-robust-video-matting';
import { drawPoseOverlay } from '@/lib/mirror/pose/drawing';
import {
  computeTorsoTransform,
  getCoverLayout,
  isTorsoTransformInForegroundScope,
} from '@/lib/mirror/pose/torso';
import {
  usePoseLandmarker,
  type PoseLandmarkerOptions,
} from '@/lib/mirror/pose/use-pose-landmarker';
import type { MirrorSceneState, StageSize } from '@/lib/mirror/types';
const BACKGROUND_VIDEO_LOOP_GUARD_SECONDS = 1 / 24;
const BACKGROUND_VIDEO_LOOP_START_SECONDS = 0.001;
const BACKGROUND_VIDEO_LOOP_HOLD_MS = 40;

export interface MirrorStageHandle {
  capture: () => void;
}

export interface MirrorStageProps {
  showPosePoints: boolean;
  cameraEnabled?: boolean;
  poseLandmarkerOptions?: PoseLandmarkerOptions;
  onStatusChange?: (status: string | null) => void;
  onSubjectDetectedChange?: (detected: boolean) => void;
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

      const nextSize = getStageRenderSize(
        nextEntry.contentRect.width,
        nextEntry.contentRect.height
      );

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

function getStageRenderSize(width: number, height: number): StageSize {
  const roundedWidth = Math.max(0, Math.round(width));
  const roundedHeight = Math.max(0, Math.round(height));
  const longEdge = Math.max(roundedWidth, roundedHeight);

  if (!longEdge || longEdge <= STAGE_RENDER_LONG_EDGE_PX) {
    return {
      width: roundedWidth,
      height: roundedHeight,
    };
  }

  const scale = STAGE_RENDER_LONG_EDGE_PX / longEdge;
  return {
    width: Math.max(1, Math.round(roundedWidth * scale)),
    height: Math.max(1, Math.round(roundedHeight * scale)),
  };
}

function canDrawBackgroundVideoFrame(
  video: HTMLVideoElement | null,
  now: number,
  holdUntilRef: { current: number }
) {
  if (!video) {
    return false;
  }

  if (now < holdUntilRef.current || video.seeking) {
    return false;
  }

  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    return true;
  }

  if (video.duration - video.currentTime > BACKGROUND_VIDEO_LOOP_GUARD_SECONDS) {
    return true;
  }

  try {
    video.currentTime = BACKGROUND_VIDEO_LOOP_START_SECONDS;
    holdUntilRef.current = now + BACKGROUND_VIDEO_LOOP_HOLD_MS;
    if (video.paused) {
      void video.play();
    }
  } catch {
    // Some browsers can reject seeks while media metadata is settling.
  }

  return false;
}

function drawBackgroundVideoLayer(
  ctx: CanvasRenderingContext2D,
  stageSize: StageSize,
  now: number,
  backgroundVideoRef: RefObject<HTMLVideoElement | null>,
  hasBackgroundVideoFrameRef: { current: boolean },
  backgroundVideoHoldUntilRef: { current: number }
) {
  if (
    canDrawBackgroundVideoFrame(
      backgroundVideoRef.current,
      now,
      backgroundVideoHoldUntilRef
    )
  ) {
    drawBackgroundLayer(ctx, stageSize, backgroundVideoRef.current);
    hasBackgroundVideoFrameRef.current = true;
    return;
  }

  if (!hasBackgroundVideoFrameRef.current) {
    drawBackgroundLayer(ctx, stageSize, null);
  }
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

async function requestPreferredCameraResolution(stream: MediaStream) {
  const track = stream.getVideoTracks?.()[0];
  if (!track?.getCapabilities || !track.applyConstraints) {
    return;
  }

  const capabilities = track.getCapabilities();
  const constraints: MediaTrackConstraints = {
    width: getMaxCameraConstraint(capabilities.width, CAMERA_CAPTURE_WIDTH_PX, true),
    height: getMaxCameraConstraint(capabilities.height, CAMERA_CAPTURE_HEIGHT_PX, true),
    frameRate: capabilities.frameRate?.max
      ? { ideal: Math.min(capabilities.frameRate.max, CAMERA_CAPTURE_FRAME_RATE) }
      : { ideal: CAMERA_CAPTURE_FRAME_RATE },
  };

  try {
    await track.applyConstraints(constraints);
  } catch {
    await track.applyConstraints({
      width: getMaxCameraConstraint(capabilities.width, CAMERA_CAPTURE_WIDTH_PX),
      height: getMaxCameraConstraint(capabilities.height, CAMERA_CAPTURE_HEIGHT_PX),
      frameRate: { ideal: CAMERA_CAPTURE_FRAME_RATE },
    });
  }
}

function stopCameraStream(
  streamRef: RefObject<MediaStream | null>,
  videoRef: RefObject<HTMLVideoElement | null>
) {
  streamRef.current?.getTracks().forEach((track) => track.stop());
  streamRef.current = null;

  if (videoRef.current) {
    videoRef.current.pause();
    videoRef.current.srcObject = null;
  }
}

export const MirrorStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function MirrorStage(
  {
    showPosePoints,
    cameraEnabled = true,
    poseLandmarkerOptions,
    onStatusChange,
    onSubjectDetectedChange,
    usePoseLandmarkerRuntime = usePoseLandmarker,
    useVideoMattingRuntime = useRobustVideoMatting,
  },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const backgroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const foregroundCanvasRef = useRef<HTMLCanvasElement>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectAtRef = useRef(0);
  const lastMattingDetectAtRef = useRef(0);
  const lastRenderAtRef = useRef(0);
  const lastBackgroundLayerAtRef = useRef(0);
  const poseOverlayWasVisibleRef = useRef(false);
  const renderFpsRef = useRef({ frames: 0, lastUpdatedAt: 0 });
  const subjectDetectedRef = useRef(false);
  const backgroundVideoRef = useRef<HTMLVideoElement | null>(null);
  const hasBackgroundVideoFrameRef = useRef(false);
  const backgroundVideoHoldUntilRef = useRef(0);
  const matteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const syncedMatteTimestampRef = useRef<number | null>(null);
  const lastGoodMatteRef = useRef<ReturnType<typeof resolveBackgroundMatte>['matte']>(null);
  const [sceneState, setSceneState] = useState<MirrorSceneState>({
    cameraError: null,
    poseError: null,
    poseModelLoading: true,
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
    backgroundVideo.loop = false;
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
      hasBackgroundVideoFrameRef.current = false;
      backgroundVideoHoldUntilRef.current = 0;
    };
  }, []);

  useEffect(() => {
    setSceneState((previous) => ({
      ...previous,
      poseModelLoading,
      poseError,
    }));
  }, [poseError, poseModelLoading]);

  useEffect(() => {
    let cancelled = false;

    if (!cameraEnabled) {
      syncSubjectDetected(false);
      stopCameraStream(streamRef, videoRef);
      setSceneState((previous) =>
        previous.cameraError === null
          ? previous
          : {
              ...previous,
              cameraError: null,
            }
      );
      return;
    }

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: 'user',
            width: { ideal: CAMERA_CAPTURE_WIDTH_PX },
            height: { ideal: CAMERA_CAPTURE_HEIGHT_PX },
            frameRate: { ideal: CAMERA_CAPTURE_FRAME_RATE },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        await requestPreferredCameraResolution(stream);

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
      stopCameraStream(streamRef, videoRef);
    };
  }, [cameraEnabled]);

  useEffect(() => {
    const backgroundCanvas = backgroundCanvasRef.current;
    const foregroundCanvas = foregroundCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;

    if (
      !backgroundCanvas ||
      !foregroundCanvas ||
      !poseCanvas ||
      !stageSize.width ||
      !stageSize.height
    ) {
      return;
    }

    backgroundCanvas.width = stageSize.width;
    backgroundCanvas.height = stageSize.height;
    foregroundCanvas.width = stageSize.width;
    foregroundCanvas.height = stageSize.height;
    poseCanvas.width = stageSize.width;
    poseCanvas.height = stageSize.height;
  }, [stageSize]);

  useEffect(() => {
    const videoElement = videoRef.current;
    const backgroundCanvas = backgroundCanvasRef.current;
    const foregroundCanvas = foregroundCanvasRef.current;
    const poseCanvas = poseCanvasRef.current;

    if (
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
    if (
      !backgroundContext ||
      !foregroundContext ||
      !poseContext
    ) {
      return;
    }

    const renderFrame = (now: number) => {
      const targetRenderIntervalMs = 1000 / STAGE_RENDER_TARGET_FPS;
      if (lastRenderAtRef.current && now - lastRenderAtRef.current < targetRenderIntervalMs) {
        animationFrameRef.current = window.requestAnimationFrame(renderFrame);
        return;
      }

      lastRenderAtRef.current = now;
      updateRenderFps(now);

      const currentVideo = videoRef.current;
      const currentBackgroundCanvas = backgroundCanvasRef.current;
      const currentForegroundCanvas = foregroundCanvasRef.current;
      const currentPoseCanvas = poseCanvasRef.current;

      if (
        !currentVideo ||
        !currentBackgroundCanvas ||
        !currentForegroundCanvas ||
        !currentPoseCanvas
      ) {
        return;
      }

      const currentBackgroundContext = backgroundContext;
      const currentForegroundContext = foregroundContext;
      const currentPoseContext = poseContext;

      if (!cameraEnabled || !currentVideo.videoWidth || !currentVideo.videoHeight) {
        syncSubjectDetected(false);
        drawBackgroundVideoLayer(
          currentBackgroundContext,
          stageSize,
          now,
          backgroundVideoRef,
          hasBackgroundVideoFrameRef,
          backgroundVideoHoldUntilRef
        );
        clearCanvas(currentForegroundCanvas, stageSize);
        lastBackgroundLayerAtRef.current = 0;
        currentPoseContext.clearRect(0, 0, stageSize.width, stageSize.height);
        poseOverlayWasVisibleRef.current = false;

        setSceneState((previous) =>
          previous.backgroundMode === 'loading' && previous.backgroundGuidance === null
            ? previous
            : {
                ...previous,
                backgroundMode: 'loading',
                backgroundGuidance: null,
              }
        );

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
      const nextMattingFrameIsFresh = Boolean(
        VIDEO_MATTING_ENABLED &&
        nextMattingFrame &&
        now - nextMattingFrame.timestamp <= VIDEO_MATTING_STALE_MS
      );
      const nextMattingMaskCanvas =
        nextMattingFrameIsFresh && nextMattingFrame ? nextMattingFrame.maskCanvas : null;
      const nextMattingSourceCanvas =
        nextMattingFrameIsFresh && nextMattingFrame ? nextMattingFrame.sourceCanvas : null;

      if (showPosePoints) {
        drawPoseOverlay(currentPoseContext, nextPoseFrame, stageSize, coverLayout, true);
        poseOverlayWasVisibleRef.current = true;
      } else if (poseOverlayWasVisibleRef.current) {
        currentPoseContext.clearRect(0, 0, stageSize.width, stageSize.height);
        poseOverlayWasVisibleRef.current = false;
      }

      const detectedTorsoTransform = computeTorsoTransform(nextPoseFrame, stageSize, coverLayout);
      const torsoTransform = isTorsoTransformInForegroundScope(detectedTorsoTransform, stageSize)
        ? detectedTorsoTransform
        : null;
      syncSubjectDetected(Boolean(torsoTransform));

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

      if (torsoTransform && (foregroundMaskCanvas || nextMattingSourceCanvas)) {
        if (
          !lastBackgroundLayerAtRef.current ||
          now - lastBackgroundLayerAtRef.current >= BACKGROUND_LAYER_INTERVAL_MS
        ) {
          drawBackgroundVideoLayer(
            currentBackgroundContext,
            stageSize,
            now,
            backgroundVideoRef,
            hasBackgroundVideoFrameRef,
            backgroundVideoHoldUntilRef
          );
          lastBackgroundLayerAtRef.current = now;
        }

        if (nextMattingSourceCanvas) {
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
        if (
          !lastBackgroundLayerAtRef.current ||
          now - lastBackgroundLayerAtRef.current >= BACKGROUND_LAYER_INTERVAL_MS
        ) {
          drawBackgroundVideoLayer(
            currentBackgroundContext,
            stageSize,
            now,
            backgroundVideoRef,
            hasBackgroundVideoFrameRef,
            backgroundVideoHoldUntilRef
          );
          lastBackgroundLayerAtRef.current = now;
        }
        currentForegroundContext.clearRect(0, 0, stageSize.width, stageSize.height);

        const guidance = getBackgroundGuidance(
          Boolean(torsoTransform),
          Boolean(nextMattingSourceCanvas || nextMattingMaskCanvas || nextSegmentationFrame),
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

      animationFrameRef.current = window.requestAnimationFrame(renderFrame);
    };

    animationFrameRef.current = window.requestAnimationFrame(renderFrame);

    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [cameraEnabled, detectFrame, detectMattingFrame, onSubjectDetectedChange, showPosePoints, stageSize]);

  useImperativeHandle(
    ref,
    () => ({
      capture() {
        const backgroundCanvas = backgroundCanvasRef.current;
        const foregroundCanvas = foregroundCanvasRef.current;
        const poseCanvas = poseCanvasRef.current;

        if (!foregroundCanvas || !stageSize.width || !stageSize.height) {
          return;
        }

        const outputWidth = Math.round(stageSize.width * Math.min(window.devicePixelRatio || 1, 2));
        const outputHeight = Math.round(stageSize.height * Math.min(window.devicePixelRatio || 1, 2));
        const dataUrl = composeCaptureFrame({
          backgroundCanvas,
          foregroundCanvas,
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
        className="pointer-events-none absolute inset-0 z-0 h-full w-full"
      />
      <canvas
        ref={foregroundCanvasRef}
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
      />
      <canvas
        ref={poseCanvasRef}
        className="pointer-events-none absolute inset-0 z-40 h-full w-full"
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
