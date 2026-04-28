import { useEffect, useRef, useState } from 'react'

const CONTROLS_AUTO_HIDE_MS = 5_000

type ControlsVisibility = 'hidden' | 'preview' | 'open'

interface MirrorControlsLipProps {
  showPosePoints: boolean
  onCapture: () => void
  onTogglePosePoints: () => void
}

export function MirrorControlsLip({
  showPosePoints,
  onCapture,
  onTogglePosePoints,
}: MirrorControlsLipProps) {
  const [visibility, setVisibility] = useState<ControlsVisibility>('hidden')
  const controlsRef = useRef<HTMLDivElement>(null)
  const hideTimeoutRef = useRef<number | null>(null)

  function clearAutoHide() {
    if (hideTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(hideTimeoutRef.current)
    hideTimeoutRef.current = null
  }

  function setTimedVisibility(nextVisibility: ControlsVisibility) {
    setVisibility(nextVisibility)
    clearAutoHide()

    if (nextVisibility !== 'hidden') {
      hideTimeoutRef.current = window.setTimeout(() => {
        setVisibility('hidden')
        hideTimeoutRef.current = null
      }, CONTROLS_AUTO_HIDE_MS)
    }
  }

  function showPreview() {
    if (visibility === 'hidden') {
      setTimedVisibility('preview')
    }
  }

  function toggleControls() {
    setTimedVisibility(visibility === 'open' ? 'hidden' : 'open')
  }

  function getTransform() {
    if (visibility === 'open') {
      return 'translateX(0)'
    }

    if (visibility === 'preview') {
      return 'translateX(calc(100% - 1.125rem))'
    }

    return 'translateX(100%)'
  }

  useEffect(
    () => () => {
      clearAutoHide()
    },
    []
  )

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (visibility === 'hidden') {
        return
      }

      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (controlsRef.current?.contains(target)) {
        return
      }

      setTimedVisibility('hidden')
    }

    document.addEventListener('pointerdown', onDocumentPointerDown)

    return () => {
      document.removeEventListener('pointerdown', onDocumentPointerDown)
    }
  }, [visibility])

  return (
    <div ref={controlsRef} className="pointer-events-none fixed inset-y-0 right-0 z-50">
      <button
        type="button"
        className="pointer-events-auto absolute inset-y-0 right-0 w-6"
        aria-label="Mostrar configuracion"
        onClick={showPreview}
      />

      <div className="absolute right-0 top-1/2 -translate-y-1/2">
        <div
          className="flex items-center transition-transform duration-300 ease-out"
          style={{ transform: getTransform() }}
        >
          {visibility === 'preview' ? (
            <button
              type="button"
              className="pointer-events-auto flex h-28 w-4.5 items-center justify-center rounded-l-full border border-r-0 border-white/18 bg-white/12 text-white/70 shadow-[0_20px_40px_rgba(0,0,0,0.22)] backdrop-blur-md transition hover:bg-white/18 hover:text-white"
              aria-label="Mostrar controles completos"
              onClick={toggleControls}
            >
              <span aria-hidden="true" className="h-14 w-0.5 rounded-full bg-current opacity-80" />
            </button>
          ) : null}

          <section
            className="pointer-events-auto ml-2 flex w-[min(21rem,calc(100vw-2.5rem))] flex-col gap-3 rounded-l-[1.75rem] border border-r-0 border-white/14 bg-[linear-gradient(180deg,rgba(7,20,34,0.82)_0%,rgba(4,12,20,0.94)_100%)] px-4 py-4 shadow-[0_24px_54px_rgba(0,0,0,0.34)] backdrop-blur-xl sm:px-5"
            aria-label="Controles de espejo"
          >
            {!import.meta.env.DEV ? (
              <a
                href={`${import.meta.env.BASE_URL}calibration`}
                className="rounded-full border border-white/14 bg-white/7 px-5 py-3 text-center text-xs font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                Calibration Lab
              </a>
            ) : null}

            <div className="flex flex-col gap-3">
              <button
                type="button"
                onClick={onCapture}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-6 py-3 text-sm font-bold uppercase tracking-[0.18em] text-slate-950 transition hover:scale-[1.01]"
              >
                Capture
              </button>

              <button
                type="button"
                aria-pressed={showPosePoints}
                onClick={onTogglePosePoints}
                className="rounded-full border border-white/14 bg-white/7 px-5 py-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                {showPosePoints ? 'Hide Pose Points' : 'Show Pose Points'}
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
