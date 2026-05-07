import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { MirrorControlsLip } from '@/components/mirror-controls-lip'
import {
  MirrorStage,
  type MirrorStageHandle,
  type MirrorStageProps,
} from '@/components/mirror-stage'
import {
  DEFAULT_SCREENSAVER_OPTION,
  DETECTION_INPUT_LONG_EDGE_PX,
  type DetectionInputLongEdgePx,
  getScreensaverVideoUrl,
  POSE_MODEL_VARIANT,
  type PoseModelVariant,
  type ScreensaverOption,
  SCREENSAVER_OPTIONS,
} from '@/lib/mirror/constants'

const SCREENSAVER_ALTERNATE_MS = 5 * 60_000
const SUBJECT_DETECTION_COUNT_STORAGE_KEY = 'hisense-mvp:subject-detection-count'
const SCREENSAVER_OPTION_STORAGE_KEY = 'hisense-mvp:screensaver-option'

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
  const [subjectDetectionCount, setSubjectDetectionCount] = useState(readSubjectDetectionCount)
  const [showScreensaver, setShowScreensaver] = useState(false)
  const [screensaverOption, setScreensaverOption] =
    useState<ScreensaverOption>(readScreensaverOption)
  const stageRef = useRef<MirrorStageHandle>(null)

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setShowScreensaver((current) => !current)
    }, SCREENSAVER_ALTERNATE_MS)

    return () => window.clearInterval(intervalId)
  }, [])

  const handleScreensaverOptionChange = useCallback((option: ScreensaverOption) => {
    setScreensaverOption(option)
    writeScreensaverOption(option)
  }, [])

  const handleSubjectDetectedChange = useCallback((detected: boolean) => {
    setSubjectDetected(detected)

    if (!detected) {
      return
    }

    setSubjectDetectionCount((currentCount) => {
      const nextCount = currentCount + 1
      writeSubjectDetectionCount(nextCount)
      return nextCount
    })
  }, [])

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      <StageComponent
        ref={stageRef}
        cameraEnabled={!showScreensaver}
        showPosePoints={showPosePoints}
        poseLandmarkerOptions={{
          modelVariant: poseModelVariant,
          inputLongEdgePx: detectionInputLongEdgePx,
        }}
        onSubjectDetectedChange={handleSubjectDetectedChange}
      />

      {showScreensaver ? (
        <video
          key={screensaverOption}
          className="pointer-events-none absolute inset-0 z-30 h-full w-full object-cover"
          src={getScreensaverVideoUrl(screensaverOption)}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
        />
      ) : null}

      {!subjectDetected && !showScreensaver ? (
        <section className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-6 pb-[max(2rem,env(safe-area-inset-bottom))]">
          <p className="max-w-[18rem] text-center text-2xl font-semibold leading-relaxed text-white [text-shadow:_0_2px_12px_rgba(0,0,0,0.65)] sm:max-w-[22rem] sm:text-3xl lg:max-w-[26rem] lg:text-[2.6rem]">
            Colócate frente a la pantalla para comenzar la experiencia
          </p>
        </section>
      ) : null}

      <MirrorControlsLip
        showPosePoints={showPosePoints}
        subjectDetectionCount={subjectDetectionCount}
        poseModelVariant={poseModelVariant}
        detectionInputLongEdgePx={detectionInputLongEdgePx}
        screensaverOption={screensaverOption}
        onCapture={() => stageRef.current?.capture()}
        onTogglePosePoints={() => setShowPosePoints((current) => !current)}
        onPoseModelVariantChange={setPoseModelVariant}
        onDetectionInputLongEdgePxChange={setDetectionInputLongEdgePx}
        onScreensaverOptionChange={handleScreensaverOptionChange}
      />
    </main>
  )
}

function readSubjectDetectionCount() {
  if (typeof window === 'undefined') {
    return 0
  }

  const storedCount = Number(window.localStorage.getItem(SUBJECT_DETECTION_COUNT_STORAGE_KEY))
  return Number.isFinite(storedCount) && storedCount >= 0 ? Math.floor(storedCount) : 0
}

function writeSubjectDetectionCount(count: number) {
  window.localStorage.setItem(SUBJECT_DETECTION_COUNT_STORAGE_KEY, String(count))
}

function readScreensaverOption(): ScreensaverOption {
  if (typeof window === 'undefined') {
    return DEFAULT_SCREENSAVER_OPTION
  }

  const stored = Number(window.localStorage.getItem(SCREENSAVER_OPTION_STORAGE_KEY))
  return (SCREENSAVER_OPTIONS as readonly number[]).includes(stored)
    ? (stored as ScreensaverOption)
    : DEFAULT_SCREENSAVER_OPTION
}

function writeScreensaverOption(option: ScreensaverOption) {
  window.localStorage.setItem(SCREENSAVER_OPTION_STORAGE_KEY, String(option))
}
