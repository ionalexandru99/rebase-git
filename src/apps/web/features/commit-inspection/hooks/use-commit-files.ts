import type { CommitFile } from "@rebase/contracts/commit-inspection/commit-inspection.contract";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { changeTreeRows } from "#web/features/file-diff/file-tree";

export function useCommitFiles(
  files: readonly CommitFile[],
  path: string | null,
  select: (path: string) => void,
) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [active, setActive] = useState<string | null>(path);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => changeTreeRows(files, true, "", collapsed),
    [files, collapsed],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index]?.file?.previousPath ? 52 : 32),
    overscan: 6,
    getItemKey: (index) => rows[index]?.key ?? index,
  });
  useLayoutEffect(() => {
    setActive(path);
    if (path !== null)
      setCollapsed(
        (current) =>
          new Set([...current].filter((folder) => !path.startsWith(folder))),
      );
  }, [path]);
  useLayoutEffect(() => {
    const index = rows.findIndex((row) => row.key === active);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [active, rows, virtualizer]);
  const toggle = (key: string, collapse: boolean) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (collapse) next.add(key);
      else next.delete(key);
      return next;
    });
  const activate = (index: number) => {
    const row = rows[index];
    if (!row) return;
    setActive(row.key);
    virtualizer.scrollToIndex(index, { align: "auto" });
    if (row.file) select(row.file.path);
  };
  const activeIndex = rows.findIndex((row) => row.key === active);
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const next =
      event.key === "ArrowDown"
        ? Math.min(rows.length - 1, activeIndex + 1)
        : event.key === "ArrowUp"
          ? Math.max(0, activeIndex - 1)
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? rows.length - 1
              : undefined;
    if (next !== undefined) {
      event.preventDefault();
      activate(next);
      return;
    }
    const row = rows[activeIndex];
    if (!row) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (row.file) select(row.file.path);
      else toggle(row.key, !collapsed.has(row.key));
    } else if (event.key === "ArrowRight" && !row.file) {
      event.preventDefault();
      if (collapsed.has(row.key)) toggle(row.key, false);
      else activate(activeIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (!row.file && !collapsed.has(row.key)) toggle(row.key, true);
      else {
        const parent = rows
          .slice(0, activeIndex)
          .findLastIndex((candidate) => candidate.depth < row.depth);
        if (parent >= 0) activate(parent);
      }
    }
  };
  return {
    rows,
    collapsed,
    active,
    activeIndex,
    scrollRef,
    virtualizer,
    toggle,
    activate,
    onKeyDown,
  };
}
