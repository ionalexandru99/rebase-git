import { useId, useLayoutEffect, useRef, useState } from "react";
import type { RepositoryRefs } from "#contracts/repository-refs/repository-refs.contract.ts";
import { Input } from "#web/components/ui/input.tsx";
import type { RefEditing } from "#web/features/refs/ref-editing.ts";
import { refKinds, refNameProblem } from "#web/features/refs/ref-kinds.ts";

function RefNameField({
  initialName,
  label,
  onCancel,
  onSubmit,
  problem,
  withMessage = false,
}: {
  readonly initialName: string;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onSubmit: (
    name: string,
    message: string | undefined,
  ) => Promise<string | undefined>;
  readonly problem: (name: string) => string | undefined;
  readonly withMessage?: boolean;
}) {
  const [name, setName] = useState(initialName);
  const [annotation, setAnnotation] = useState("");
  const [failure, setFailure] = useState<string>();
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const messageId = useId();
  useLayoutEffect(() => {
    const input = inputRef.current;
    input?.focus();
    input?.setSelectionRange(
      initialName.lastIndexOf("/") + 1,
      initialName.length,
    );
  }, [initialName]);
  const message = failure ?? (name.length === 0 ? undefined : problem(name));

  const submit = async () => {
    const rejected = problem(name);
    if (rejected !== undefined) {
      setFailure(rejected);
      return;
    }
    setPending(true);
    const refused = await onSubmit(
      name,
      annotation.trim().length === 0 ? undefined : annotation,
    );
    setPending(false);
    if (refused !== undefined) setFailure(refused);
  };

  return (
    <fieldset
      className="flex min-w-0 flex-col gap-1"
      onBlur={(event) => {
        if (!pending && !event.currentTarget.contains(event.relatedTarget))
          onCancel();
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key !== "Escape") return;
        event.preventDefault();
        onCancel();
      }}
    >
      <Input
        aria-describedby={message === undefined ? undefined : messageId}
        aria-invalid={message !== undefined}
        aria-label={label}
        autoComplete="off"
        className="h-7 text-control sm:h-7"
        onChange={(event) => {
          setName(event.target.value);
          setFailure(undefined);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (!pending) void submit();
        }}
        readOnly={pending}
        ref={inputRef}
        spellCheck={false}
        value={name}
      />
      {withMessage ? (
        <textarea
          aria-label="Tag message"
          className="min-h-14 w-full min-w-0 resize-none rounded-control border border-input bg-input/20 px-[calc(--spacing(3)-1px)] py-1 text-control leading-snug outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 dark:bg-input/30"
          onChange={(event) => {
            setAnnotation(event.target.value);
            setFailure(undefined);
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey))
              return;
            event.preventDefault();
            if (!pending) void submit();
          }}
          placeholder="Message (optional)"
          readOnly={pending}
          rows={2}
          spellCheck={false}
          value={annotation}
        />
      ) : null}
      {withMessage && message === undefined ? (
        <p className="flex justify-between gap-2 px-1 text-meta leading-4 text-muted-foreground">
          <span>
            <span className="font-medium text-foreground">
              {annotation.trim().length === 0 ? "Lightweight" : "Annotated"}
            </span>{" "}
            tag
          </span>
          <span>{annotation.trim().length === 0 ? "Enter" : "Ctrl+Enter"}</span>
        </p>
      ) : null}
      {message === undefined ? null : (
        <p
          className="px-1 text-meta leading-4 text-status-unavailable"
          id={messageId}
          role="alert"
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}

export function RefEditField({
  editing,
  refs,
  level = 2,
}: {
  readonly editing: RefEditing;
  readonly refs: RepositoryRefs | undefined;
  readonly level?: number;
}) {
  const edit = editing.edit;
  if (edit?.kind === "create") {
    const { ref, startPoint } = edit;
    return (
      <div className="px-1.5 py-1">
        <RefNameField
          initialName={startPoint.name}
          label={refKinds[ref].draftLabel(startPoint.label)}
          onCancel={editing.cancel}
          onSubmit={editing.create}
          withMessage={ref === "tag"}
          problem={(name) =>
            refNameProblem(
              ref,
              name,
              (ref === "branch" ? refs?.branches : refs?.tags) ?? [],
            )
          }
        />
      </div>
    );
  }
  if (edit?.kind !== "rename") return null;
  return (
    <div
      className="py-0.5"
      style={{ paddingLeft: 4 + Math.max(0, level - 2) * 18 }}
    >
      <RefNameField
        initialName={edit.branch.name}
        label={`Rename ${edit.branch.name}`}
        onCancel={editing.cancel}
        onSubmit={(name) => editing.rename(name)}
        problem={(name) =>
          refNameProblem("branch", name, refs?.branches ?? [], edit.branch.name)
        }
      />
    </div>
  );
}
