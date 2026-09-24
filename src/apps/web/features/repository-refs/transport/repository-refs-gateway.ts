import { Effect } from "effect";
import type { RepositoryRefsClient } from "#web/features/repository-refs/repository-refs-client.contract";
import { RepositoryRefsResponseError } from "#web/features/repository-refs/repository-refs-client.contract";
import type { RepositoryRefsGateway } from "#web/features/repository-refs/repository-refs-controller.contract";
import {
  createRepositoryRefsRpc,
  type RepositoryRefsTransport,
} from "#web/features/repository-refs/transport/repository-refs-rpc";
import type { NegotiatedEnvironmentRpc } from "#web/platform/environment/environment-protocol.contract";

export function createRepositoryRefsGateway(client: RepositoryRefsClient) {
  let transport: RepositoryRefsTransport | undefined;
  const gateway: RepositoryRefsGateway = {
    checkout: (command) => client.checkout(command),
    read: (repositoryId) =>
      Effect.suspend(
        () =>
          transport?.read(repositoryId) ??
          Effect.fail(new RepositoryRefsResponseError()),
      ),
  };
  return {
    connect: (connection: NegotiatedEnvironmentRpc) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          transport = createRepositoryRefsRpc(connection);
        }),
        () =>
          Effect.sync(() => {
            transport = undefined;
          }),
      ),
    gateway,
  };
}
