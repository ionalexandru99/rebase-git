import type {
  EnvironmentHelloResult,
  EnvironmentRpcClient,
  RepositoryChangeKind,
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
  kind?: RepositoryChangeKind,
) => void;

export interface EnvironmentChanges {
  readonly subscribe: (listener: EnvironmentChangeListener) => () => void;
}
