import type {
  RepositoryHistoryRefTarget,
  RepositoryRefTarget,
} from "@rebase/contracts";
import type { KeyboardEvent, RefObject } from "react";
import type {
  GraphCommandEnvironment,
  GraphCommandShortcuts,
  GraphShortcutCommandId,
} from "#web/features/commit-commands/graph-command.contract";
import { useGraphCommands } from "#web/features/commit-commands/use-graph-commands";
import {
  keyboardShortcutAria,
  keyboardShortcutLabel,
  matchesKeyboardShortcut,
} from "#web/features/keyboard-shortcuts/keyboard-shortcuts";
import type {
  RepositoryHistoryQuery,
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import type { RepositoryHistorySearchActions } from "#web/features/repository-history/search/components/repository-history-search-controls.contract";
import { historyLabelTarget } from "#web-ui/features/commit-graph/components/commit-ref-labels";

export function useCommitGraphCommands({
  commandEnvironment,
  shortcuts,
  commandsActive,
  reader,
  historySnapshot,
  fetch,
  navigation,
  activeCommitOid,
  scrollRef,
  searchRef,
  roots,
  onRemoveHistoryRef,
}: {
  readonly commandEnvironment: GraphCommandEnvironment | undefined;
  readonly shortcuts: GraphCommandShortcuts | undefined;
  readonly commandsActive: boolean;
  readonly reader:
    | Pick<RepositoryHistoryReader, "getCommitSummaries">
    | undefined;
  readonly historySnapshot: Pick<
    RepositoryHistorySnapshot,
    "freshness" | "freshnessError"
  >;
  readonly fetch: { readonly fetching: boolean; readonly execute: () => void };
  readonly navigation: {
    readonly selection: { readonly selectedOids: readonly string[] };
    readonly moveInLane: (direction: -1 | 1) => void;
  };
  readonly activeCommitOid: string | undefined;
  readonly scrollRef: RefObject<HTMLTableElement | null>;
  readonly searchRef: RefObject<RepositoryHistorySearchActions | null>;
  readonly roots: RepositoryHistoryQuery["roots"] | undefined;
  readonly onRemoveHistoryRef:
    | ((target: RepositoryRefTarget) => void)
    | undefined;
}) {
  const commands = useGraphCommands({
    environment:
      commandEnvironment === undefined
        ? undefined
        : {
            ...commandEnvironment,
            freshnessReady:
              historySnapshot.freshness !== undefined &&
              historySnapshot.freshnessError === undefined,
            operationState: fetch.fetching
              ? "fetching"
              : commandEnvironment.operationState,
          },
    selectedOids: navigation.selection.selectedOids,
    shortcuts,
    active: commandsActive,
    handlers: {
      readCommit: async (oid) => (await reader?.getCommitSummaries([oid]))?.[0],
      writeClipboard: (text) => navigator.clipboard.writeText(text),
      ...(onRemoveHistoryRef === undefined
        ? {}
        : { toggleHistoryRef: onRemoveHistoryRef }),
      actions: {
        "graph.focus": { execute: () => scrollRef.current?.focus() },
        "graph.previousInLane": { execute: () => navigation.moveInLane(-1) },
        "graph.nextInLane": { execute: () => navigation.moveInLane(1) },
        ...(reader === undefined
          ? {}
          : {
              "graph.search": { execute: () => searchRef.current?.open() },
              "graph.previousMatch": {
                execute: () => searchRef.current?.previous(),
              },
              "graph.nextMatch": { execute: () => searchRef.current?.next() },
              "graph.fetch": { execute: fetch.execute },
            }),
      },
    },
  });
  const binding = (id: GraphShortcutCommandId) => {
    if (shortcuts === undefined) return {};
    const shortcut = keyboardShortcutLabel(
      shortcuts.bindings[id],
      shortcuts.platform,
    );
    const ariaKeyShortcuts = keyboardShortcutAria(
      shortcuts.bindings[id],
      shortcuts.platform,
    );
    return {
      ...(shortcut === "" ? {} : { shortcut }),
      ...(ariaKeyShortcuts === undefined ? {} : { ariaKeyShortcuts }),
    };
  };
  const fetchContext = commands.context();
  const fetchCommand =
    fetchContext === undefined
      ? undefined
      : commands.registry
          .commands(fetchContext)
          .find(({ id }) => id === "graph.fetch");
  const fetchAction = {
    ...binding("graph.fetch"),
    execute: () => {
      void commands.execute("graph.fetch", commands.context());
    },
    disabled: fetchCommand?.enabled !== true,
    ...(fetchCommand?.disabledReason === undefined
      ? {}
      : { disabledReason: fetchCommand.disabledReason }),
  };
  const handleCommandKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (
      event.defaultPrevented ||
      !commandsActive ||
      event.nativeEvent.isComposing
    )
      return;
    const context = commands.context(activeCommitOid);
    if (context === undefined || shortcuts === undefined) return;
    const command = commands.registry
      .commands(context)
      .find(
        (candidate) =>
          candidate.enabled &&
          candidate.shortcutId !== undefined &&
          matchesKeyboardShortcut(
            event,
            shortcuts.bindings[candidate.shortcutId],
            shortcuts.platform,
          ),
      );
    if (command === undefined) return;
    event.preventDefault();
    void commands.execute(command.id, context);
  };
  const refCommandContext = (label: RepositoryHistoryRefTarget) => {
    const target = historyLabelTarget(label);
    return target === undefined
      ? undefined
      : commands.context(undefined, {
          target,
          included: (roots ?? []).some(
            (root) => root.type === label.type && root.name === label.name,
          ),
        });
  };
  return {
    commands,
    binding,
    fetchAction,
    handleCommandKeyDown,
    refCommandContext,
  };
}
