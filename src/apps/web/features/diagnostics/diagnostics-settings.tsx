import {
  IconActivity,
  IconEye,
  IconEyeOff,
  IconFolder,
  IconGitBranch,
} from "@tabler/icons-react";
import { useEffect, useState } from "react";
import {
  DiagnosticsApi,
  type DiagnosticsError,
  type DiagnosticsPeriod,
  type DiagnosticsSample,
} from "#contracts/diagnostics/diagnostics.contract.ts";
import type { RepositoryCatalogEntry } from "#contracts/repository-catalog/repository-catalog.contract.ts";
import { Button } from "#web/components/ui/button.tsx";
import {
  SettingsPage,
  SettingsRow,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import { writeClipboardText } from "#web/features/clipboard/write-clipboard-text.ts";
import { formatDuration } from "#web/features/diagnostics/diagnostics-primitives.tsx";
import { Errors } from "#web/features/diagnostics/error-list.tsx";
import { Processes } from "#web/features/diagnostics/process-tree.tsx";
import {
  Footprint,
  Timeline,
} from "#web/features/diagnostics/resource-usage.tsx";
import { Slowest } from "#web/features/diagnostics/slowest-runs.tsx";
import { useErrorToast } from "#web/features/notifications/notifications.tsx";
import { useRepositoryCatalog } from "#web/features/repository-catalog/use-repository-catalog.ts";
import { useEnvironment } from "#web/platform/query/environment-context.tsx";
import { useCommand } from "#web/platform/query/use-command.ts";

export function DiagnosticsSettings({
  productVersion,
}: {
  readonly productVersion: string;
}) {
  const { subscribe, connected } = useEnvironment();
  const [period, setPeriod] = useState<DiagnosticsPeriod>("15m");
  const [sample, setSample] = useState<DiagnosticsSample>();
  const [errors, setErrors] = useState<readonly DiagnosticsError[]>([]);
  const stop = useCommand(DiagnosticsApi.stop);
  const watchAgain = useCommand(DiagnosticsApi.watchAgain);

  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    subscribe(
      DiagnosticsApi.watch,
      { period },
      (event) => {
        if (event._tag === "Errors") setErrors(event.errors);
        else setSample(event);
      },
      controller.signal,
    ).catch(() => {});
    return () => controller.abort();
  }, [subscribe, connected, period]);

  return (
    <SettingsPage title="Diagnostics">
      <Footprint period={period} sample={sample} />
      <Timeline onPeriodChange={setPeriod} period={period} sample={sample} />
      <Processes onStop={({ pid }) => void stop.run({ pid })} sample={sample} />
      <Errors errors={errors} />
      <Slowest sample={sample} />
      <Watchers
        onWatchAgain={(repositoryId) => void watchAgain.run({ repositoryId })}
        sample={sample}
      />
      <Server errors={errors} productVersion={productVersion} sample={sample} />
    </SettingsPage>
  );
}

function Watchers({
  sample,
  onWatchAgain,
}: {
  readonly sample: DiagnosticsSample | undefined;
  readonly onWatchAgain: (repositoryId: string) => void;
}) {
  const { repositories } = useRepositoryCatalog();
  if (sample === undefined || sample.watchers.length === 0) return null;
  return (
    <SettingsSection title="Watchers">
      {sample.watchers.map(({ repositoryId, failure }) => {
        const name =
          repositories.find(({ id }) => id === repositoryId)?.name ??
          "Removed repository";
        return failure === undefined ? (
          <SettingsRow
            icon={
              <IconEye
                aria-hidden="true"
                className="size-4.5 text-muted-foreground"
              />
            }
            key={repositoryId}
            status="ready"
            title={name}
            value="Watching"
          />
        ) : (
          <SettingsRow
            description={failure}
            icon={
              <IconEyeOff
                aria-hidden="true"
                className="size-4.5 text-warning"
              />
            }
            key={repositoryId}
            status="attention"
            title={name}
            value="Stopped"
          >
            <Button
              onClick={() => onWatchAgain(repositoryId)}
              size="xs"
              variant="outline"
            >
              Watch again
            </Button>
          </SettingsRow>
        );
      })}
    </SettingsSection>
  );
}

