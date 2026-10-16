import type { FileReference, WorkspaceDirectory, WorkspaceFile, WorkspaceListing, WorkspaceWriteResult } from "@telar/engine-client";
import type { AsyncGitRunner } from "../../platform/git/runner";
import { listWorkspaceDirectory } from "./directory";
import { readFencedAsync, readFencedBytes, writeFenced } from "./fenced";
import { resolveFileReferences } from "./references";

type FileBytes = { data: Buffer; mediaType: string; bytes: number };

/** A project's or a session's files, fenced to its root. */
export class WorkspaceFiles {
  constructor(
    private readonly deps: { git: AsyncGitRunner; projectRoot: (projectId: string) => string; sessionRoot: (sessionId: string) => string },
  ) {}

  project(projectId: string, target: string): Promise<WorkspaceFile> {
    return readFencedAsync(this.deps.projectRoot(projectId), target, "project");
  }

  session(sessionId: string, target: string): Promise<WorkspaceFile> {
    return readFencedAsync(this.deps.sessionRoot(sessionId), target, "session workspace");
  }

  projectDirectory(projectId: string, dir: string): Promise<WorkspaceDirectory> {
    return listWorkspaceDirectory(this.deps.git, { root: this.deps.projectRoot(projectId), dir, label: "project" });
  }

  sessionDirectory(sessionId: string, dir: string): Promise<WorkspaceDirectory> {
    return listWorkspaceDirectory(this.deps.git, { root: this.deps.sessionRoot(sessionId), dir, label: "session workspace" });
  }

  sessionReferences(sessionId: string, texts: readonly string[], listing: () => Promise<WorkspaceListing>): Promise<FileReference[]> {
    return resolveFileReferences(this.deps.sessionRoot(sessionId), texts, listing);
  }

  projectBytes(projectId: string, target: string): Promise<FileBytes> {
    return readFencedBytes(this.deps.projectRoot(projectId), target, "project");
  }

  sessionBytes(sessionId: string, target: string): Promise<FileBytes> {
    return readFencedBytes(this.deps.sessionRoot(sessionId), target, "session workspace");
  }

  /** `expected` is the hash the editor read; a stale one is refused rather than overwritten. */
  writeProject(projectId: string, target: string, text: string, expected: string): WorkspaceWriteResult {
    return writeFenced(this.deps.projectRoot(projectId), target, text, expected, "project");
  }

  writeSession(sessionId: string, target: string, text: string, expected: string): WorkspaceWriteResult {
    return writeFenced(this.deps.sessionRoot(sessionId), target, text, expected, "session workspace");
  }
}
