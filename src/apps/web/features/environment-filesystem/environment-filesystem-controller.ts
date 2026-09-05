import { Effect } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import {
  EnvironmentFilesystemRejected,
  EnvironmentFilesystemResponseError,
} from "#web/features/environment-filesystem/environment-filesystem-client.contract";
import type {
  EnvironmentFilesystemControllerError,
  EnvironmentFilesystemGateway,
} from "#web/features/environment-filesystem/environment-filesystem-controller.contract";
import { EnvironmentFilesystemUnavailable } from "#web/features/environment-filesystem/environment-filesystem-controller.contract";

export function createEnvironmentFilesystemController(
  gateway: EnvironmentFilesystemGateway,
) {
  let credential: EnvironmentCredential | undefined;

  return {
    authorize: (nextCredential: EnvironmentCredential) => {
      credential = nextCredential;
    },
    controller: {
      listDirectory: async (path?: string) => {
        if (credential === undefined) {
          throw new EnvironmentFilesystemUnavailable();
        }
        try {
          return await Effect.runPromise(
            gateway.listDirectory(credential, path),
          );
        } catch (error) {
          throw normalizeControllerError(error);
        }
      },
    },
  };
}

function normalizeControllerError(
  error: unknown,
): EnvironmentFilesystemControllerError {
  if (
    error instanceof EnvironmentFilesystemRejected ||
    error instanceof EnvironmentFilesystemResponseError ||
    error instanceof EnvironmentFilesystemUnavailable
  ) {
    return error;
  }
  return new EnvironmentFilesystemResponseError();
}
