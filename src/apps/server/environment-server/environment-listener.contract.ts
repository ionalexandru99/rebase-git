import type { Server } from "node:http";

export interface EnvironmentListener {
  readonly host: string;
  readonly origin: string;
  readonly port: number;
  readonly readiness: { value: boolean };
  readonly server: Server;
}
