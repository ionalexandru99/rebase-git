import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { DiscardedChanges } from "#contracts/repository-changes/repository-changes.contract.ts";
import { fileName } from "#web/features/file-diff/components/file-row-name.tsx";

export interface Discard {
  readonly discarded: DiscardedChanges;
  readonly paths: readonly string[];
  readonly lines: boolean;
}

export interface DiscardNotice {
  readonly title: string;
  readonly undo: () => void;
}

export function useDiscardUndo(
  restore: (discarded: DiscardedChanges) => Promise<boolean>,
  active: boolean,
) {
  const [discards, setDiscards] = useState<readonly Discard[]>([]);
  const latest = useRef(discards);
  const restoring = useRef<Discard[]>([]);
  const keep = (next: readonly Discard[]) => {
    latest.current = next;
    setDiscards(next);
  };
  const drain = async () => {
    for (
      let next = restoring.current[0];
      next !== undefined;
      next = restoring.current[0]
    ) {
      if (await restore(next.discarded)) restoring.current.shift();
      else {
        keep([...latest.current, ...restoring.current.slice(1).toReversed()]);
        restoring.current = [];
      }
    }
  };
  const undo = () => {
    const newest = latest.current.at(-1);
    if (newest === undefined) return;
    keep(latest.current.slice(0, -1));
    restoring.current.push(newest);
    if (restoring.current.length === 1) void drain();
  };
  useUndoKey(active && discards.length > 0, undo);
  return {
    notice:
      discards.length === 0
        ? null
        : ({ title: discardTitle(discards), undo } satisfies DiscardNotice),
    add: (discard: Discard) => keep([...latest.current, discard]),
    clear: () => keep([]),
  };
}

function useUndoKey(enabled: boolean, undo: () => void) {
  const onUndo = useEffectEvent(undo);
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !(event.ctrlKey || event.metaKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "z" ||
        editing(event.target)
      )
        return;
      event.preventDefault();
      onUndo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}

function editing(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target.closest("input, textarea, select") !== null)
  );
}

function discardTitle(discards: readonly Discard[]) {
  const paths = new Set(discards.flatMap((discard) => discard.paths));
  const [only] = paths;
  if (paths.size !== 1 || only === undefined)
    return `Discarded ${paths.size} files`;
  return discards.every((discard) => discard.lines)
    ? `Discarded lines in ${fileName(only)}`
    : `Discarded ${fileName(only)}`;
}
