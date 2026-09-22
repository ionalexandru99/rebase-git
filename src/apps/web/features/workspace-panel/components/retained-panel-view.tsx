import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PanelViewTarget } from "#web/features/workspace-panel/workspace-panel-session.contract";

export function RetainedPanelView({
  children,
  target,
}: {
  readonly children: ReactNode;
  readonly target: PanelViewTarget | undefined;
}) {
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0";
    return element;
  });
  const scrollPositions = useRef<
    readonly {
      readonly element: Element;
      readonly top: number;
      readonly left: number;
    }[]
  >([]);
  useLayoutEffect(() => {
    target?.element.append(container);
    for (const position of scrollPositions.current) {
      if (position.element.isConnected) {
        position.element.scrollTop = position.top;
        position.element.scrollLeft = position.left;
      }
    }
    const capture = () => {
      if (!container.isConnected) {
        return;
      }
      scrollPositions.current = captureScrollPositions(container);
    };
    const unsubscribe = target?.beforeDetach(capture);
    return () => {
      capture();
      unsubscribe?.();
      container.remove();
    };
  }, [container, target]);
  return createPortal(children, container);
}

function captureScrollPositions(container: Element) {
  const positions: {
    readonly element: Element;
    readonly top: number;
    readonly left: number;
  }[] = [];
  const visit = (element: Element) => {
    if (element.scrollTop !== 0 || element.scrollLeft !== 0) {
      positions.push({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      });
    }
    for (const child of element.children) {
      visit(child);
    }
    if (element.shadowRoot) {
      for (const child of element.shadowRoot.children) {
        visit(child);
      }
    }
  };
  visit(container);
  return positions;
}
