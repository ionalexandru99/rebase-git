import { IconActivity, IconGitBranch } from "@tabler/icons-react";
import { useState } from "react";
import type {
  DiagnosticsDuration,
  DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import { IconSwitch } from "#web/components/ui/icon-switch.tsx";
import {
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import {
  formatDuration,
  RepositoryMark,
} from "#web/features/diagnostics/diagnostics-primitives.tsx";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";

export function Slowest({
  sample,
}: {
  readonly sample: DiagnosticsSample | undefined;
}) {
  const [kind, setKind] = useState<"git" | "requests">("git");
  const durations =
    kind === "git" ? sample?.slowestGit : sample?.slowestRequests;
  return (
    <SettingsSection
      action={
        <IconSwitch
          label="Slowest kind"
          onChange={setKind}
          options={[
            { value: "git", label: "Git" },
            { value: "requests", label: "Requests" },
          ]}
          value={kind}
        />
      }
      title="Slowest · last hour"
    >
      {durations?.length === 0 ? (
        <p className="px-4 py-3 text-meta text-muted-foreground">
          Nothing ran in the last hour.
        </p>
      ) : null}
      {durations?.map((duration) => (
        <SlowestRow
          Icon={kind === "git" ? IconGitBranch : IconActivity}
          duration={duration}
          key={`${duration.repositoryId ?? ""}\u0000${duration.name}`}
        />
      ))}
    </SettingsSection>
  );
}

function SlowestRow({
  duration,
  Icon,
}: {
  readonly duration: DiagnosticsDuration;
  readonly Icon: typeof IconGitBranch;
}) {
  const { repositories } = useRepositoryCatalog();
  const repository = repositories.find(
    ({ id }) => id === duration.repositoryId,
  );
  const runs = `${duration.runs.toLocaleString()} ${duration.runs === 1 ? "run" : "runs"}`;
  return (
    <SettingsRow
      description={[
        repository?.name,
        runs,
        duration.runs > 1
          ? `usually ${formatDuration(duration.typical)}`
          : undefined,
      ]
        .filter((part) => part !== undefined)
        .join(" · ")}
      icon={
        repository === undefined ? (
          <Icon aria-hidden="true" className="size-4.5 text-muted-foreground" />
        ) : (
          <RepositoryMark repositoryId={repository.id} />
        )
      }
      title={duration.name}
    >
      <span className="text-control font-medium tabular-nums">
        {formatDuration(duration.longest)}
      </span>
    </SettingsRow>
  );
}
