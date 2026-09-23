import type {
  EnvironmentAccessCapability,
  RepositoryCommit,
} from "@rebase/contracts";

export type GraphCommandEnvironment = Omit<
  GraphCommandContext,
  "selectedOids" | "invokingOid"
>;
export type GraphCommandGroup = "Commit" | "Commit graph";
export type GraphCommandPlacement = "commit-menu" | "toolbar";

export interface GraphCommandContext {
  readonly environmentId: string;
  readonly logicalRepositoryId: string;
  readonly repositoryId: string;
  readonly activeWorktreePath?: string;
  readonly activeBranch?: string;
  readonly selectedOids: readonly string[];
  readonly invokingOid?: string;
  readonly connected: boolean;
  readonly freshnessReady: boolean;
  readonly operationState: "idle" | "fetching" | "busy";
  readonly capabilities: ReadonlySet<EnvironmentAccessCapability>;
}

export interface GraphCommandDescriptor<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly group: GraphCommandGroup;
  readonly order: number;
  readonly placement: GraphCommandPlacement;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}

export interface GraphCommandHandlers {
  readonly openDetails?: (oid: string) => void;
  readonly readCommit: (oid: string) => Promise<RepositoryCommit | undefined>;
  readonly writeClipboard: (text: string) => Promise<void>;
  readonly fetch?: (context: GraphCommandContext) => void | Promise<void>;
}

export type GraphCommandResult =
  | { readonly _tag: "Executed" }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export interface GraphCommandRegistry<Id extends string = string> {
  readonly commands: (
    context: GraphCommandContext,
    placement?: GraphCommandPlacement,
  ) => readonly GraphCommandDescriptor<Id>[];
  readonly describe: (
    id: Id,
    context: GraphCommandContext,
  ) => GraphCommandDescriptor<Id> | undefined;
  readonly execute: (
    id: Id,
    context: GraphCommandContext,
  ) => Promise<GraphCommandResult>;
}

export interface GraphCommandInvocation {
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly execute: () => Promise<GraphCommandResult>;
}

export interface GraphCommandDefinition<Id extends string = string> {
  readonly id: Id;
  readonly group: GraphCommandGroup;
  readonly order: number;
  readonly placement: GraphCommandPlacement;
  readonly resolve: (
    context: GraphCommandContext,
  ) => GraphCommandInvocation | undefined;
}
