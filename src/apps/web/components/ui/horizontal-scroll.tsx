import { IconChevronLeft, IconChevronRight } from "@tabler/icons-react";
import {
  type KeyboardEvent,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const horizontalScrollViewport =
  "h-full overflow-x-auto overflow-y-hidden overscroll-x-contain outline-none [scrollbar-width:none] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30 [&::-webkit-scrollbar]:hidden";

export function useHorizontalScroll() {
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
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.target !== event.currentTarget) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Home" || event.key === "End")
      event.currentTarget.scrollLeft =
        event.key === "Home" ? 0 : event.currentTarget.scrollWidth;
    else scroll(event.key === "ArrowLeft" ? -1 : 1);
  };
  return { viewport, content, edges, measure, scroll, onKeyDown };
}

export function HorizontalScrollButton({
  direction,
  label,
  background,
  onScroll,
}: {
  readonly direction: -1 | 1;
  readonly label: string;
  readonly background: string;
  readonly onScroll: (direction: -1 | 1) => void;
}) {
  const Icon = direction === -1 ? IconChevronLeft : IconChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      tabIndex={-1}
      className={`absolute inset-y-0 z-[3] w-5 text-muted-foreground ${direction === -1 ? "left-0" : "right-0"} ${background}`}
      onClick={(event) => {
        event.stopPropagation();
        onScroll(direction);
      }}
    >
      <Icon aria-hidden="true" className="size-3" />
    </button>
  );
}
