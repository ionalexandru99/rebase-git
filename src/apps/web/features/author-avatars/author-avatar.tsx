import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AuthorAvatarModel,
  AvatarAuthor,
  GitHubRepository,
} from "#web/features/author-avatars/author-avatar.contract";
import { createAuthorAvatarModel } from "#web/features/author-avatars/author-avatar-model";

const AvatarContext = createContext<AuthorAvatarModel | undefined>(undefined);

export function AuthorAvatars({
  repository,
  children,
}: {
  readonly repository: GitHubRepository | undefined;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<{
    readonly model: AuthorAvatarModel;
    readonly owner: string;
    readonly name: string;
  }>();
  const owner = repository?.owner;
  const name = repository?.name;
  useEffect(() => {
    const next =
      owner === undefined || name === undefined
        ? undefined
        : createAuthorAvatarModel({ owner, name });
    setState(
      next === undefined || owner === undefined || name === undefined
        ? undefined
        : { model: next, owner, name },
    );
    return () => {
      void next?.dispose();
    };
  }, [owner, name]);
  return (
    <AvatarContext
      value={
        state?.owner === owner && state?.name === name
          ? state?.model
          : undefined
      }
    >
      {children}
    </AvatarContext>
  );
}

export function AuthorAvatar({ commit }: { readonly commit: AvatarAuthor }) {
  const model = useContext(AvatarContext);
  const subscribe = useCallback(
    (listener: () => void) => model?.subscribe(commit, listener) ?? (() => {}),
    [model, commit],
  );
  const get = useCallback(
    () => model?.get(commit.author.email),
    [model, commit.author.email],
  );
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
