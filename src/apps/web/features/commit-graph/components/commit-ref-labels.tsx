import {
  IconBrandAws,
  IconBrandAzure,
  IconBrandBitbucketFilled,
  IconBrandGit,
  IconBrandGithubFilled,
  IconBrandGitlab,
  IconTag,
  IconX,
} from "@tabler/icons-react";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { RepositoryHistoryRefTarget } from "#contracts/repository-history/repository-history.contract.ts";
import type {
  RepositoryRefs,
  RepositoryRefTarget,
} from "#contracts/repository-refs/repository-refs.contract.ts";
import { CopyPill } from "#web/features/clipboard/components/copy-pill.tsx";
import { graphLaneColor } from "#web/features/commit-graph/layout/graph-colors.ts";
import {
  type CommitLaneRow,
  graphBranchColorIndex,
  graphRefName,
} from "#web/features/repository-history/commit-lanes.ts";

const Appearance = createContext<{
  readonly colors: ReadonlyMap<string, string>;
  readonly providers: ReadonlyMap<
    string,
    NonNullable<RepositoryRefs["remoteProviders"]>[number]["provider"]
  >;
}>({ colors: new Map(), providers: new Map() });

export function GraphRefAppearance({
  colors,
  remoteProviders,
  children,
}: {
  readonly colors: ReadonlyMap<string, string>;
  readonly remoteProviders: RepositoryRefs["remoteProviders"];
  readonly children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      colors,
      providers: new Map(
        remoteProviders?.map((item) => [item.remote, item.provider]),
      ),
    }),
    [colors, remoteProviders],
  );
  return <Appearance value={value}>{children}</Appearance>;
}

export function useGraphRefAppearance() {
  return useContext(Appearance);
}

export function CommitRefLabels({
  labels,
}: {
  readonly labels: readonly RepositoryHistoryRefTarget[];
}) {
  const local = labels.some((label) => label.type === "branch");
  return (
    <span className="flex shrink-0 items-center gap-1">
      {labels
        .filter((label) => !(local && label.type === "remote-branch"))
        .map((label) => (
          <CommitRefPill key={`${label.type}\0${label.name}`} label={label} />
        ))}
    </span>
  );
}

export function CommitRefPill({
  label,
  onRemove,
}: {
  readonly label: Pick<RepositoryHistoryRefTarget, "name" | "type">;
  readonly onRemove?: (() => void) | undefined;
}) {
  const { colors } = useGraphRefAppearance();
  const color =
    label.type === "tag"
      ? "#A8B4C8"
      : (colors.get(label.name) ??
        graphLaneColor(
          graphBranchColorIndex(graphRefName({ ...label, oid: "" })),
        ));
  const local = label.type === "branch";
  const separator =
    label.type === "remote-branch" ? label.name.indexOf("/") : -1;
  const remote = separator > 0 ? label.name.slice(0, separator) : undefined;
  const name =
    remote === undefined ? label.name : label.name.slice(separator + 1);
  return (
    <span
      className="group/ref relative inline-flex shrink-0 items-center rounded-[5px] border font-sans text-[.85rem] leading-none"
      style={{
        color: local ? "#0e141c" : color,
        borderColor: local
          ? color
          : `color-mix(in srgb, ${color} 24%, var(--repository))`,
        background: local
          ? color
          : `color-mix(in srgb, ${color} 17%, var(--repository))`,
      }}
    >
      <CopyPill
        value={name}
        className="rounded-[4px] px-1.5 py-0.5 outline-none focus-visible:ring-1 focus-visible:ring-primary"
      >
        {remote === undefined ? null : <GitProviderIcon remote={remote} />}
        {label.type === "tag" ? (
          <IconTag aria-hidden="true" className="size-3" />
        ) : null}
        {name}
      </CopyPill>
      {onRemove === undefined ? null : (
        <button
          type="button"
          aria-label={`Remove ${label.name} from history`}
          className="pointer-events-none absolute inset-y-0 right-0 grid w-4 place-items-center rounded-r-[4px] opacity-0 outline-none focus-visible:ring-1 focus-visible:ring-primary group-focus-within/ref:pointer-events-auto group-focus-within/ref:opacity-100 group-hover/ref:pointer-events-auto group-hover/ref:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100"
          style={{ background: "inherit" }}
          onClick={onRemove}
        >
          <IconX aria-hidden="true" className="size-3" />
        </button>
      )}
    </span>
  );
}

