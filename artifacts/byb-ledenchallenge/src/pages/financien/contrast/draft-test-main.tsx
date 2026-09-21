import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SeasonEditor } from '../SeasonEditor';
import '../../../index.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={queryClient}>
    <main className="p-6">
      <SeasonEditor seasonId={2} onSaved={() => undefined} />
    </main>
  </QueryClientProvider>,
);