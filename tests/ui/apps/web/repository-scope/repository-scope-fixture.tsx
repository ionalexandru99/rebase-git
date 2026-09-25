import {
  type EnvironmentRequestClient,
  environmentHttpRoutesClient,
} from "@rebase/environment-client";
import { Effect, Layer, ManagedRuntime } from "effect";
import type { RepositoryScope } from "#web/features/repository-scope/index";
import type { RepositoryTarget } from "#web/features/repository-scope/repository-scope.contract";

const runtime = ManagedRuntime.make(Layer.empty);
const unexpectedRequests: EnvironmentRequestClient = (routes) =>
  environmentHttpRoutesClient(routes, () =>
    Effect.die(new Error("Unexpected repository request")),
  );

export function repositoryScope({
  connected = true,
  readable = true,
  writable = true,
  ...target
}: Partial<RepositoryTarget> & {
  readonly connected?: boolean;
  readonly readable?: boolean;
  readonly writable?: boolean;
} = {}): RepositoryScope {
  return {
    target: {
      repositoryId: "00000000-0000-4000-8000-000000000001",
      worktreePath: "/repo",
      requests: unexpectedRequests,
      changes: { subscribe: () => () => {} },
      refs: {
        apply: () => undefined,
        checkout: async () => {
          throw new Error("Unexpected checkout");
        },
      },
      runtime,
      ...target,
    },
    connected,
    readable,
    writable,
  };
}
