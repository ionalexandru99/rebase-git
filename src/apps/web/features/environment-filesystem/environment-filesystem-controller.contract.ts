import type { EnvironmentDirectory } from "@rebase/contracts";
import { Data, type Effect } from "effect";
import type { EnvironmentCredential } from "#web/features/environment-connection/environment-credential.contract";
import type { EnvironmentFilesystemClientError } from "#web/features/environment-filesystem/environment-filesystem-client.contract";

export interface EnvironmentFilesystemController {
  readonly listDirectory: (path?: string) => Promise<EnvironmentDirectory>;
}

export interface EnvironmentFilesystemGateway {
  readonly listDirectory: (
    credential: EnvironmentCredential,
    path?: string,
  ) => Effect.Effect<EnvironmentDirectory, EnvironmentFilesystemClientError>;
}

export class EnvironmentFilesystemUnavailable extends Data.TaggedError(
  "EnvironmentFilesystemUnavailable",
) {}

export type EnvironmentFilesystemControllerError =
  | EnvironmentFilesystemClientError
  | EnvironmentFilesystemUnavailable;
