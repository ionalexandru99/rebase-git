import type { PanelViewTarget } from "#web/features/workspace-panel/workspace-panel-session.contract";

export function createPanelViewTarget(element: HTMLElement): PanelViewTarget {
  const listeners = new Set<() => void>();
  return {
    element,
    beforeDetach: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    detach: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}
