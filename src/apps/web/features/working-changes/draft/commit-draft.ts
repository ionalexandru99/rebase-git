import type { CommitDraft } from "#web/persistence/working-changes/working-changes-store.contract";

export function commitMessage({ subject, description }: CommitDraft) {
  const body = description.trim();
  return subject.trim() + (body ? `\n\n${body}` : "");
}

export function draftFromMessage(message: string): CommitDraft {
  const [subject = "", ...body] = message.split(/\r?\n/);
  return { subject, description: body.join("\n").trimStart() };
}

export function amendDraftKey(draftKey: string, head: string | null) {
  return `${draftKey}:amend:${head}`;
}
