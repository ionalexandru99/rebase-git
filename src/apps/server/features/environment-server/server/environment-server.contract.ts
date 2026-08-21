import type { Server as HttpServer } from "node:http";
import type { EnvironmentEventPublisher } from "@rebase/server/features/environment-connection/events/environment-event-publisher.contract";

export interface EnvironmentServerOptions {
  readonly port?: number;
}

export interface EnvironmentServer {
  readonly environmentId: string;
  readonly origin: string;
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
  readonly environmentId: string;
  readonly events: EnvironmentEventPublisher;
  readonly port?: number;
  readonly productVersion: string;
}