function Server({
  sample,
  errors,
  productVersion,
}: {
  readonly sample: DiagnosticsSample | undefined;
  readonly errors: readonly DiagnosticsError[];
  readonly productVersion: string;
}) {
  const { repositories } = useRepositoryCatalog();
  const [copied, setCopied] = useState(false);
  const errorToast = useErrorToast();
  if (sample === undefined) return null;
  const { server } = sample;
  return (
    <SettingsSection
      action={
        <Button
          onBlur={() => setCopied(false)}
          onClick={async () => {
            try {
              await writeClipboardText(
                diagnosticsReport(sample, errors, productVersion, repositories),
              );
              setCopied(true);
            } catch {
              errorToast.show("copy");
            }
          }}
          onMouseLeave={() => setCopied(false)}
          size="xs"
          variant="outline"
        >
          <span aria-live="polite">{copied ? "Copied" : "Copy report"}</span>
        </Button>
      }
      title="Server"
    >
      <SettingsRow
        icon={
          <IconActivity
            aria-hidden="true"
            className="size-4.5 text-muted-foreground"
          />
        }
        title="Rebase"
        value={`${productVersion} · ${platformName(server.platform)} ${server.architecture} · up ${formatDuration(sample.sampledAt - server.startedAt)}`}
      />
      <SettingsRow
        icon={
          <IconGitBranch
            aria-hidden="true"
            className="size-4.5 text-muted-foreground"
          />
        }
        title="Git"
        value={server.gitVersion}
      />
      <SettingsRow
        icon={
          <IconFolder
            aria-hidden="true"
            className="size-4.5 text-muted-foreground"
          />
        }
        title="Data folder"
        value={server.dataFolder}
      />
    </SettingsSection>
  );
}

function platformName(platform: string) {
  return (
    { darwin: "macOS", linux: "Linux", win32: "Windows" }[platform] ?? platform
  );
}

export function diagnosticsReport(
  sample: DiagnosticsSample,
  errors: readonly DiagnosticsError[],
  productVersion: string,
  repositories: readonly RepositoryCatalogEntry[],
) {
  const { server, footprint, monitor } = sample;
  const repository = (repositoryId: string | undefined) =>
    repositories.find(({ id }) => id === repositoryId)?.name;
  const lines = [
    "## Rebase diagnostics",
    "",
    `- Rebase ${productVersion} on ${platformName(server.platform)} ${server.architecture}`,
    `- Git ${server.gitVersion}`,
    `- Up ${formatDuration(sample.sampledAt - server.startedAt)}`,
    `- Process monitor: ${monitor._tag === "Unavailable" ? `unavailable (${monitor.detail})` : monitor._tag.toLowerCase()}`,
    `- ${footprint.processes} processes · ${footprint.gitRuns} Git runs, ${footprint.gitFailures} failed`,
    "",
    "### Slowest Git commands",
    "",
    ...sample.slowestGit.map(
      (duration) =>
        `- ${duration.name}${repository(duration.repositoryId) === undefined ? "" : ` (${repository(duration.repositoryId)})`}: ${formatDuration(duration.longest)}, ${duration.runs} runs`,
    ),
    "",
    "### Errors",
    "",
    ...(errors.length === 0 ? ["None"] : []),
    ...errors
      .slice(0, 10)
      .flatMap((error) => [
        `#### ${error.kind}: ${error.title}${error.count > 1 ? ` (×${error.count})` : ""}`,
        "",
        `${error.where}${repository(error.repositoryId) === undefined ? "" : ` · ${repository(error.repositoryId)}`}`,
        "",
        "```",
        error.detail.slice(0, 2_000),
        "```",
        "",
      ]),
  ];
  return lines.join("\n");
}
