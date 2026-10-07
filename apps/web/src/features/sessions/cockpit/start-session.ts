import { seedSessionTitle, type ProviderDriverKind, type RuntimeMode, type Session, type TurnModelSelection } from "@telar/engine-client";
import { newRunId, type createEngineApi } from "@/platform/engine";
import { splitImages } from "@/features/prompts";
import { choiceNamesAnything, choiceOf, sessionModelSelection, type ModelChoice } from "@/features/providers";
import { newSessionId } from "../session-mutations";

type Api = ReturnType<typeof createEngineApi>;

export type CreationChoices = {
  driver: ProviderDriverKind;
  envMode: "local" | "worktree";
  base: { baseRef?: string; branchName?: string };
  pick: ModelChoice;
  runtimeMode: RuntimeMode;
  runtimeModeTouched: boolean;
};

export function creationBody(id: string, title: string, { driver, envMode, base }: Pick<CreationChoices, "driver" | "envMode" | "base">) {
  return {
    id,
    title,
    driver,
    envMode,
    ...(envMode === "worktree" && base.baseRef ? { baseRef: base.baseRef } : {}),
    ...(envMode === "worktree" && base.branchName ? { branchName: base.branchName } : {}),
  };
}

export async function applyCreationChoices(api: Api, created: Session, choices: Pick<CreationChoices, "pick" | "runtimeMode" | "runtimeModeTouched">) {
  const model = sessionModelSelection(created.providerInstanceId, choices.pick);
  const patch = { ...(choices.runtimeModeTouched ? { runtimeMode: choices.runtimeMode } : {}), ...(model ? { model } : {}) };
  return Object.keys(patch).length > 0 ? (await api.updateSession(created.id, patch)).session : undefined;
}

export async function uploadAndSubmit(api: Api, sessionId: string, { runId, text, files, pick }: {
  runId: string;
  text: string;
  files: readonly File[];
  pick: Parameters<typeof choiceNamesAnything>[0];
}) {
  const attachments: string[] = [];
  for (const file of files) attachments.push((await api.uploadAttachment(sessionId, file)).attachment.id);
  await api.submitTurn(sessionId, {
    runId,
    input: text,
    ...(choiceNamesAnything(pick) ? { model: choiceOf(pick) as TurnModelSelection } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  });
}

export async function startSession(api: Api, { projectId, text, files, choices }: { projectId: string; text: string; files: readonly File[]; choices: CreationChoices }) {
  const title = seedSessionTitle(text, splitImages([...files]).images.map((file) => file.name));
  const { session: created } = await api.createSession(projectId, creationBody(newSessionId(), title, choices));
  const session = (await applyCreationChoices(api, created, choices)) ?? created;
  await uploadAndSubmit(api, session.id, { runId: newRunId(), text, files, pick: choices.pick });
  return session;
}
