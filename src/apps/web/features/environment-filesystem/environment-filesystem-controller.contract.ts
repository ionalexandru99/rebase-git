import type { EnvironmentDirectory } from "@rebase/contracts";
import type { EnvironmentCredential } from "@rebase/environment-client";
import { Data, type Effect } from "effect";
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
