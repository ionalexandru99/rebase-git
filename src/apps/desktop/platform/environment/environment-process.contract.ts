import type { EnvironmentServer } from "@rebase/server";

export type EnvironmentProcessMessage =
  | { readonly type: "ready"; readonly server: EnvironmentServer }
  | { readonly type: "failed"; readonly message: string };

export interface EnvironmentProcessCommand {
  readonly type: "stop";
}
