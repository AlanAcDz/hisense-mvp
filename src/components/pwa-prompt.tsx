import { usePwaController } from '@/lib/pwa/use-pwa-controller';
import type { PwaControllerState } from '@/lib/pwa/types';

interface PwaPromptProps {
  controller?: PwaControllerState;
}

export function PwaPrompt({ controller }: PwaPromptProps) {
  const defaultController = usePwaController()
  const pwaController = controller ?? defaultController

  if (!pwaController.showInstallPrompt && !pwaController.showUpdatePrompt) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6">
      <div className="flex w-full max-w-sm flex-col gap-3">
        {pwaController.showUpdatePrompt ? (
          <section className="pointer-events-auto panel rounded-[1.75rem] p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/72">
              Update Ready
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-200">
              A newer offline bundle is available for this mirror.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void pwaController.reloadForUpdate()}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-950 transition hover:scale-[1.01]"
              >
                Reload now
              </button>
              <button
                type="button"
                onClick={pwaController.dismissUpdatePrompt}
                className="rounded-full border border-white/14 bg-white/6 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                Later
              </button>
            </div>
          </section>
        ) : null}

        {pwaController.showInstallPrompt ? (
          <section className="pointer-events-auto panel rounded-[1.75rem] p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,0.4)]">
            <p className="text-[0.72rem] font-semibold uppercase tracking-[0.24em] text-cyan-100/72">
              Install App
            </p>
            <p className="mt-2 text-sm leading-6 text-slate-200">
              Install this mirror locally so it launches fullscreen and stays available offline.
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => void pwaController.install()}
                className="rounded-full bg-[linear-gradient(135deg,_var(--hisense-cyan),_var(--hisense-blue))] px-5 py-3 text-sm font-bold uppercase tracking-[0.16em] text-slate-950 transition hover:scale-[1.01]"
              >
                Install
              </button>
              <button
                type="button"
                onClick={pwaController.dismissInstallPrompt}
                className="rounded-full border border-white/14 bg-white/6 px-5 py-3 text-sm font-semibold uppercase tracking-[0.16em] text-white/92 transition hover:border-cyan-200/40 hover:bg-cyan-300/10"
              >
                Dismiss
              </button>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
