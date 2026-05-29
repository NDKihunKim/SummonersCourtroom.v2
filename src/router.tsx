import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { DefaultErrorComponent } from "@/components/DefaultErrorComponent";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  // Fresh per-request QueryClient — prevents cache leaking across SSR requests.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { staleTime: 60_000, retry: 1 } },
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultErrorComponent,
  });

  return router;
};
