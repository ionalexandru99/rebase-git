import type { Server as HttpServer } from "node:http";
import type { RepositoryFreshnessService } from "#server/domain/repository-freshness.contract";
import type { RepositoryHistoryService } from "#server/domain/repository-history.contract";
import type { RepositoryRefsService } from "#server/domain/repository-refs.contract";
import type { EnvironmentAuthorization } from "#server/features/environment-authorization/environment-authorization.contract";
import type { EnvironmentEventPublisher } from "#server/features/environment-connection/events/environment-event-publisher.contract";
import type { EnvironmentHttpRequestHandler } from "#server/features/environment-connection/http/environment-http-handler.contract";

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
  readonly httpHandlers?: readonly EnvironmentHttpRequestHandler[];
  readonly authorization: EnvironmentAuthorization;
  readonly browserAssetsRoot?: string;
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly host?: string;
  readonly port?: number;
  readonly productVersion: string;
  readonly history?: RepositoryHistoryService;
  readonly freshness?: RepositoryFreshnessService;
  readonly refs?: RepositoryRefsService;
}
