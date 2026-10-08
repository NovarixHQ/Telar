import { z } from "zod";
import { Id } from "../protocol/common";

export const ArtifactKind = z.enum(["html", "svg", "markdown", "mermaid"]);
export type ArtifactKind = z.infer<typeof ArtifactKind>;

export const ArtifactId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);

export const MAX_ARTIFACT_BYTES = 512 * 1024;

export const ARTIFACT_HEIGHT = { min: 80, max: 2000 } as const;

/** One version of something an agent drew inline; the content is the attachment's bytes. */
export const Artifact = z.object({
  id: ArtifactId,
  kind: ArtifactKind,
  title: z.string().min(1).max(200),
  attachmentId: Id,
  version: z.number().int().positive(),
  height: z.number().int().min(ARTIFACT_HEIGHT.min).max(ARTIFACT_HEIGHT.max).optional(),
});
export type Artifact = z.infer<typeof Artifact>;

