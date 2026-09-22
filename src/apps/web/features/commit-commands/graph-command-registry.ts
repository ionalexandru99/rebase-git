import type {
  GraphCommandContext,
  GraphCommandDescriptor,
  GraphCommandHandlers,
  GraphCommandId,
  GraphCommandRegistry,
  GraphCommandResult,
} from "#web/features/commit-commands/graph-command.contract";

export function createGraphCommandRegistry(
  handlers: GraphCommandHandlers,
): GraphCommandRegistry {
  function commands(
    context: GraphCommandContext,
  ): readonly GraphCommandDescriptor[] {
    const result: GraphCommandDescriptor[] = [];
    if (context.invokingOid !== undefined) {
      if (handlers.openDetails)
        result.push({
          id: "graph.openDetails",
          label: "Open details",
          group: "Commit",
          order: -1,
          enabled:
            context.connected && context.capabilities.has("repository.read"),
        });
      result.push({
        id: "graph.copySha",
        label: "Copy commit SHA",
        group: "Commit",
        order: 0,
        enabled: true,
      });
      result.push({
        id: "graph.copySubject",
        label: "Copy commit subject",
        group: "Commit",
        order: 1,
        enabled: true,
      });
    }
    if (context.ref !== undefined && handlers.toggleHistoryRef !== undefined) {
      result.push({
        id: "history.toggleRef",
        label: context.ref.included ? "Remove from history" : "Add to history",
        group: "History scope",
        order: 10,
        enabled: true,
      });
    }
    if (handlers.fetch !== undefined) {
      const disabledReason = fetchDisabledReason(context);
      result.push({
        id: "graph.fetch",
        label: "Fetch",
        group: "Commit graph",
        order: 20,
        enabled: disabledReason === undefined,
        ...(disabledReason === undefined ? {} : { disabledReason }),
      });
    }
    return result;
  }

  async function execute(
    id: GraphCommandId,
    context: GraphCommandContext,
  ): Promise<GraphCommandResult> {
    const descriptor = commands(context).find((command) => command.id === id);
    if (descriptor === undefined || !descriptor.enabled)
      return {
        _tag: "Unavailable",
        reason:
          descriptor?.disabledReason ?? "This command is unavailable here",
      };
    if (id === "graph.openDetails") {
      if (context.invokingOid !== undefined)
        handlers.openDetails?.(context.invokingOid);
    } else if (id === "graph.copySha" || id === "graph.copySubject") {
      const oid = context.invokingOid;
      if (oid === undefined)
        return { _tag: "Unavailable", reason: "Choose a commit" };
      if (id === "graph.copySha") await handlers.writeClipboard(oid);
      else {
        const commit = await handlers.readCommit(oid);
        if (commit === undefined)
          return {
            _tag: "Unavailable",
            reason: "Commit metadata is not available yet",
          };
        await handlers.writeClipboard(commit.subject);
      }
    } else if (id === "history.toggleRef") {
      if (context.ref !== undefined)
        await handlers.toggleHistoryRef?.(context.ref.target, context);
    } else await handlers.fetch?.(context);
    return { _tag: "Executed" };
  }

  return { commands, execute };
}

function fetchDisabledReason(context: GraphCommandContext): string | undefined {
  if (!context.connected) return "Reconnect to fetch";
  if (!context.capabilities.has("repository.write"))
    return "Repository write access is required";
  if (context.operationState === "fetching")
    return "A fetch is already running";
  if (context.operationState === "busy")
    return "Wait for the current operation to finish";
  if (!context.freshnessReady) return "Waiting for repository status";
  return undefined;
}
