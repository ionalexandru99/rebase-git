import { type QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layer, ManagedRuntime } from "effect";
import type { ReactNode } from "react";
import { afterEach } from "vite-plus/test";
import {
  cleanup,
  type RenderOptions,
  render as renderComponent,
} from "vitest-browser-react";
import { fakeRequests, idleOperation } from "#tests-ui/runtime/fake-requests";
import { createEnvironmentQueryClient } from "#web/platform/query/environment-query-client";
import { ApplicationRuntime } from "#web-ui/platform/effect/application-runtime-context";
import {
  type Environment,
  EnvironmentProvider,
} from "#web-ui/platform/query/environment-context";

const runtimes = new Set<ManagedRuntime.ManagedRuntime<never, never>>();
const queryClients = new Set<QueryClient>();

afterEach(async () => {
  await cleanup();
  for (const queryClient of queryClients) queryClient.clear();
  queryClients.clear();
  await Promise.all([...runtimes].map((runtime) => runtime.dispose()));
  runtimes.clear();
});

export function render(
  children: ReactNode,
  {
    runtime = ManagedRuntime.make(Layer.empty),
    environment = {},
    queryClient = createEnvironmentQueryClient(),
    ...options
  }: RenderOptions & {
    runtime?: ManagedRuntime.ManagedRuntime<never, never>;
    environment?: Partial<Environment>;
    queryClient?: QueryClient;
  } = {},
) {
  const value = testEnvironment(environment);
  runtimes.add(runtime);
  queryClients.add(queryClient);
  const Wrapper = options.wrapper;
  return renderComponent(children, {
    ...options,
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <ApplicationRuntime value={runtime}>
          <EnvironmentProvider environment={value}>
            {Wrapper === undefined ? children : <Wrapper>{children}</Wrapper>}
          </EnvironmentProvider>
        </ApplicationRuntime>
      </QueryClientProvider>
    ),
  });
}

const unchanged = { subscribe: () => () => {} };

export function testEnvironment(
  environment: Partial<Environment> = {},
): Environment {
  return {
    environmentId: "00000000-0000-4000-8000-000000000100",
    requests: fakeRequests(idleOperation),
    rpc: undefined,
    changes: unchanged,
    connected: true,
    readable: true,
    writable: true,
    ...environment,
  };
}
