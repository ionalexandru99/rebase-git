import type { EnvironmentHelloResult } from "@rebase/contracts";

export type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;
