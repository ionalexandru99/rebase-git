import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text";

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
  const [feedback, setFeedback] = useState<{
    readonly text: string;
    readonly success: boolean;
  }>();
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
        const wide = event.currentTarget.offsetWidth >= 60;
        try {
          await writeClipboardText(value);
          setFeedback({ text: wide ? "✓ Copied" : "✓", success: true });
        } catch {
          setFeedback({ text: wide ? "Copy failed" : "!", success: false });
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
          className="absolute inset-0 flex items-center justify-center text-[10px]"
          aria-hidden="true"
        >
          {feedback.text}
        </span>
      )}
      <span className="sr-only" role="status">
        {feedback === undefined
          ? ""
          : `${feedback.success ? "Copied" : "Could not copy"} ${value}`}
      </span>
    </button>
  );
}
