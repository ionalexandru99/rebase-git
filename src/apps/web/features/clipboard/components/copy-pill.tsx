import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";

export function CopyPill({
  value,
  children,
  className,
  style,
}: {
  readonly value: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  const [feedback, setFeedback] = useState<string>();
  const errorToast = useErrorToast();
  useEffect(() => {
    if (feedback === undefined) return;
    const timer = setTimeout(() => setFeedback(undefined), 1_400);
    return () => clearTimeout(timer);
  }, [feedback]);
  return (
    <button
      type="button"
      className={`relative inline-flex shrink-0 items-center ${className ?? ""}`}
      style={style}
      aria-label={`Copy ${value}`}
      onClick={async (event) => {
        event.stopPropagation();
        const copied = event.currentTarget.offsetWidth >= 60 ? "✓ Copied" : "✓";
        try {
          await writeClipboardText(value);
          setFeedback(copied);
        } catch {
          errorToast.show("copy");
        }
      }}
    >
      <span
        className={`inline-flex items-center gap-1 ${feedback === undefined ? "" : "invisible"}`}
      >
        {children}
      </span>
      {feedback === undefined ? null : (
        <span
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          {feedback}
        </span>
      )}
      <span className="sr-only" role="status">
        {feedback === undefined ? "" : `Copied ${value}`}
      </span>
    </button>
  );
}
