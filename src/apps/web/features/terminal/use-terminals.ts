import { useCallback, useEffect, useMemo, useState } from "react";
import { TerminalsApi } from "#contracts/terminal/terminal.contract.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useEnvironmentQuery } from "#web/platform/query/environment-query.ts";
import type { RepositoryScope } from "#web/platform/query/repository-scope.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";
import { createStore } from "#web/platform/store/store.ts";
import { useStore } from "#web/platform/store/use-store.ts";

interface TerminalPanelState {
  readonly open: boolean;
  readonly size: number;
  readonly collapsed: boolean;
  readonly active: string | null;
}

const initialState: TerminalPanelState = {
  open: false,
  size: 35,
  collapsed: false,
  active: null,
};
const storagePrefix = "rebase:terminal-panel:v1:";

export type Terminals = ReturnType<typeof useTerminals>;

export function useTerminals(environmentId: string, scope: RepositoryScope) {
  const { repositoryId, worktreePath, logicalRepositoryId } = scope;
  const key = `${storagePrefix}${JSON.stringify([environmentId, logicalRepositoryId, worktreePath])}`;
  const store = useMemo(() => createStore(readPanelState(key)), [key]);
  const state = useStore(store);
  const update = useCallback(
    (change: Partial<TerminalPanelState>) => {
      const next = { ...store.getSnapshot(), ...change };
      store.set(next);
      savePanelState(key, next);
    },
    [key, store],
  );
  const worktree = useMemo(
    () => ({ repositoryId, worktreePath }),
    [repositoryId, worktreePath],
  );
  const list = useEnvironmentQuery(TerminalsApi.list, worktree, {
    changes: "terminals",
  });
  const opening = useCommand(TerminalsApi.open, { changes: "Terminals" });
  const closing = useCommand(TerminalsApi.close, { changes: "Terminals" });
  const errorToast = useErrorToast();
  const [focus, setFocus] = useState(0);
  const terminals = list.data?.terminals ?? [];
  const active =
    terminals.find(({ id }) => id === state.active) ?? terminals[0];
  const empty = list.isSuccess && terminals.length === 0;

  useEffect(() => {
    if (state.open && empty && !opening.running) update({ open: false });
  }, [state.open, empty, opening.running, update]);

  const create = useCallback(async () => {
    const result = await opening.run({ cols: 80, rows: 24 });
    if (result._tag !== "Ok") {
      errorToast.failure("openTerminal", result, {
        TerminalUnavailable: ({ detail }) => detail,
      });
      return;
    }
    update({ open: true, active: result.value.id });
    setFocus((count) => count + 1);
  }, [opening.run, errorToast, update]);

  return {
    worktreePath,
    terminals,
    active: active?.id,
    open: state.open,
    size: state.size,
    collapsed: state.collapsed,
    focus,
    create,
    toggle: () => {
      if (state.open) update({ open: false });
      else if (terminals.length === 0) void create();
      else {
        update({ open: true });
        setFocus((count) => count + 1);
      }
    },
    hide: () => update({ open: false }),
    select: (id: string) => {
      update({ active: id });
      setFocus((count) => count + 1);
    },
    close: (id: string) => void closing.run({ id }),
    collapse: (collapsed: boolean) => update({ collapsed }),
    resize: (size: number) => update({ size }),
  };
}

function readPanelState(key: string): TerminalPanelState {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved === null || typeof saved !== "object") return initialState;
    const value = (name: string) => Reflect.get(saved, name);
    const size = value("size");
    const active = value("active");
    return {
      open: value("open") === true,
      size:
        typeof size === "number" && size >= 5 && size <= 90
          ? size
          : initialState.size,
      collapsed: value("collapsed") === true,
      active: typeof active === "string" ? active : null,
    };
  } catch {
    return initialState;
  }
}

function savePanelState(key: string, state: TerminalPanelState) {
  try {
    localStorage.setItem(key, JSON.stringify(state));
  } catch {}
}
