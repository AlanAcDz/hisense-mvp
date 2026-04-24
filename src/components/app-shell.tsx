import { Outlet } from '@tanstack/react-router';
import { PwaPrompt } from '@/components/pwa-prompt';

export function AppShell() {
  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0b3559_0%,_#04111e_48%,_#01060d_100%)] text-white">
      <Outlet />
      <PwaPrompt />
    </div>
  );
}
