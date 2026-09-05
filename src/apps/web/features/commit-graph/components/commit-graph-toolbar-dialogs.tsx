import type {
  RepositoryHistoryCacheDialogProps,
  RepositoryHistoryCacheReader,
} from "#web/features/repository-history/diagnostics/repository-history-cache-dialog.contract";
import { describeRepositoryFetchError } from "#web/features/repository-history/freshness/repository-fetch-error";
import type {
  RepositoryHistoryReader,
  RepositoryHistorySnapshot,
} from "#web/features/repository-history/repository-history-reader.contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "#web-ui/components/ui/dialog";
import { useCommitGraphToolbar } from "#web-ui/features/commit-graph/components/commit-graph-toolbar-provider";
import { RepositoryHistoryCacheDialog } from "#web-ui/features/repository-history/diagnostics/repository-history-cache-dialog";
import { RepositoryFetchSettings } from "#web-ui/features/repository-history/freshness/repository-fetch-settings";

export function CommitGraphToolbarDialogs({
  repositoryName,
  reader,
  snapshot,
  offline,
  canConfigure,
  cache,
}: {
  readonly repositoryName: string;
  readonly reader:
    | (RepositoryHistoryCacheReader &
        Pick<RepositoryHistoryReader, "configureFetch">)
    | undefined;
  readonly snapshot: RepositoryHistorySnapshot;
  readonly offline: boolean;
  readonly canConfigure: boolean;
  readonly cache:
    | Pick<RepositoryHistoryCacheDialogProps, "identity" | "onCacheChanged">
    | undefined;
}) {
  const { dialog, closeDialog } = useCommitGraphToolbar();
  return (
    <>
      {reader === undefined || dialog === undefined ? null : (
        <>
          <Dialog
            open={dialog === "fetch"}
            onOpenChange={(open) => {
              if (!open) closeDialog();
            }}
          >
            <DialogContent className="max-w-sm">
              <DialogTitle>Fetch settings</DialogTitle>
              <DialogDescription>{repositoryName}</DialogDescription>
              {dialog === "fetch" ? (
                <RepositoryFetchSettings
                  reader={reader}
                  setting={snapshot.freshness?.setting ?? { _tag: "Inherit" }}
                  defaultIntervalSeconds={
                    snapshot.freshness?.defaultIntervalSeconds ?? 300
                  }
                  disabled={
                    !canConfigure ||
                    snapshot.freshness === undefined ||
                    snapshot.freshnessError !== undefined
                  }
                  disabledReason={
                    offline
                      ? "Reconnect to the server and try again."
                      : snapshot.freshnessError !== undefined
                        ? describeRepositoryFetchError(snapshot.freshnessError)
                        : !canConfigure
                          ? "Connect with repository write access to change fetch settings."
                          : "Loading fetch settings."
                  }
                  onSaved={() => closeDialog()}
                />
              ) : null}
            </DialogContent>
          </Dialog>
          {cache === undefined ? null : (
            <RepositoryHistoryCacheDialog
              reader={reader}
              repositoryName={repositoryName}
              {...cache}
              open={dialog === "cache"}
              onOpenChange={(open) => {
                if (!open) closeDialog();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
