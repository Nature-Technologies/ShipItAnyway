import { QueryClient } from '@tanstack/react-query';
import { AxiosError } from 'axios';

// Burst-hardened defaults. Identical in-flight queries are deduped by key, results are
// cached, and focus/mount no longer trigger refetch storms — so duplicating a signed-in
// tab (or any request burst) collapses to a handful of requests instead of hammering the
// rate limiter. Retries skip 4xx (401/429/etc.) so we never pile onto a rate-limited API.
function retry(failureCount: number, error: unknown) {
  const status = error instanceof AxiosError ? error.response?.status : undefined;
  if (status && status >= 400 && status < 500) return false; // client errors: don't retry
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000)
    },
    mutations: {
      retry: false
    }
  }
});
