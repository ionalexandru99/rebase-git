import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach } from "vite-plus/test";
import {
  cleanup,
  type RenderOptions,
  render as renderComponent,
} from "vitest-browser-react";
import { fakeRequests, idleOperation } from "#tests-ui/runtime/fake-requests";
import {
  type Environment,
  EnvironmentProvider,
} from "#web/platform/query/environment-context";
import { createEnvironmentInvalidation } from "#web/platform/query/environment-invalidation";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";

const queryClients = new Set<QueryClient>();

afterEach(async () => {
  await cleanup();
  for (const queryClient of queryClients) queryClient.clear();
  queryClients.clear();
});

export function render(
  children: ReactNode,
  {
    environment = {},
    queryClient = createEnvironmentQueryClient(),
    ...options
  }: RenderOptions & {
    environment?: Partial<Environment>;
    queryClient?: QueryClient;
  } = {},
) {
  const value = testEnvironment(environment);
  queryClients.add(queryClient);
  const Wrapper = options.wrapper;
  return renderComponent(children, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <EnvironmentProvider environment={value}>
          {Wrapper === undefined ? children : <Wrapper>{children}</Wrapper>}
        </EnvironmentProvider>
      </QueryClientProvider>
    ),
  });
}

export function testEnvironment(
  environment: Partial<Environment> = {},
): Environment {
  return {
    environmentId: "00000000-0000-4000-8000-000000000100",
    requests: fakeRequests(idleOperation),
    connected: true,
    readable: true,
    writable: true,
    status: {
      availability: "available",
      connectionState: "Connected",
      detail: "Test environment",
      status: "Available",
    },
    ...environment,
  };
}

export function testChanges(queryClient = createEnvironmentQueryClient()) {
  const invalidation = createEnvironmentInvalidation(queryClient);
  return { queryClient, publish: invalidation.changed };
}
