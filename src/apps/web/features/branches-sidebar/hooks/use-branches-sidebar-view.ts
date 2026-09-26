import { useState } from "react";
import type { BranchesSidebarView } from "#web/features/branches-sidebar/branches-sidebar-model";

const storageKey = "rebase:branches-view:v1";

export function useBranchesSidebarView() {
  const [view, setView] = useState<BranchesSidebarView>(readView);
  const changeView = (next: BranchesSidebarView) => {
    setView(next);
    try {
      localStorage.setItem(storageKey, next);
    } catch {
      return;
    }
  };
  return [view, changeView] as const;
}

function readView(): BranchesSidebarView {
  try {
    return localStorage.getItem(storageKey) === "linear" ? "linear" : "tree";
  } catch {
    return "tree";
  }
}
