import type { Server as HttpServer } from "node:http";
import type { EnvironmentFilesystem } from "#server/domain/environment-filesystem.contract";
import type { RepositoryCatalog } from "#server/domain/repository-catalog.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";

export interface EnvironmentServerOptions {
  readonly browserAssetsRoot?: string;
  readonly port?: number;
}

export interface EnvironmentServer {
  readonly environmentId: string;
  readonly origin: string;
  readonly pairingUrl: string;
  readonly port: number;
}

export interface EnvironmentListener {
  readonly host: string;
  readonly origin: string;
  readonly port: number;
  readonly readiness: { value: boolean };
  readonly server: HttpServer;
}

export interface EnvironmentListenerOptions {
  readonly authorization: EnvironmentAuthorization;
  readonly browserAssetsRoot?: string;
  readonly catalog?: RepositoryCatalog;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly filesystem?: EnvironmentFilesystem;
  readonly port?: number;
  readonly productVersion: string;
}
