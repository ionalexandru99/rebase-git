import { EnvironmentFilesystemHttpApi } from "@rebase/contracts";
import type { EnvironmentRequestClient } from "@rebase/environment-client";
import {
  type EnvironmentFilesystemClient,
  EnvironmentFilesystemRejected,
  EnvironmentFilesystemResponseError,
} from "#web/features/environment-filesystem/environment-filesystem-client.contract";
import { effectRoutesClient } from "#web/platform/environment/effect-routes-client";

export function environmentFilesystemClient(
  requests: EnvironmentRequestClient,
): EnvironmentFilesystemClient {
  return effectRoutesClient(requests, EnvironmentFilesystemHttpApi, (error) =>
    error._tag === "EnvironmentResponseError"
      ? new EnvironmentFilesystemResponseError()
      : new EnvironmentFilesystemRejected({ failure: error.failure }),
  );
}
