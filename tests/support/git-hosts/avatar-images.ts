import { Effect } from "effect";
import type { AvatarImages } from "#server/features/author-avatars/author-avatars.ts";
import type { AvatarSource } from "#server/features/source-control/git-host.ts";

export function fakeAvatarImages(
  images: Readonly<Record<string, string | "unavailable">>,
) {
  const downloads: AvatarSource[] = [];
  const avatarImages: AvatarImages = {
    download: (source) => {
      downloads.push(source);
      const image = images[source.url];
      return image === "unavailable"
        ? Effect.fail({ _tag: "AuthorAvatarUnavailable" })
        : Effect.succeed(image);
    },
  };
  return { avatarImages, downloads };
}
