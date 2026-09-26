import { useId, useLayoutEffect, useRef, useState } from "react";
import { Input } from "#web/components/ui/input";

export function RefNameField({
  initialName,
  label,
  onCancel,
  onSubmit,
  problem,
}: {
  readonly initialName: string;
  readonly label: string;
  readonly onCancel: () => void;
  readonly onSubmit: (name: string) => Promise<string | undefined>;
  readonly problem: (name: string) => string | undefined;
}) {
  const [name, setName] = useState(initialName);
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
    const refused = await onSubmit(name);
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
        className="h-7 text-[.85rem] sm:h-7 sm:text-[.85rem]"
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
      {message === undefined ? null : (
        <p
          className="px-1 text-xs leading-4 text-status-unavailable"
          id={messageId}
          role="alert"
        >
          {message}
        </p>
      )}
    </fieldset>
  );
}
