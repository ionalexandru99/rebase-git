import type {
  GraphCommandContext,
  GraphCommandDefinition,
  GraphCommandDescriptor,
  GraphCommandInvocation,
  GraphCommandRegistry,
} from "#web/features/commit-commands/graph-command.contract";

export function createGraphCommandRegistry<Id extends string>(
  definitions: readonly GraphCommandDefinition<Id>[],
): GraphCommandRegistry<Id> {
  return {
    commands: (context, placement) =>
      definitions
        .flatMap((definition) => {
          if (placement !== undefined && definition.placement !== placement) {
            return [];
          }
          const descriptor = describeCommand(definition, context);
          return descriptor === undefined ? [] : [descriptor];
        })
        .sort((left, right) => left.order - right.order),
    describe: (id, context) => {
      const definition = definitions.find((candidate) => candidate.id === id);
      return definition === undefined
        ? undefined
        : describeCommand(definition, context);
    },
    execute: async (id, context) => {
      const invocation: GraphCommandInvocation | undefined = definitions
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

function describeCommand<Id extends string>(
  definition: GraphCommandDefinition<Id>,
  context: GraphCommandContext,
): GraphCommandDescriptor<Id> | undefined {
  const invocation: GraphCommandInvocation | undefined =
    definition.resolve(context);
  if (invocation === undefined) {
    return undefined;
  }
  const { execute: _, ...presentation } = invocation;
  return {
    id: definition.id,
    group: definition.group,
    order: definition.order,
    placement: definition.placement,
    ...presentation,
  };
}
