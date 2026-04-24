import ReactDOM from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { initializePwaRegistration } from '@/lib/pwa/registration';
import { router } from '@/router';
import '@/styles.css';

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const rootElement = document.getElementById('app');

if (!rootElement) {
  throw new Error('Missing app root element');
}

initializePwaRegistration();

ReactDOM.createRoot(rootElement).render(<RouterProvider router={router} />);
