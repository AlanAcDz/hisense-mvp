import type { ComponentType, Dispatch, ReactNode, SetStateAction } from 'react'
import { useMemo, useState } from 'react'
import {
  buildCalibrationSnippet,
  cloneShirtCalibration,
  cloneSleeveCalibration,
  DEFAULT_CALIBRATION_PREVIEW_POSE,
  DEFAULT_SLEEVE_OPACITY,
  DEFAULT_TORSO_OPACITY,
  type CalibrationPreviewPose,
} from '@/lib/mirror/calibration'
import {
  SHIRT_CALIBRATION,
  SLEEVE_CALIBRATION,
} from '@/lib/mirror/constants'
import { ModelCalibrationStage, type ModelCalibrationStageProps } from '@/components/model-calibration-stage'
import type { ShirtCalibration, SleeveCalibration } from '@/lib/mirror/types'

type CalibrationStageComponent = ComponentType<ModelCalibrationStageProps>

interface CalibrationPageProps {
  StageComponent?: CalibrationStageComponent
}

export function CalibrationPage({ StageComponent = ModelCalibrationStage }: CalibrationPageProps) {
  const [shirtCalibration, setShirtCalibration] = useState(() => cloneShirtCalibration(SHIRT_CALIBRATION))
  const [sleeveCalibration, setSleeveCalibration] = useState(() => cloneSleeveCalibration(SLEEVE_CALIBRATION))
  const [torsoOpacity, setTorsoOpacity] = useState(DEFAULT_TORSO_OPACITY)
  const [sleeveOpacity, setSleeveOpacity] = useState(DEFAULT_SLEEVE_OPACITY)
  const [pose, setPose] = useState<CalibrationPreviewPose>(DEFAULT_CALIBRATION_PREVIEW_POSE)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const calibrationSnippet = useMemo(
    () =>
      buildCalibrationSnippet({
        shirtCalibration,
        sleeveCalibration,
      }),
    [shirtCalibration, sleeveCalibration],
  )

  async function copySnippet() {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(calibrationSnippet)
      } else {
        throw new Error('Clipboard API unavailable')
      }

      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }
  }

  function resetAll() {
    setShirtCalibration(cloneShirtCalibration(SHIRT_CALIBRATION))
    setSleeveCalibration(cloneSleeveCalibration(SLEEVE_CALIBRATION))
    setTorsoOpacity(DEFAULT_TORSO_OPACITY)
    setSleeveOpacity(DEFAULT_SLEEVE_OPACITY)
    setPose(DEFAULT_CALIBRATION_PREVIEW_POSE)
    setCopyState('idle')
  }

  return (
    <main className="h-screen overflow-y-auto bg-[radial-gradient(circle_at_top,_rgba(60,190,255,0.18)_0%,_rgba(6,16,29,0.96)_42%,_rgba(2,6,12,1)_100%)] text-white xl:overflow-hidden">
      <div className="mx-auto grid max-w-[1700px] gap-4 px-4 py-4 lg:px-6 xl:h-full xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)_30rem] xl:grid-rows-[auto_minmax(0,1fr)] xl:gap-6">
        <header className="panel rounded-[2rem] px-5 py-4 xl:col-span-2">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
                Model Calibration
              </p>
              <h1 className="mt-2 text-2xl font-semibold tracking-[0.02em] text-white sm:text-3xl">
                Static jersey tuning lab
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Adjust the same hardcoded shirt and sleeve settings against a deterministic pose preview,
                then copy the generated constants back into the code.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <a
                href={import.meta.env.BASE_URL}
                className="rounded-full border border-white/14 bg-white/6 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                Live Mirror
              </a>
              <button
                type="button"
                onClick={resetAll}
                className="rounded-full border border-white/14 bg-white/6 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                Reset
              </button>
              <button
                type="button"
                onClick={copySnippet}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-950 transition hover:scale-[1.01]"
              >
                Copy Values
              </button>
            </div>
          </div>
        </header>

        <div className="panel min-h-[28rem] overflow-hidden rounded-[2rem] p-3 sm:p-4 xl:min-h-0">
          <StageComponent
            shirtCalibration={shirtCalibration}
            sleeveCalibration={sleeveCalibration}
            torsoOpacity={torsoOpacity}
            sleeveOpacity={sleeveOpacity}
            pose={pose}
            onStatusChange={setStatusMessage}
          />
        </div>

        <div className="grid min-h-0 min-w-0 gap-4 xl:grid-rows-[auto_auto_minmax(0,1fr)]">
          <section className="panel rounded-[2rem] p-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
              Quick Controls
            </p>
            <div className="mt-4 grid gap-4">
              <NumberSliderControl
                label="Torso Opacity"
                value={torsoOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={setTorsoOpacity}
              />
              <NumberSliderControl
                label="Sleeve Opacity"
                value={sleeveOpacity}
                min={0}
                max={1}
                step={0.01}
                onChange={setSleeveOpacity}
              />
            </div>
          </section>

          <section className="panel rounded-[2rem] p-5">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
              Status
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-300">
              {copyState === 'copied'
                ? 'Current values copied to the clipboard.'
                : copyState === 'failed'
                  ? 'Clipboard copy failed in this browser context.'
                  : statusMessage ?? 'Assets ready.'}
            </p>
          </section>

          <section className="panel flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[2rem] p-5">
            <p className="shrink-0 text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
              Generated Snippet
            </p>
            <pre
              data-testid="calibration-snippet"
              className="mt-4 min-h-0 flex-1 overflow-auto rounded-[1.5rem] border border-white/10 bg-black/30 p-4 text-xs leading-6 text-cyan-50/88"
            >
              {calibrationSnippet}
            </pre>
          </section>
        </div>

        <aside className="panel min-h-0 overflow-y-auto rounded-[2rem] p-5 xl:row-span-2 xl:row-start-1 xl:col-start-3">
          <div className="grid gap-5">
            <ControlSection title="Shirt Calibration">
              <NumberSliderControl
                label="Scale X"
                value={shirtCalibration.scaleX}
                min={0.2}
                max={3}
                step={0.01}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'scaleX', value)}
              />
              <NumberSliderControl
                label="Scale Y"
                value={shirtCalibration.scaleY}
                min={0.2}
                max={3}
                step={0.01}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'scaleY', value)}
              />
              <NumberSliderControl
                label="Scale Z"
                value={shirtCalibration.scaleZ}
                min={0.2}
                max={4}
                step={0.01}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'scaleZ', value)}
              />
              <NumberSliderControl
                label="X Offset"
                value={shirtCalibration.xOffset}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'xOffset', value)}
              />
              <NumberSliderControl
                label="Y Offset"
                value={shirtCalibration.yOffset}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'yOffset', value)}
              />
              <NumberSliderControl
                label="Z Offset"
                value={shirtCalibration.zOffset}
                min={-200}
                max={200}
                step={1}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'zOffset', value)}
              />
              <NumberSliderControl
                label="Depth Scale"
                value={shirtCalibration.depthScale}
                min={0}
                max={300}
                step={1}
                onChange={(value) => updateShirtCalibration(setShirtCalibration, 'depthScale', value)}
              />
              <NumberSliderControl
                label="Base Rot X"
                value={shirtCalibration.baseRotation.x}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateRotation(setShirtCalibration, 'x', value)}
              />
              <NumberSliderControl
                label="Base Rot Y"
                value={shirtCalibration.baseRotation.y}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateRotation(setShirtCalibration, 'y', value)}
              />
              <NumberSliderControl
                label="Base Rot Z"
                value={shirtCalibration.baseRotation.z}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateRotation(setShirtCalibration, 'z', value)}
              />
            </ControlSection>

            <ControlSection title="Sleeve Calibration">
              <NumberSliderControl
                label="Scale X"
                value={sleeveCalibration.scaleX}
                min={0.2}
                max={3}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'scaleX', value)}
              />
              <NumberSliderControl
                label="Scale Y"
                value={sleeveCalibration.scaleY}
                min={0.2}
                max={3}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'scaleY', value)}
              />
              <NumberSliderControl
                label="Scale Z"
                value={sleeveCalibration.scaleZ}
                min={0.2}
                max={3}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'scaleZ', value)}
              />
              <NumberSliderControl
                label="X Offset"
                value={sleeveCalibration.xOffset}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'xOffset', value)}
              />
              <NumberSliderControl
                label="Y Offset"
                value={sleeveCalibration.yOffset}
                min={-1}
                max={1.5}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'yOffset', value)}
              />
              <NumberSliderControl
                label="Line Offset"
                value={sleeveCalibration.lineOffset}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'lineOffset', value)}
              />
              <NumberSliderControl
                label="Z Offset"
                value={sleeveCalibration.zOffset}
                min={-200}
                max={200}
                step={1}
                onChange={(value) => updateSleeveCalibration(setSleeveCalibration, 'zOffset', value)}
              />
              <NumberSliderControl
                label="Left Rot Z"
                value={sleeveCalibration.leftZRotationOffset}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) =>
                  updateSleeveCalibration(setSleeveCalibration, 'leftZRotationOffset', value)
                }
              />
              <NumberSliderControl
                label="Right Rot Z"
                value={sleeveCalibration.rightZRotationOffset}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) =>
                  updateSleeveCalibration(setSleeveCalibration, 'rightZRotationOffset', value)
                }
              />
              <NumberSliderControl
                label="Base Rot X"
                value={sleeveCalibration.baseRotation.x}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateSleeveRotation(setSleeveCalibration, 'x', value)}
              />
              <NumberSliderControl
                label="Base Rot Y"
                value={sleeveCalibration.baseRotation.y}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateSleeveRotation(setSleeveCalibration, 'y', value)}
              />
              <NumberSliderControl
                label="Base Rot Z"
                value={sleeveCalibration.baseRotation.z}
                min={-Math.PI}
                max={Math.PI}
                step={0.01}
                onChange={(value) => updateSleeveRotation(setSleeveCalibration, 'z', value)}
              />
            </ControlSection>

            <ControlSection title="Preview Pose">
              <NumberSliderControl
                label="Torso Center X"
                value={pose.torsoCenterX}
                min={0.2}
                max={0.8}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'torsoCenterX', value)}
              />
              <NumberSliderControl
                label="Torso Center Y"
                value={pose.torsoCenterY}
                min={0.25}
                max={0.85}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'torsoCenterY', value)}
              />
              <NumberSliderControl
                label="Torso Width"
                value={pose.torsoWidth}
                min={0.18}
                max={0.55}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'torsoWidth', value)}
              />
              <NumberSliderControl
                label="Torso Height"
                value={pose.torsoHeight}
                min={0.25}
                max={0.75}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'torsoHeight', value)}
              />
              <NumberSliderControl
                label="Torso Depth"
                value={pose.torsoDepth}
                min={-1}
                max={1}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'torsoDepth', value)}
              />
              <NumberSliderControl
                label="Torso Roll"
                value={pose.torsoRollDeg}
                min={-40}
                max={40}
                step={1}
                onChange={(value) => updatePose(setPose, 'torsoRollDeg', value)}
              />
              <NumberSliderControl
                label="Torso Yaw"
                value={pose.torsoYawDeg}
                min={-40}
                max={40}
                step={1}
                onChange={(value) => updatePose(setPose, 'torsoYawDeg', value)}
              />
              <NumberSliderControl
                label="Arm Length"
                value={pose.armLength}
                min={0.12}
                max={0.45}
                step={0.01}
                onChange={(value) => updatePose(setPose, 'armLength', value)}
              />
              <NumberSliderControl
                label="Left Arm Angle"
                value={pose.leftArmAngleDeg}
                min={-200}
                max={200}
                step={1}
                onChange={(value) => updatePose(setPose, 'leftArmAngleDeg', value)}
              />
              <NumberSliderControl
                label="Right Arm Angle"
                value={pose.rightArmAngleDeg}
                min={-200}
                max={200}
                step={1}
                onChange={(value) => updatePose(setPose, 'rightArmAngleDeg', value)}
              />
            </ControlSection>
          </div>
        </aside>
      </div>
    </main>
  )
}

function ControlSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <p className="text-[0.72rem] font-semibold uppercase tracking-[0.28em] text-cyan-100/72">
        {title}
      </p>
      <div className="mt-4 grid min-w-0 gap-4">{children}</div>
    </section>
  )
}

function NumberSliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
}) {
  return (
    <label className="grid min-w-0 gap-2">
      <div className="flex items-center justify-between gap-3 text-sm text-slate-200">
        <span>{label}</span>
        <span className="font-mono text-xs text-cyan-100/82">{value.toFixed(step >= 1 ? 0 : 3)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full min-w-0 accent-cyan-300"
      />
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full min-w-0 rounded-2xl border border-white/10 bg-white/6 px-3 py-2 text-sm text-white outline-none transition focus:border-cyan-300/50"
      />
    </label>
  )
}

function updateShirtCalibration(
  setCalibration: Dispatch<SetStateAction<ShirtCalibration>>,
  key: Exclude<keyof ShirtCalibration, 'baseRotation'>,
  value: number,
) {
  setCalibration((current) => ({
    ...current,
    [key]: value,
  }))
}

function updateSleeveCalibration(
  setCalibration: Dispatch<SetStateAction<SleeveCalibration>>,
  key: Exclude<keyof SleeveCalibration, 'baseRotation'>,
  value: number,
) {
  setCalibration((current) => ({
    ...current,
    [key]: value,
  }))
}

function updateRotation(
  setCalibration: Dispatch<SetStateAction<ShirtCalibration>>,
  axis: 'x' | 'y' | 'z',
  value: number,
) {
  setCalibration((current) => ({
    ...current,
    baseRotation: {
      ...current.baseRotation,
      [axis]: value,
    },
  }))
}

function updateSleeveRotation(
  setCalibration: Dispatch<SetStateAction<SleeveCalibration>>,
  axis: 'x' | 'y' | 'z',
  value: number,
) {
  setCalibration((current) => ({
    ...current,
    baseRotation: {
      ...current.baseRotation,
      [axis]: value,
    },
  }))
}

function updatePose(
  setPose: Dispatch<SetStateAction<CalibrationPreviewPose>>,
  key: keyof CalibrationPreviewPose,
  value: number,
) {
  setPose((current) => ({
    ...current,
    [key]: value,
  }))
}
