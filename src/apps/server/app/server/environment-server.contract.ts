import type { Server as HttpServer } from "node:http";
import type { EnvironmentFeature } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentEventPublisher } from "#server/domain/environment-event-publisher.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";

export interface EnvironmentServerOptions {
  readonly browserAssetsRoot?: string;
  readonly host?: string;
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
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly features: readonly EnvironmentFeature[];
  readonly host?: string;
  readonly port?: number;
  readonly productVersion: string;
}
