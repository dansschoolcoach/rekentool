import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinancienPage } from '../FinancienPage';
import '../../../index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <main>
      <FinancienPage />
    </main>
  </QueryClientProvider>,
);