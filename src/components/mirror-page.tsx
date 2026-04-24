import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import { useRef, useState } from 'react'
import {
  MirrorStage,
  type MirrorStageHandle,
  type MirrorStageProps,
} from '@/components/mirror-stage'

type MirrorStageComponent = ForwardRefExoticComponent<
  MirrorStageProps & RefAttributes<MirrorStageHandle>
>

interface MirrorPageProps {
  StageComponent?: MirrorStageComponent
}

export function MirrorPage({ StageComponent = MirrorStage }: MirrorPageProps) {
  const [showPosePoints, setShowPosePoints] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const [subjectDetected, setSubjectDetected] = useState(false)
  const stageRef = useRef<MirrorStageHandle>(null)

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      {import.meta.env.DEV ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-center px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 lg:justify-end">
          <a
            href={`${import.meta.env.BASE_URL}calibration`}
            className="pointer-events-auto rounded-full border border-white/14 bg-white/7 px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
          >
            Calibration Lab
          </a>
        </div>
      ) : null}

      <StageComponent
        ref={stageRef}
        jerseyOpacity={1}
        showPosePoints={showPosePoints}
        onStatusChange={setStatusMessage}
        onSubjectDetectedChange={setSubjectDetected}
      />

      {import.meta.env.DEV ? (
        <section className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <div className="pointer-events-auto flex w-full max-w-[30rem] flex-col gap-3 rounded-[2rem] border border-white/14 bg-[linear-gradient(180deg,rgba(7,20,34,0.76)_0%,rgba(4,12,20,0.9)_100%)] px-4 py-4 shadow-[0_22px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-5 xl:max-w-4xl">
            {statusMessage ? (
              <p className="text-center text-[0.72rem] font-medium uppercase tracking-[0.22em] text-cyan-100/82 xl:text-left">
                {statusMessage}
              </p>
            ) : null}

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <button
                type="button"
                onClick={() => stageRef.current?.capture()}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-6 py-3 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 transition hover:scale-[1.01]">
                Capture
              </button>

              <button
                type="button"
                aria-pressed={showPosePoints}
                onClick={() => setShowPosePoints((current) => !current)}
                className="rounded-full border border-white/14 bg-white/7 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                {showPosePoints ? 'Hide Pose Points' : 'Show Pose Points'}
              </button>
            </div>
          </div>
        </section>
      ) : !subjectDetected ? (
        <section className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-6">
          <p className="max-w-[18rem] text-center text-2xl font-semibold leading-relaxed text-white [text-shadow:_0_2px_12px_rgba(0,0,0,0.65)] sm:max-w-[22rem] sm:text-3xl lg:max-w-[26rem] lg:text-[2.6rem]">
            Colócate frente a la pantalla para comenzar la experiencia
          </p>
        </section>
      ) : null}
    </main>
  )
}
