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
    response: (error) => {
      if (error._tag === "EnvironmentResponseError")
        return new RepositoryPushError({ reason: "Disconnected", detail: "" });
      if (error._tag === "EnvironmentAccessDenied")
        return new RepositoryPushError({ reason: "Denied", detail: "" });
      return new RepositoryPushError({
        reason: error.failure.reason,
        detail: error.failure.detail,
      });
    },
  });
}
