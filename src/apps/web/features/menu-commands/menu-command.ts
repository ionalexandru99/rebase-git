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

export function createCommandRegistry<Context, Id extends string>(
  definitions: readonly CommandDefinition<Context, Id>[],
) {
  return {
    commands: (context: Context): readonly CommandDescriptor<Id>[] =>
      definitions
        .flatMap((definition) => {
          const descriptor = describeCommand(definition, context);
          return descriptor === undefined ? [] : [descriptor];
        })
        .sort((left, right) => left.order - right.order),
    execute: async (id: Id, context: Context): Promise<CommandResult> => {
      const invocation = definitions
        .find((definition) => definition.id === id)
        ?.resolve(context);
      if (invocation === undefined || !invocation.enabled) {
        return {
          _tag: "Unavailable",
          reason:
            invocation?.disabledReason ?? "This command is unavailable here",
        };
      }
      return invocation.execute();
    },
  };
}

function describeCommand<Context, Id extends string>(
  definition: CommandDefinition<Context, Id>,
  context: Context,
): CommandDescriptor<Id> | undefined {
  const invocation = definition.resolve(context);
  if (invocation === undefined) {
    return undefined;
  }
  const { execute: _, ...presentation } = invocation;
  return { id: definition.id, order: definition.order, ...presentation };
}
