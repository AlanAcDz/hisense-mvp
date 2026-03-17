import { createRootRoute, createRoute, createRouter, Outlet } from '@tanstack/react-router';
import { HomeRoute } from '@/routes/home';

function getRouterBasePath() {
  if (import.meta.env.BASE_URL === '/') {
    return '/';
  }

  return import.meta.env.BASE_URL.replace(/\/$/, '');
}

const rootRoute = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_#0b3559_0%,_#04111e_48%,_#01060d_100%)] text-white">
      <Outlet />
    </div>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const routeTree = rootRoute.addChildren([indexRoute]);

export const router = createRouter({
  basepath: getRouterBasePath(),
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});
