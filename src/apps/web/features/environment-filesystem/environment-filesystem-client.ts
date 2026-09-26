import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type EnvironmentFilesystemClient,
  EnvironmentFilesystemRejected,
  EnvironmentFilesystemResponseError,
} from "#web/features/environment-filesystem/environment-filesystem-client.contract";

export function environmentFilesystemClient(
  requests: EnvironmentRequestClient,
): EnvironmentFilesystemClient {
  return requests(EnvironmentFilesystemHttpApi, {
    disconnected: () => new EnvironmentFilesystemResponseError(),
    response: (error) =>
      error._tag === "EnvironmentResponseError"
        ? new EnvironmentFilesystemResponseError()
        : new EnvironmentFilesystemRejected({ failure: error.failure }),
  });
}
