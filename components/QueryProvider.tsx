"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

// One QueryClient per browser session (stable across re-renders via the useState initializer).
// Defaults are tuned for this app's read-light, local-first data: refetch when the tab regains focus
// or the network reconnects so an overnight tab self-refreshes (the P7 "stale after an overnight tab"
// fix), with a short staleTime so a quick re-focus doesn't refetch needlessly, and a couple of
// retries on transient failures.
export default function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: true,
            refetchOnReconnect: true,
            retry: 2,
          },
        },
      })
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
