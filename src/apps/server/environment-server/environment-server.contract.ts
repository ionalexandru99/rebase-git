export interface EnvironmentServerOptions {
  readonly port?: number;
}

export interface EnvironmentServer {
  readonly environmentId: string;
  readonly origin: string;
  readonly port: number;
}
