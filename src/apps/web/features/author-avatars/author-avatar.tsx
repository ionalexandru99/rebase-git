import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type { RepositoryCommit } from "#contracts/repository-history/repository-history.contract.ts";
import {
  type AuthorAvatarModel,
  createAuthorAvatarModel,
} from "#web/features/author-avatars/author-avatar-model.ts";
import {
  avatarSourceFor,
  type HostedRepository,
} from "#web/features/author-avatars/author-avatar-providers.ts";
import { browserAvatarStore } from "#web/features/author-avatars/author-avatar-store.ts";

const AvatarContext = createContext<AuthorAvatarModel | undefined>(undefined);

export function AuthorAvatars({
  repository,
  children,
}: {
  readonly repository: HostedRepository | undefined;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<{
    readonly model: AuthorAvatarModel;
    readonly repository: HostedRepository | undefined;
  }>();
  useEffect(() => {
    const model =
      repository === undefined
        ? undefined
        : createAuthorAvatarModel(
            avatarSourceFor(repository),
            browserAvatarStore,
          );
    setState(model === undefined ? undefined : { model, repository });
    return () => model?.dispose();
  }, [repository]);
  return (
    <AvatarContext
      value={state?.repository === repository ? state?.model : undefined}
    >
      {children}
    </AvatarContext>
  );
}

export function AuthorAvatar({
  commit,
}: {
  readonly commit: Pick<RepositoryCommit, "oid" | "author">;
}) {
  const model = useContext(AvatarContext);
  const oid = commit.oid;
  const email = commit.author.email;
  const subscribe = useCallback(
    (listener: () => void) =>
      model?.subscribe({ oid, author: { email } }, listener) ?? (() => {}),
    [model, oid, email],
  );
  const get = useCallback(() => model?.get(email), [model, email]);
  const url = useSyncExternalStore(subscribe, get);
  const [failed, setFailed] = useState<string>();
  const names = commit.author.name.trim().split(/\s+/).filter(Boolean);
  const initials =
    [names[0]?.[0], names.length > 1 ? names.at(-1)?.[0] : undefined]
      .join("")
      .toUpperCase() || "?";
  return (
    <span
      aria-hidden="true"
      className="grid size-[18px] shrink-0 place-items-center overflow-hidden rounded-full bg-accent text-[8px]"
    >
      {url === undefined || url === failed ? (
        initials
      ) : (
        <img
          alt=""
          src={url}
          width={18}
          height={18}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(url)}
        />
      )}
    </span>
  );
}
