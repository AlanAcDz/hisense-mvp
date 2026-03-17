import {
  type RefObject,
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { composeCaptureFrame, downloadDataUrl } from '@/lib/mirror/capture/compose-capture';
import { drawPoseOverlay } from '@/lib/mirror/pose/drawing';
import { computeSleeveTransform, computeTorsoTransform, getCoverLayout } from '@/lib/mirror/pose/torso';
import { usePoseLandmarker } from '@/lib/mirror/pose/use-pose-landmarker';
import { ShirtSceneController } from '@/lib/mirror/three/shirt-scene';
import type { MirrorSceneState, StageSize } from '@/lib/mirror/types';

export interface MirrorStageHandle {
  capture: () => void;
}

export interface MirrorStageProps {
  showPosePoints: boolean;
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

export const MirrorStage = forwardRef<MirrorStageHandle, MirrorStageProps>(function MirrorStage(
  { showPosePoints },
  ref
) {
  const stageRef = useRef<HTMLDivElement>(null);
  const visualLayerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const poseCanvasRef = useRef<HTMLCanvasElement>(null);
  const animationFrameRef = useRef<number | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lastDetectAtRef = useRef(0);
  const sceneControllerRef = useRef<ShirtSceneController | null>(null);
  const [sceneState, setSceneState] = useState<MirrorSceneState>({
    cameraError: null,
    poseError: null,
    poseModelLoading: true,
    shirtAssetLoading: true,
    shirtAssetError: null,
  });

  const { detectFrame, error: poseError, isLoading: poseModelLoading } = usePoseLandmarker();
  const stageSize = useStageSize(stageRef);
  const statusLines = useMemo(
    () =>
      [
        sceneState.cameraError,
        poseModelLoading ? 'Loading pose model...' : null,
        poseError ?? sceneState.poseError,
        sceneState.shirtAssetLoading ? 'Loading shirt asset...' : null,
        sceneState.shirtAssetError,
      ].filter(Boolean) as string[],
    [
      poseError,
      poseModelLoading,
      sceneState.cameraError,
      sceneState.poseError,
      sceneState.shirtAssetError,
      sceneState.shirtAssetLoading,
    ]
  );

  useEffect(() => {
    let mounted = true;

    const controller = new ShirtSceneController();
    sceneControllerRef.current = controller;

    if (stageRef.current) {
      controller.canvas.className = 'absolute inset-0 h-full w-full pointer-events-none';
      stageRef.current.appendChild(controller.canvas);
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
    const poseCanvas = poseCanvasRef.current;
    const controller = sceneControllerRef.current;

    if (!poseCanvas || !controller || !stageSize.width || !stageSize.height) {
      return;
    }

    poseCanvas.width = stageSize.width;
    poseCanvas.height = stageSize.height;
    controller.resize(stageSize);
  }, [stageSize]);

  useEffect(() => {
    const controller = sceneControllerRef.current;
    const videoElement = videoRef.current;
    const poseCanvas = poseCanvasRef.current;

    if (!controller || !videoElement || !poseCanvas || !stageSize.width || !stageSize.height) {
      return;
    }

    const poseContext = poseCanvas.getContext('2d');
    if (!poseContext) {
      return;
    }

    const renderFrame = (now: number) => {
      const currentVideo = videoRef.current;
      const currentController = sceneControllerRef.current;
      const currentPoseCanvas = poseCanvasRef.current;

      if (!currentVideo || !currentController || !currentPoseCanvas) {
        return;
      }

      const currentPoseContext = currentPoseCanvas.getContext('2d');
      if (!currentPoseContext) {
        return;
      }

      if (currentVideo.videoWidth && currentVideo.videoHeight) {
        const nextPoseFrame = detectFrame(currentVideo, now, lastDetectAtRef);
        const coverLayout = getCoverLayout(
          {
            width: currentVideo.videoWidth,
            height: currentVideo.videoHeight,
          },
          stageSize
        );

        drawPoseOverlay(currentPoseContext, nextPoseFrame, stageSize, coverLayout, showPosePoints);
        const torsoTransform = computeTorsoTransform(nextPoseFrame, stageSize, coverLayout);
        currentController.updateShirtTransform(torsoTransform);

        if (torsoTransform) {
          currentController.updateSleeves(
            computeSleeveTransform(nextPoseFrame?.leftArm ?? null, torsoTransform, stageSize, coverLayout),
            computeSleeveTransform(nextPoseFrame?.rightArm ?? null, torsoTransform, stageSize, coverLayout)
          );
        } else {
          currentController.updateSleeves(null, null);
        }
      } else {
        currentPoseContext.clearRect(0, 0, stageSize.width, stageSize.height);
        currentController.updateShirtTransform(null);
        currentController.updateSleeves(null, null);
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
        const videoElement = videoRef.current;
        const poseCanvas = poseCanvasRef.current;
        const rendererCanvas = sceneControllerRef.current?.canvas;

        if (!videoElement || !rendererCanvas || !stageSize.width || !stageSize.height) {
          return;
        }

        const outputWidth = Math.round(stageSize.width * Math.min(window.devicePixelRatio || 1, 2));
        const outputHeight = Math.round(stageSize.height * Math.min(window.devicePixelRatio || 1, 2));
        const dataUrl = composeCaptureFrame({
          videoElement,
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
    <div className="flex flex-col gap-4">
      {statusLines.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm text-white/88">
          {statusLines.map((statusLine) => (
            <span
              key={statusLine}
              className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1"
            >
              {statusLine}
            </span>
          ))}
        </div>
      )}

      <div
        ref={stageRef}
        className="glass-outline relative aspect-video overflow-hidden rounded-[2rem] border border-white/10 bg-black/60"
      >
        <div ref={visualLayerRef} className="absolute inset-0">
          <video
            ref={videoRef}
            className="absolute inset-0 h-full w-full scale-x-[-1] object-cover"
            autoPlay
            muted
            playsInline
          />
          <canvas ref={poseCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
        </div>
      </div>
    </div>
  );
});
