import type { ForwardRefExoticComponent, RefAttributes } from 'react'
import { useRef, useState } from 'react'
import {
  MirrorStage,
  type MirrorStageHandle,
  type MirrorStageProps,
} from '@/components/mirror-stage'

const FOCUS_SLEEVES_TORSO_OPACITY = 0.35

type MirrorStageComponent = ForwardRefExoticComponent<
  MirrorStageProps & RefAttributes<MirrorStageHandle>
>

interface MirrorPageProps {
  StageComponent?: MirrorStageComponent
}

export function MirrorPage({ StageComponent = MirrorStage }: MirrorPageProps) {
  const [jerseyOpacity, setJerseyOpacity] = useState(1)
  const [showPosePoints, setShowPosePoints] = useState(false)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)
  const stageRef = useRef<MirrorStageHandle>(null)

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex justify-end px-4 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6">
        <a
          href={`${import.meta.env.BASE_URL}calibration`}
          className="pointer-events-auto rounded-full border border-white/14 bg-white/7 px-5 py-3 text-xs font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
        >
          Calibration Lab
        </a>
      </div>

      <StageComponent
        ref={stageRef}
        jerseyOpacity={jerseyOpacity}
        showPosePoints={showPosePoints}
        onStatusChange={setStatusMessage}
      />

      <section className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <div className="pointer-events-auto flex w-full max-w-4xl flex-col gap-3 rounded-[2rem] border border-white/14 bg-[linear-gradient(180deg,rgba(7,20,34,0.76)_0%,rgba(4,12,20,0.9)_100%)] px-4 py-4 shadow-[0_22px_70px_rgba(0,0,0,0.45)] backdrop-blur-xl sm:px-5">
          {statusMessage ? (
            <p className="truncate text-center text-[0.72rem] font-medium uppercase tracking-[0.22em] text-cyan-100/82 sm:text-left">
              {statusMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => stageRef.current?.capture()}
              className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-6 py-3 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 transition hover:scale-[1.01]">
              Capture
            </button>

            <button
              type="button"
              aria-pressed={jerseyOpacity < 1}
              onClick={() =>
                setJerseyOpacity((current) => (current < 1 ? 1 : FOCUS_SLEEVES_TORSO_OPACITY))
              }
              className="rounded-full border border-white/14 bg-white/7 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
            >
              {jerseyOpacity < 1 ? 'Restore Jersey' : 'Focus Sleeves'}
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
    </main>
  )
}
