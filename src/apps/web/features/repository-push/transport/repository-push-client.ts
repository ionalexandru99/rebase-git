import { RepositoryPushHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type RepositoryPushClient,
  RepositoryPushError,
} from "#web/features/repository-push/repository-push.contract";

export function repositoryPushClient(
  requests: EnvironmentRequestClient,
): RepositoryPushClient {
  return requests(RepositoryPushHttpApi, {
    disconnected: () =>
      new RepositoryPushError({ reason: "Disconnected", detail: "" }),
    response: (error) =>
      error._tag !== "EnvironmentHttpRejected"
        ? new RepositoryPushError({ reason: "Disconnected", detail: "" })
        : error.failure._tag === "PushRejected"
          ? new RepositoryPushError(error.failure)
          : new RepositoryPushError({ reason: "Denied", detail: "" }),
  });
}
