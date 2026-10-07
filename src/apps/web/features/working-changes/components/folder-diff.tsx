import { useRef, useState } from "react";
import type {
  ChangedFile,
  ChangeSection,
} from "#contracts/repository-changes/repository-changes.contract.ts";
import { ChangeFileIcon } from "#web/features/file-diff/components/change-file-icon.tsx";
import { DiffContent } from "#web/features/file-diff/components/diff-content.tsx";
import { DiffDisplayControls } from "#web/features/file-diff/components/diff-display-controls.tsx";
import { LineCounts } from "#web/features/file-diff/components/file-row-name.tsx";
import { createChangeDiffModel } from "#web/features/file-diff/diff-model.ts";
import {
  type FolderSelection,
  inFolder,
} from "#web/features/working-changes/hooks/use-change-selection.ts";
import { useChangeDiff } from "#web/features/working-changes/hooks/use-working-changes.ts";
import type { WorkingChangesView } from "#web/features/working-changes/hooks/use-working-changes-view.ts";

type FolderView = Pick<
  WorkingChangesView,
  "changes" | "preferences" | "choosePreferences" | "scope" | "active"
>;

export default function FolderDiff({
  view,
  folder,
}: {
  readonly view: FolderView;
  readonly folder: FolderSelection;
}) {
  const region = useRef<HTMLElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);
  const files = (view.changes?.[folder.section] ?? []).filter((file) =>
    inFolder(folder.folder, file.path),
  );
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
      aria-label={`Diff of ${folder.folder}`}
      ref={region}
    >
      <DiffDisplayControls
        expanded={false}
        preferences={view.preferences}
        onPreferences={view.choosePreferences}
        region={region}
      />
      <div ref={setScroller} className="min-h-0 flex-1 overflow-auto">
        {scroller === null
          ? null
          : files.map((file) => (
              <FolderFile
                key={file.path}
                view={view}
                section={folder.section}
                file={file}
                scroller={scroller}
              />
            ))}
      </div>
    </section>
  );
}

function FolderFile({
  view,
  section,
  file,
  scroller,
}: {
  readonly view: FolderView;
  readonly section: ChangeSection;
  readonly file: ChangedFile;
  readonly scroller: HTMLElement;
}) {
  const [near, setNear] = useState(false);
  const diff = useChangeDiff(
    view.scope,
    near ? { section, path: file.path } : null,
    view.changes,
    view.active,
    true,
  );
  const observe = (node: HTMLElement) => {
    const observer = new IntersectionObserver(
      (records) => {
        if (records.some((record) => record.isIntersecting)) setNear(true);
      },
      { root: scroller, rootMargin: "50% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  };
  const { metadata } = createChangeDiffModel(
    diff.data ?? null,
    file.previousPath,
  );
  return (
    <article
      aria-label={file.path}
      ref={near ? undefined : observe}
      className="border-border border-b"
    >
      {diff.data === undefined ? (
        <div
          className="flex items-start gap-2 px-3 pt-2.5 text-body text-muted-foreground"
          style={{ height: estimatedHeight(file) }}
        >
          <ChangeFileIcon path={file.path} />
          <span className="min-w-0 truncate">{file.path}</span>
          <LineCounts lines={file.lines} className="ml-auto" />
        </div>
      ) : (
        <DiffContent
          diff={diff.data}
          metadata={metadata}
          preferences={view.preferences}
          expandContext={false}
        />
      )}
    </article>
  );
}

function estimatedHeight({ lines }: ChangedFile) {
  return 36 + 20 * (lines === null ? 4 : lines.added + lines.removed + 6);
}
