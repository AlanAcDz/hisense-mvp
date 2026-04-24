import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { AppShell } from '@/components/app-shell';
import { CalibrationRoute } from '@/routes/calibration';
import { HomeRoute } from '@/routes/home';

function getRouterBasePath() {
  if (import.meta.env.BASE_URL === '/') {
    return '/';
  }

  return import.meta.env.BASE_URL.replace(/\/$/, '');
}

const rootRoute = createRootRoute({
  component: AppShell,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomeRoute,
});

const calibrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calibration',
  component: CalibrationRoute,
});

const routeTree = rootRoute.addChildren([indexRoute, calibrationRoute]);

export const router = createRouter({
  basepath: getRouterBasePath(),
  routeTree,
  defaultPreload: 'intent',
  scrollRestoration: true,
});
