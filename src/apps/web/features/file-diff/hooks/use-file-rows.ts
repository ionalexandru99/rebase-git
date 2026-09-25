import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState } from "react";
import {
  type ChangeTreeRow,
  changeTreeRows,
} from "#web/features/file-diff/file-tree";

export function useFileRows<File extends { readonly path: string }>(
  files: readonly File[],
  {
    tree = true,
    filter = "",
    open = true,
    rowHeight = () => 32,
  }: {
    readonly tree?: boolean;
    readonly filter?: string;
    readonly open?: boolean;
    readonly rowHeight?: (row: ChangeTreeRow<File>) => number;
  } = {},
) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () => changeTreeRows(files, tree, filter, collapsed),
    [files, tree, filter, collapsed],
  );
  const virtualizer = useVirtualizer({
    count: open ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row ? rowHeight(row) : 32;
    },
    overscan: 6,
    getItemKey: (index) => rows[index]?.key ?? index,
  });
  const toggle = (key: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  return { rows, collapsed, scrollRef, virtualizer, toggle };
}
