import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import { useRef, useState } from 'react';
import {
  MirrorStage,
  type MirrorStageHandle,
  type MirrorStageProps,
} from '@/components/mirror-stage';

type MirrorStageComponent = ForwardRefExoticComponent<
  MirrorStageProps & RefAttributes<MirrorStageHandle>
>;

interface MirrorPageProps {
  StageComponent?: MirrorStageComponent;
}

export function MirrorPage({ StageComponent = MirrorStage }: MirrorPageProps) {
  const [isActive, setIsActive] = useState(false);
  const [showPosePoints, setShowPosePoints] = useState(true);
  const stageRef = useRef<MirrorStageHandle>(null);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl items-center justify-center px-6 py-10">
      {!isActive ? (
        <section className="panel w-full max-w-xl rounded-[2rem] p-10 text-center">
          <div className="mb-8 inline-flex rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-2 text-xs font-medium uppercase tracking-[0.3em] text-cyan-200">
            Hisense AR Mirror MVP
          </div>
          <h1 className="mb-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Start the torso-fit mirror
          </h1>
          <p className="mx-auto mb-10 max-w-lg text-base leading-7 text-white/72">
            This MVP focuses only on live shirt placement. Background replacement stays off while we
            validate torso anchoring, rotation, capture, and calibration.
          </p>
          <button
            type="button"
            onClick={() => setIsActive(true)}
            className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-8 py-4 text-lg font-bold text-slate-950 transition hover:scale-[1.01] hover:shadow-[0_18px_45px_rgba(68,214,255,0.35)]"
          >
            Start Mirror
          </button>
        </section>
      ) : (
        <section className="panel flex w-full flex-col gap-6 rounded-[2rem] p-5 sm:p-7">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.32em] text-cyan-200/80">
                Hisense Mirror
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight text-white">Live shirt projection</h1>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => stageRef.current?.capture()}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-6 py-3 font-semibold text-slate-950"
              >
                Capture
              </button>
              <label className="flex items-center justify-center gap-3 rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-white/90">
                <input
                  aria-label="Show Pose Points"
                  checked={showPosePoints}
                  onChange={(event) => setShowPosePoints(event.target.checked)}
                  type="checkbox"
                  className="h-4 w-4 accent-cyan-300"
                />
                Show Pose Points
              </label>
            </div>
          </div>

          <StageComponent ref={stageRef} showPosePoints={showPosePoints} />
        </section>
      )}
    </main>
  );
}
