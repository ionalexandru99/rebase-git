import { Effect } from "effect";
import {
  type EnvironmentFilesystemClientError,
  EnvironmentFilesystemRejected,
  EnvironmentFilesystemResponseError,
} from "#web/features/environment-filesystem/environment-filesystem-client.contract";
import type {
  EnvironmentFilesystemController,
  EnvironmentFilesystemGateway,
} from "#web/features/environment-filesystem/environment-filesystem-controller.contract";

export function createEnvironmentFilesystemController(
  gateway: EnvironmentFilesystemGateway,
): EnvironmentFilesystemController {
  return {
    listDirectory: async (path?: string) => {
      try {
        return await Effect.runPromise(gateway.listDirectory(path));
      } catch (error) {
        throw normalizeControllerError(error);
      }
    },
  };
}

function normalizeControllerError(
  error: unknown,
): EnvironmentFilesystemClientError {
  if (
    error instanceof EnvironmentFilesystemRejected ||
    error instanceof EnvironmentFilesystemResponseError
  ) {
    return error;
  }
  return new EnvironmentFilesystemResponseError();
}
