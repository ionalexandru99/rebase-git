import type { Server as HttpServer } from "node:http";
import type { EnvironmentFeatures } from "#server/adapters/environment-transport/environment-feature.contract";
import type { EnvironmentAuthorization } from "#server/domain/environment-authorization.contract";
import type { EnvironmentEventPublisher } from "#server/domain/environment-event-publisher.contract";

export interface EnvironmentServerOptions {
  readonly browserAssetsRoot?: string;
  readonly host?: string;
  readonly pairingReplacesGrantsWithSameLabel?: boolean;
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
  readonly features: EnvironmentFeatures;
  readonly host?: string;
  readonly port?: number;
  readonly productVersion: string;
}
