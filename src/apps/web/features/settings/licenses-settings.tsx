import {
  IconChevronRight,
  IconExternalLink,
  IconSearch,
} from "@tabler/icons-react";
import { type JSX, useEffect, useState } from "react";
import type { ThirdPartyLicense } from "#contracts/third-party-licenses/third-party-licenses.contract.ts";
import { buttonVariants } from "#web/components/ui/button.tsx";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "#web/components/ui/collapsible.tsx";
import { Input } from "#web/components/ui/input.tsx";
import {
  SettingsPage,
  SettingsSection,
} from "#web/components/ui/settings-layout.tsx";
import {
  filterThirdPartyLicenses,
  loadThirdPartyLicenses,
} from "#web/features/settings/third-party-licenses.ts";

export function LicensesSettings(): JSX.Element {
  const [licenses, setLicenses] = useState<readonly ThirdPartyLicense[]>();
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [openKey, setOpenKey] = useState<string>();

  useEffect(() => {
    const controller = new AbortController();
    loadThirdPartyLicenses(controller.signal).then(setLicenses, () => {
      if (!controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, []);

  const visible = filterThirdPartyLicenses(licenses ?? [], query);

  return (
    <SettingsPage title="Licenses">
      {failed ? (
        <p role="alert" className="text-body text-destructive">
          Licenses could not be loaded.
        </p>
      ) : null}
      {licenses === undefined ? null : (
        <SettingsSection
          title="Third-party notices"
          action={
            <div className="relative w-44">
              <IconSearch
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Search licenses"
                className="pl-8"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search licenses…"
                type="search"
                value={query}
              />
            </div>
          }
        >
          {visible.map((entry) => {
            const key = `${entry.name}@${entry.version}`;
            return (
              <LicenseRow
                entry={entry}
                key={key}
                open={openKey === key}
                onOpenChange={(open) => setOpenKey(open ? key : undefined)}
              />
            );
          })}
          {visible.length === 0 ? (
            <p className="px-3 py-8 text-center text-body text-muted-foreground sm:px-4">
              No licenses match
            </p>
          ) : null}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}

function LicenseRow({
  entry,
  open,
  onOpenChange,
}: {
  readonly entry: ThirdPartyLicense;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <div className="flex min-h-9 items-center hover:bg-accent/40">
        <CollapsibleTrigger className="group flex min-h-9 min-w-0 flex-1 items-center gap-2.5 px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-inset sm:px-4">
          <IconChevronRight
            aria-hidden="true"
            className="size-3.5 shrink-0 text-muted-foreground group-data-[panel-open]:rotate-90"
          />
          <span className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="truncate text-control font-medium text-foreground">
              {entry.name}
            </span>
            {entry.version === null ? null : (
              <code className="shrink-0 text-meta text-muted-foreground">
                {entry.version}
              </code>
            )}
          </span>
          <span className="shrink-0 text-meta text-muted-foreground">
            {entry.license}
          </span>
        </CollapsibleTrigger>
        {entry.sourceUrl === null ? null : (
          <a
            aria-label={`${entry.name} source`}
            className={buttonVariants({
              className: "me-2 text-muted-foreground sm:me-3",
              size: "icon-xs",
              variant: "ghost",
            })}
            href={entry.sourceUrl}
            rel="noreferrer noopener"
            target="_blank"
          >
            <IconExternalLink aria-hidden="true" className="size-3.5" />
          </a>
        )}
      </div>
      <CollapsibleContent>
        <pre className="px-9 pt-1 pb-4 font-mono text-meta whitespace-pre-wrap break-words text-foreground/80 sm:px-10">
          {entry.notice}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
