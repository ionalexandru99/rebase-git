import type { Server as HttpServer } from "node:http";

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
