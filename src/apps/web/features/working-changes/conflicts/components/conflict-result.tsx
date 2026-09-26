import { useMemo } from "react";
import { diffFontStyle } from "#web/features/file-diff/diff-font";
import {
  type MarkerSegmentKind,
  markerSegments,
} from "#web/features/working-changes/conflicts/conflict-markers";

const segmentStyles: Record<MarkerSegmentKind, string> = {
  text: "pl-3",
  marker: "bg-muted pl-3 text-muted-foreground",
  current: "border-status-available border-l-2 bg-status-available/10 pl-2.5",
  base: "border-muted-foreground border-l-2 bg-muted/40 pl-2.5",
  incoming: "border-primary border-l-2 bg-primary/10 pl-2.5",
};

export function ConflictResult({ content }: { readonly content: string }) {
  const segments = useMemo(() => markerSegments(content), [content]);
  return (
    <section
      aria-label="Result"
      className="min-h-0 flex-1 overflow-auto"
      style={diffFontStyle}
    >
      <pre className="min-w-fit py-2 pr-3 [font-family:var(--diffs-font-family)] [font-size:var(--diffs-font-size)] [line-height:var(--diffs-line-height)]">
        {segments.map((segment) => (
          <div
            key={segment.line}
            data-conflict-part={segment.kind}
            className={`min-h-(--diffs-line-height) ${segmentStyles[segment.kind]}`}
          >
            {segment.text}
          </div>
        ))}
      </pre>
    </section>
  );
}
