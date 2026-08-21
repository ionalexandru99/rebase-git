import type { EnvironmentServer } from "@rebase/server";

export interface ManagedEnvironmentServer extends EnvironmentServer {
  stop(): Promise<void>;
}
