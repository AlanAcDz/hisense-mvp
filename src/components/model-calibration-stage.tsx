import { type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { ShirtSceneController } from '@/lib/mirror/three/shirt-scene'
import {
  buildCalibrationPreviewScene,
  type CalibrationPreviewPose,
} from '@/lib/mirror/calibration'
import type {
  RigCalibration,
  ShirtCalibration,
  StageSize,
} from '@/lib/mirror/types'

type CalibrationSceneControllerRuntime = Pick<
  ShirtSceneController,
  | 'canvas'
  | 'dispose'
  | 'loadShirtModel'
  | 'render'
  | 'resize'
  | 'setCalibrations'
  | 'setJerseyOpacity'
  | 'updateRigPose'
  | 'updateShirtTransform'
>

const DEFAULT_CREATE_SCENE_CONTROLLER = () => new ShirtSceneController()
export interface ModelCalibrationStageProps {
  shirtCalibration: ShirtCalibration
  rigCalibration: RigCalibration
  garmentOpacity: number
  pose: CalibrationPreviewPose
  onStatusChange?: (status: string | null) => void
  createSceneController?: () => CalibrationSceneControllerRuntime
}

function useStageSize(stageRef: RefObject<HTMLDivElement | null>) {
  const [stageSize, setStageSize] = useState<StageSize>({ width: 0, height: 0 })

  useEffect(() => {
    if (!stageRef.current) {
      return
    }

    const observer = new ResizeObserver((entries) => {
      const nextEntry = entries[0]
      if (!nextEntry) {
        return
      }

      const nextSize = {
        width: Math.round(nextEntry.contentRect.width),
        height: Math.round(nextEntry.contentRect.height),
      }

      setStageSize((previous) => {
        if (previous.width === nextSize.width && previous.height === nextSize.height) {
          return previous
        }

        return nextSize
      })
    })

    observer.observe(stageRef.current)

    return () => observer.disconnect()
  }, [stageRef])

  return stageSize
}

export function ModelCalibrationStage({
  shirtCalibration,
  rigCalibration,
  garmentOpacity,
  pose,
  onStatusChange,
  createSceneController = DEFAULT_CREATE_SCENE_CONTROLLER,
}: ModelCalibrationStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const shirtLayerRef = useRef<HTMLDivElement>(null)
  const sceneControllerRef = useRef<CalibrationSceneControllerRuntime | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>('Loading jersey assets...')
  const [assetsLoaded, setAssetsLoaded] = useState(false)
  const stageSize = useStageSize(stageRef)

  const previewScene = useMemo(
    () =>
      buildCalibrationPreviewScene(
        stageSize,
        pose,
        shirtCalibration,
      ),
    [pose, shirtCalibration, stageSize],
  )

  useEffect(() => {
    onStatusChange?.(statusMessage)
  }, [onStatusChange, statusMessage])

  useEffect(() => {
    let mounted = true

    const controller = createSceneController()
    sceneControllerRef.current = controller

    if (shirtLayerRef.current) {
      controller.canvas.className = 'absolute inset-0 h-full w-full pointer-events-none'
      shirtLayerRef.current.appendChild(controller.canvas)
    }

    async function loadModels() {
      const result = await controller.loadShirtModel()
      if (!mounted) {
        return
      }

      setAssetsLoaded(true)
      setStatusMessage(result.errorMessage)
    }

    void loadModels()

    return () => {
      mounted = false
      controller.dispose()
      controller.canvas.remove()
      sceneControllerRef.current = null
    }
  }, [createSceneController])

  useEffect(() => {
    const controller = sceneControllerRef.current
    if (!controller || !assetsLoaded || !previewScene || !stageSize.width || !stageSize.height) {
      return
    }

    controller.resize(stageSize)
    controller.setCalibrations(shirtCalibration, rigCalibration)
    controller.setJerseyOpacity(garmentOpacity)
    controller.updateShirtTransform(previewScene.torsoTransform)
    controller.updateRigPose(previewScene.rigPose)
    controller.render()
  }, [
    assetsLoaded,
    garmentOpacity,
    previewScene,
    rigCalibration,
    shirtCalibration,
    stageSize,
  ])

  return (
    <div
      ref={stageRef}
      className="relative h-full min-h-[28rem] max-h-full overflow-hidden rounded-[2rem] border border-white/12 bg-[radial-gradient(circle_at_top,_rgba(70,188,255,0.22)_0%,_rgba(9,25,38,0.96)_45%,_rgba(4,8,16,1)_100%)] shadow-[0_32px_100px_rgba(0,0,0,0.45)]"
    >
      <div className="absolute inset-0 bg-[linear-gradient(transparent_0,_transparent_calc(100%-1px),rgba(255,255,255,0.05)_calc(100%-1px)),linear-gradient(90deg,transparent_0,transparent_calc(100%-1px),rgba(255,255,255,0.04)_calc(100%-1px))] bg-[size:100%_3.5rem,3.5rem_100%] opacity-35" />
      <div ref={shirtLayerRef} className="absolute inset-0" />

      {previewScene ? (
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox={`0 0 ${stageSize.width} ${stageSize.height}`}
          preserveAspectRatio="none"
        >
          <polygon
            points={previewScene.overlay.torsoPolygon.map((point) => `${point.x},${point.y}`).join(' ')}
            fill="rgba(79, 217, 255, 0.06)"
            stroke="rgba(93, 222, 255, 0.8)"
            strokeWidth="2"
          />
          <line
            x1={previewScene.overlay.leftShoulder.x}
            y1={previewScene.overlay.leftShoulder.y}
            x2={previewScene.overlay.leftElbow.x}
            y2={previewScene.overlay.leftElbow.y}
            stroke="rgba(255,255,255,0.8)"
            strokeWidth="2"
          />
          <line
            x1={previewScene.overlay.rightShoulder.x}
            y1={previewScene.overlay.rightShoulder.y}
            x2={previewScene.overlay.rightElbow.x}
            y2={previewScene.overlay.rightElbow.y}
            stroke="rgba(255,255,255,0.8)"
            strokeWidth="2"
          />
          <circle
            cx={previewScene.overlay.leftShoulder.x}
            cy={previewScene.overlay.leftShoulder.y}
            r="6"
            fill="#57d6ff"
          />
          <circle
            cx={previewScene.overlay.rightShoulder.x}
            cy={previewScene.overlay.rightShoulder.y}
            r="6"
            fill="#57d6ff"
          />
          <circle
            cx={previewScene.overlay.leftElbow.x}
            cy={previewScene.overlay.leftElbow.y}
            r="6"
            fill="#57d6ff"
            opacity="0.9"
          />
          <circle
            cx={previewScene.overlay.rightElbow.x}
            cy={previewScene.overlay.rightElbow.y}
            r="6"
            fill="#57d6ff"
            opacity="0.9"
          />
        </svg>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between px-5 pb-5 text-[0.7rem] uppercase tracking-[0.24em] text-cyan-100/75">
        <span>Static Model Preview</span>
        <span>{statusMessage ?? 'Assets ready'}</span>
      </div>
    </div>
  )
}
