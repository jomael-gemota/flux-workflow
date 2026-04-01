import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiKeyGate } from './components/ui/ApiKeyGate';
import App from './App';
import '@fontsource-variable/inter';
import './index.css';

// Apply stored theme class to <html> immediately to prevent flash
try {
  const theme = localStorage.getItem('wap_theme') ?? 'dark';
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
} catch { /* ignore */ }

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 10_000,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ApiKeyGate>
        <App />
      </ApiKeyGate>
    </QueryClientProvider>
  </StrictMode>
);
