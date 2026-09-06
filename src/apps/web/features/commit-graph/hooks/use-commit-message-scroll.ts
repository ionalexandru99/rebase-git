import { useCallback, useLayoutEffect, useRef, useState } from "react";

export function useCommitMessageScroll() {
  const viewport = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ room: true, left: false, right: false });
  const measure = useCallback(() => {
    const node = viewport.current;
    if (node === null) return;
    const next = {
      room: node.clientWidth >= 48,
      left: node.scrollLeft > 1,
      right: node.scrollLeft < node.scrollWidth - node.clientWidth - 1,
    };
    setEdges((current) =>
      current.room === next.room &&
      current.left === next.left &&
      current.right === next.right
        ? current
        : next,
    );
  }, []);
  useLayoutEffect(() => {
    const node = viewport.current;
    const text = content.current;
    if (node === null || text === null) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    observer.observe(text);
    const wheel = (event: WheelEvent) => {
      if (!event.shiftKey || event.deltaX !== 0) return;
      event.preventDefault();
      node.scrollLeft +=
        event.deltaY *
        (event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? node.clientWidth
            : 1);
    };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => {
      observer.disconnect();
      node.removeEventListener("wheel", wheel);
    };
  }, [measure]);
  const scroll = (direction: -1 | 1) => {
    const node = viewport.current;
    if (node !== null)
      node.scrollBy({
        left: direction * Math.max(60, node.clientWidth * 0.75),
      });
  };
  return { viewport, content, edges, measure, scroll };
}
