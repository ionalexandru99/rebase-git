import type {
  EnvironmentHelloResult,
  EnvironmentRpcClient,
} from "@rebase/contracts";

export type NegotiatedEnvironment = Exclude<
  typeof EnvironmentHelloResult.Type,
  { readonly _tag: "HelloRejected" }
>;

export interface NegotiatedEnvironmentRpc {
  readonly negotiated: NegotiatedEnvironment;
  readonly rpc: EnvironmentRpcClient;
}

export type EnvironmentChangeListener = (
  repositoryIds?: readonly string[],
) => void;

export interface EnvironmentChanges {
  readonly subscribe: (listener: EnvironmentChangeListener) => () => void;
}
