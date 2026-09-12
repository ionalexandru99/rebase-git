import type {
  EnvironmentAccessCapability,
  RepositoryCommit,
  RepositoryRefTarget,
} from "@rebase/contracts";

export type GraphCommandEnvironment = Omit<
  GraphCommandContext,
  "selectedOids" | "invokingOid" | "ref"
>;
export type GraphCommandId =
  | "graph.fetch"
  | "graph.copySha"
  | "graph.copySubject"
  | "history.toggleRef";

export interface GraphCommandContext {
  readonly environmentId: string;
  readonly logicalRepositoryId: string;
  readonly repositoryId: string;
  readonly activeWorktreePath?: string;
  readonly activeBranch?: string;
  readonly selectedOids: readonly string[];
  readonly invokingOid?: string;
  readonly ref?: {
    readonly target: RepositoryRefTarget;
    readonly included: boolean;
  };
  readonly connected: boolean;
  readonly freshnessReady: boolean;
  readonly operationState: "idle" | "fetching" | "busy";
  readonly capabilities: ReadonlySet<EnvironmentAccessCapability>;
}

export interface GraphCommandDescriptor {
  readonly id: GraphCommandId;
  readonly label: string;
  readonly group: "Commit" | "History scope" | "Commit graph";
  readonly order: number;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface GraphCommandHandlers {
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly toggleHistoryRef?: (
    target: RepositoryRefTarget,
    context: GraphCommandContext,
  ) => void | Promise<void>;
  readonly fetch?: (context: GraphCommandContext) => void | Promise<void>;
}

export type GraphCommandResult =
  | { readonly _tag: "Executed" }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export interface GraphCommandRegistry {
  readonly commands: (
    context: GraphCommandContext,
  ) => readonly GraphCommandDescriptor[];
  readonly execute: (
    id: GraphCommandId,
    context: GraphCommandContext,
  ) => Promise<GraphCommandResult>;
}
