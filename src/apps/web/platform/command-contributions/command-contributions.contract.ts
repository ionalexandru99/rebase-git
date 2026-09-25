export type CommandResult =
  | { readonly _tag: "Executed" }
  | { readonly _tag: "Unavailable"; readonly reason: string };

export interface CommandInvocation {
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
  readonly execute: () => Promise<CommandResult>;
}

export interface CommandDefinition<Context, Id extends string = string> {
  readonly id: Id;
  readonly order: number;
  readonly resolve: (context: Context) => CommandInvocation | undefined;
}

export interface CommandDescriptor<Id extends string = string> {
  readonly id: Id;
  readonly order: number;
  readonly label: string;
  readonly enabled: boolean;
  readonly disabledReason?: string;
}
