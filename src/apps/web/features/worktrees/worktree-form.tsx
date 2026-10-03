import {
  type FormEvent,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Button } from "#web/components/ui/button.tsx";
import { Input } from "#web/components/ui/input.tsx";
import type { StartPoint } from "#web/features/refs/ref-kinds.ts";
import {
  planWorktree,
  type WorktreeDraft,
  worktreeFolderPath,
} from "#web/features/worktrees/worktree-draft.ts";
import type { Worktrees } from "#web/features/worktrees/worktrees.ts";

export function WorktreeForm({
  worktrees,
  draft,
  fallback,
  onCancel,
  onDone,
}: {
  readonly worktrees: Worktrees;
  readonly draft: WorktreeDraft;
  readonly fallback: StartPoint;
  readonly onCancel: () => void;
  readonly onDone: () => void;
}) {
  const id = useId();
  const branchRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(draft.name);
  const [folder, setFolder] = useState<string>();
  const [error, setError] = useState<string>();
  useLayoutEffect(() => {
    branchRef.current?.focus();
    branchRef.current?.select();
  }, []);
  const { refs, folder: parent } = worktrees;
  if (refs === undefined) return null;
  const branch = name.trim();
  const start = draft.start ?? fallback;
  const plan = planWorktree(refs, branch, start);
  const path =
    folder ??
    (parent === undefined || branch.length === 0
      ? ""
      : worktreeFolderPath(parent, branch));
  const hint =
    plan._tag === "Switch"
      ? `Open in ${plan.name}`
      : plan._tag === "Invalid"
        ? branch.length === 0
          ? undefined
          : plan.message
        : plan.start._tag === "Branch"
          ? `Checks out ${branch}`
          : `New branch from ${start.label}`;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (plan._tag === "Switch") {
      const row = worktrees.rows.find(
        ({ worktree }) => worktree.path === plan.path,
      );
      if (row !== undefined) worktrees.switchTo(row);
      onDone();
      return;
    }
    if (plan._tag !== "Create" || path.length === 0 || worktrees.creating)
      return;
    setError(undefined);
    const failure = await worktrees.create(path.trim(), plan.start);
    if (failure === undefined) onDone();
    else setError(failure);
  };
  return (
    <form
      aria-label="New worktree"
      className="flex flex-col gap-2 p-2"
      onSubmit={(event) => void submit(event)}
    >
      <p className="text-[.85rem] font-medium">New worktree</p>
      <label className="flex flex-col gap-1" htmlFor={`${id}-branch`}>
        <span className="text-[.72rem] text-muted-foreground">Branch</span>
        <Input
          aria-describedby={`${id}-hint`}
          autoComplete="off"
          className="h-7 text-[.85rem] sm:h-7 sm:text-[.85rem]"
          id={`${id}-branch`}
          onChange={(event) => {
            setName(event.target.value);
            setError(undefined);
          }}
          ref={branchRef}
          spellCheck={false}
          value={name}
        />
      </label>
      <p
        aria-live="polite"
        className={`min-h-4 text-[.72rem] ${plan._tag === "Invalid" ? "text-destructive" : "text-muted-foreground"}`}
        id={`${id}-hint`}
      >
        {hint}
      </p>
      {plan._tag === "Switch" ? null : (
        <label className="flex flex-col gap-1" htmlFor={`${id}-folder`}>
          <span className="text-[.72rem] text-muted-foreground">Folder</span>
          <Input
            autoComplete="off"
            className="h-7 text-[.8rem] sm:h-7 sm:text-[.8rem]"
            id={`${id}-folder`}
            onChange={(event) => {
              setFolder(event.target.value);
              setError(undefined);
            }}
            spellCheck={false}
            value={path}
          />
        </label>
      )}
      {error === undefined ? null : (
        <p className="text-[.72rem] text-destructive" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-1.5 pt-1">
        <Button onClick={onCancel} size="xs" type="button" variant="ghost">
          Cancel
        </Button>
        <Button
          disabled={
            plan._tag === "Invalid" ||
            (plan._tag === "Create" &&
              (path.trim().length === 0 ||
                worktrees.creating ||
                !worktrees.writable))
          }
          size="xs"
          type="submit"
        >
          {plan._tag === "Switch"
            ? "Switch"
            : worktrees.creating
              ? "Creating…"
              : "Create"}
        </Button>
      </div>
    </form>
  );
}