export function historyLabelTarget(
  label: RepositoryHistoryRefTarget,
): RepositoryRefTarget | undefined {
  if (label.type === "branch") return { _tag: "LocalBranch", name: label.name };
  if (label.type === "tag") return { _tag: "Tag", name: label.name };
  if (label.type === "remote-branch") {
    const separator = label.name.indexOf("/");
    if (separator > 0)
      return {
        _tag: "RemoteBranch",
        remote: label.name.slice(0, separator),
        name: label.name.slice(separator + 1),
      };
  }
  return undefined;
}

function GitProviderIcon({ remote }: { readonly remote: string }) {
  const provider = useGraphRefAppearance().providers.get(remote) ?? "git";
  if (provider === "codeberg" || provider === "gitea" || provider === "forgejo")
    return (
      <svg
        viewBox="0 0 24 24"
        className="size-3 shrink-0"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d={paths[provider]} />
      </svg>
    );
  const Icon = icons[provider];
  return <Icon aria-hidden="true" className="size-3 shrink-0" />;
}

const icons = {
  github: IconBrandGithubFilled,
  gitlab: IconBrandGitlab,
  bitbucket: IconBrandBitbucketFilled,
  azure: IconBrandAzure,
  aws: IconBrandAws,
  git: IconBrandGit,
};
const paths = {
  codeberg:
    "M11.999.747A11.974 11.974 0 0 0 0 12.75c0 2.254.635 4.465 1.833 6.376L11.837 6.19c.072-.092.251-.092.323 0l4.178 5.402h-2.992l.065.239h3.113l.882 1.138h-3.674l.103.374h3.86l.777 1.003h-4.358l.135.483h4.593l.695.894h-5.038l.165.589h5.326l.609.785h-5.717l.182.65h6.038l.562.727h-6.397l.183.65h6.717A12.003 12.003 0 0 0 24 12.75 11.977 11.977 0 0 0 11.999.747zm3.654 19.104.182.65h5.326c.173-.204.353-.433.513-.65zm.385 1.377.18.65h3.563c.233-.198.485-.428.712-.65zm.383 1.377.182.648h1.203c.356-.204.685-.412 1.042-.648zz",
  gitea:
    "M4.209 4.603c-.247 0-.525.02-.84.088-.333.07-1.28.283-2.054 1.027C-.403 7.25.035 9.685.089 10.052c.065.446.263 1.687 1.21 2.768 1.749 2.141 5.513 2.092 5.513 2.092s.462 1.103 1.168 2.119c.955 1.263 1.936 2.248 2.89 2.367 2.406 0 7.212-.004 7.212-.004s.458.004 1.08-.394c.535-.324 1.013-.893 1.013-.893s.492-.527 1.18-1.73c.21-.37.385-.729.538-1.068 0 0 2.107-4.471 2.107-8.823-.042-1.318-.367-1.55-.443-1.627-.156-.156-.366-.153-.366-.153s-4.475.252-6.792.306c-.508.011-1.012.023-1.512.027v4.474l-.634-.301c0-1.39-.004-4.17-.004-4.17-1.107.016-3.405-.084-3.405-.084s-5.399-.27-5.987-.324c-.187-.011-.401-.032-.648-.032zm.354 1.832h.111s.271 2.269.6 3.597C5.549 11.147 6.22 13 6.22 13s-.996-.119-1.641-.348c-.99-.324-1.409-.714-1.409-.714s-.73-.511-1.096-1.52C1.444 8.73 2.021 7.7 2.021 7.7s.32-.859 1.47-1.145c.395-.106.863-.12 1.072-.12zm8.33 2.554c.26.003.509.127.509.127l.868.422-.529 1.075a.686.686 0 0 0-.614.359.685.685 0 0 0 .072.756l-.939 1.924a.69.69 0 0 0-.66.527.687.687 0 0 0 .347.763.686.686 0 0 0 .867-.206.688.688 0 0 0-.069-.882l.916-1.874a.667.667 0 0 0 .237-.02.657.657 0 0 0 .271-.137 8.826 8.826 0 0 1 1.016.512.761.761 0 0 1 .286.282c.073.21-.073.569-.073.569-.087.29-.702 1.55-.702 1.55a.692.692 0 0 0-.676.477.681.681 0 1 0 1.157-.252c.073-.141.141-.282.214-.431.19-.397.515-1.16.515-1.16.035-.066.218-.394.103-.814-.095-.435-.48-.638-.48-.638-.467-.301-1.116-.58-1.116-.58s0-.156-.042-.27a.688.688 0 0 0-.148-.241l.516-1.062 2.89 1.401s.48.218.583.619c.073.282-.019.534-.069.657-.24.587-2.1 4.317-2.1 4.317s-.232.554-.748.588a1.065 1.065 0 0 1-.393-.045l-.202-.08-4.31-2.1s-.417-.218-.49-.596c-.083-.31.104-.691.104-.691l2.073-4.272s.183-.37.466-.497a.855.855 0 0 1 .35-.077z",
  forgejo:
    "M16.7773 0c1.6018 0 2.9004 1.2986 2.9004 2.9005s-1.2986 2.9004-2.9004 2.9004c-1.0854 0-2.0315-.596-2.5288-1.4787H12.91c-2.3322 0-4.2272 1.8718-4.2649 4.195l-.0007 2.1175a7.0759 7.0759 0 0 1 4.148-1.4205l.1176-.001 1.3385.0002c.4973-.8827 1.4434-1.4788 2.5288-1.4788 1.6018 0 2.9004 1.2986 2.9004 2.9005s-1.2986 2.9004-2.9004 2.9004c-1.0854 0-2.0315-.596-2.5288-1.4787H12.91c-2.3322 0-4.2272 1.8718-4.2649 4.195l-.0007 2.319c.8827.4973 1.4788 1.4434 1.4788 2.5287 0 1.602-1.2986 2.9005-2.9005 2.9005-1.6018 0-2.9004-1.2986-2.9004-2.9005 0-1.0853.596-2.0314 1.4788-2.5287l-.0002-9.9831c0-3.887 3.1195-7.0453 6.9915-7.108l.1176-.001h1.3385C14.7458.5962 15.692 0 16.7773 0ZM7.2227 19.9052c-.6596 0-1.1943.5347-1.1943 1.1943s.5347 1.1943 1.1943 1.1943 1.1944-.5347 1.1944-1.1943-.5348-1.1943-1.1944-1.1943Zm9.5546-10.4644c-.6596 0-1.1944.5347-1.1944 1.1943s.5348 1.1943 1.1944 1.1943c.6596 0 1.1943-.5347 1.1943-1.1943s-.5347-1.1943-1.1943-1.1943Zm0-7.7346c-.6596 0-1.1944.5347-1.1944 1.1943s.5348 1.1943 1.1944 1.1943c.6596 0 1.1943-.5347 1.1943-1.1943s-.5347-1.1943-1.1943-1.1943Z",
};

export function graphRefLabels(
  refs: readonly RepositoryHistoryRefTarget[],
  rows: readonly CommitLaneRow[],
  roots: readonly RepositoryHistoryRefTarget[],
) {
  const remote = new Set(
    rows.filter((row) => row.nodeRemote).map((row) => row.oid),
  );
  const selected = new Set(roots.map((ref) => `${ref.type}\0${ref.name}`));
  const labels = new Map<string, RepositoryHistoryRefTarget[]>();
  for (const ref of refs) {
    if (ref.type === "head") continue;
    if (
      ref.type !== "tag" &&
      remote.has(ref.oid) &&
      !selected.has(`${ref.type}\0${ref.name}`)
    )
      continue;
    const current = labels.get(ref.oid);
    if (current === undefined) labels.set(ref.oid, [ref]);
    else current.push(ref);
  }
  return labels;
}
