import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import { useEffect, useRef, useState } from 'react'
import { MirrorControlsLip } from '@/components/mirror-controls-lip'
import {
  MirrorStage,
  type MirrorStageHandle,
  type MirrorStageProps,
} from '@/components/mirror-stage'
import {
  DETECTION_INPUT_LONG_EDGE_PX,
  type DetectionInputLongEdgePx,
  POSE_MODEL_VARIANT,
  type PoseModelVariant,
  SCREENSAVER_VIDEO_ASSET_URL,
} from '@/lib/mirror/constants'

const SCREENSAVER_IDLE_MS = 60_000

type MirrorStageComponent = ForwardRefExoticComponent<
  MirrorStageProps & RefAttributes<MirrorStageHandle>
>

interface MirrorPageProps {
  StageComponent?: MirrorStageComponent
}

export function MirrorPage({ StageComponent = MirrorStage }: MirrorPageProps) {
  const [showPosePoints, setShowPosePoints] = useState(false)
  const [poseModelVariant, setPoseModelVariant] = useState<PoseModelVariant>(POSE_MODEL_VARIANT)
  const [detectionInputLongEdgePx, setDetectionInputLongEdgePx] =
    useState<DetectionInputLongEdgePx>(DETECTION_INPUT_LONG_EDGE_PX)
  const [subjectDetected, setSubjectDetected] = useState(false)
  const [showScreensaver, setShowScreensaver] = useState(false)
  const stageRef = useRef<MirrorStageHandle>(null)

  useEffect(() => {
    if (subjectDetected) {
      setShowScreensaver(false)
      return
    }

    const timeoutId = window.setTimeout(() => {
      setShowScreensaver(true)
    }, SCREENSAVER_IDLE_MS)

    return () => window.clearTimeout(timeoutId)
  }, [subjectDetected])

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      <StageComponent
        ref={stageRef}
        jerseyOpacity={1}
        showPosePoints={showPosePoints}
        poseLandmarkerOptions={{
          modelVariant: poseModelVariant,
          inputLongEdgePx: detectionInputLongEdgePx,
        }}
        onSubjectDetectedChange={setSubjectDetected}
      />

      {showScreensaver ? (
        <video
          className="pointer-events-none absolute inset-0 z-30 h-full w-full object-cover"
          src={SCREENSAVER_VIDEO_ASSET_URL}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
      ) : null}

      {!subjectDetected && !showScreensaver ? (
        <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
          <p className="max-w-[18rem] text-center text-2xl font-semibold leading-relaxed text-white [text-shadow:_0_2px_12px_rgba(0,0,0,0.65)] sm:max-w-[22rem] sm:text-3xl lg:max-w-[26rem] lg:text-[2.6rem]">
            Colócate frente a la pantalla para comenzar la experiencia
          </p>
        </section>
      ) : null}

      <MirrorControlsLip
        showPosePoints={showPosePoints}
        poseModelVariant={poseModelVariant}
        detectionInputLongEdgePx={detectionInputLongEdgePx}
        onCapture={() => stageRef.current?.capture()}
        onTogglePosePoints={() => setShowPosePoints((current) => !current)}
        onPoseModelVariantChange={setPoseModelVariant}
        onDetectionInputLongEdgePxChange={setDetectionInputLongEdgePx}
      />
    </main>
  )
}
