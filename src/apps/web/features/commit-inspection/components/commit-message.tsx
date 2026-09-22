import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#web-ui/components/ui/button";

export function CommitMessage({ body }: { readonly body: string }) {
  const id = useId();
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useLayoutEffect(() => {
    const element = paragraph.current;
    if (!element) return;
    const measure = () => {
      const lineHeight = Number.parseFloat(
        getComputedStyle(element).lineHeight,
      );
      setOverflows(element.scrollHeight > lineHeight * 2 + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="mt-1">
      <p
        id={id}
        ref={paragraph}
        className={`whitespace-pre-wrap break-words text-sm text-muted-foreground ${expanded ? "max-h-40 overflow-y-auto" : "line-clamp-2"}`}
      >
        {body}
      </p>
      {overflows ? (
        <Button
          variant="ghost"
          size="xs"
          className="mt-1 h-auto px-0 py-0.5 text-muted-foreground"
          aria-controls={id}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}
