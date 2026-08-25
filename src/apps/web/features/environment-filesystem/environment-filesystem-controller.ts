import { Effect } from "effect";
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
  let credential: string | undefined;

  return {
    authorize: (nextCredential: string) => {
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
