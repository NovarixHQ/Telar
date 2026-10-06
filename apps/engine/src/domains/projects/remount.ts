import fs from "node:fs";
import path from "node:path";
import { workspaceBaseRef, workspacePath, type Project, type Session } from "@telar/engine-client";
import { EngineStateError, type Kernel } from "../../platform/kernel";
import { findVolumeMount, forgetVolumeIds, volumeForRoot, type VolumeDeps, type VolumeIdentity } from "../../platform/fs/volumes";
import type { AsyncGitRunner } from "../../platform/git/runner";
import { sessionMetadataFile, storedSession } from "../sessions";
import type { WorktreePlan } from "../worktrees";
import type { ProjectProbes } from "./probes";
import { existingDirectory, type ProjectRegistry } from "./registry";
import { planRelocation, repairWorktrees } from "./relocate";

type RemountDeps = {
  registry: ProjectRegistry;
  probes: ProjectProbes;
  volumes: VolumeDeps;
  asyncGit: AsyncGitRunner;
  sessions: () => Session[];
  hasWorkInFlight: (sessionId: string) => boolean;
  prepareWorktree: (sessionId: string, projectRoot: string, plan: WorktreePlan, baseSha: string) => void;
};

/**
 * The two sanctioned writes of `Project.root`: a drive that came back mounted at
 * a new path (matched on the volume uuid, never a name, and only when the folder
 * exists on it), and a folder the owner points the project at by hand.
 */
export class ProjectRemounts {
  private readonly recovering = new Map<string, Promise<Project | undefined>>();

  constructor(
    private readonly kernel: Kernel,
    private readonly deps: RemountDeps,
  ) {}

  /** The updated project, or nothing when there was nothing to recover. */
  recover(project: Project): Promise<Project | undefined> {
    const running = this.recovering.get(project.id);
    if (running) return running;
    const recovery = this.search(project).finally(() => this.recovering.delete(project.id));
    this.recovering.set(project.id, recovery);
    return recovery;
  }

  private async search(project: Project): Promise<Project | undefined> {
    if (project.volume === undefined) return undefined;
    const mount = await findVolumeMount(project.volume.uuid, this.deps.volumes);
    if (mount === undefined || mount === project.volume.mount) return undefined;
    const within = path.relative(project.volume.mount, project.root);
    if (within.startsWith("..") || path.isAbsolute(within)) return undefined;
    const root = within === "" ? mount : path.join(mount, within);
    const directory = await fs.promises.stat(root).then((stats) => stats.isDirectory(), () => false);
    if (!directory) return undefined;

    const moved = this.moveRoot(project.id, root, { mount, uuid: project.volume.uuid });
    if (moved === undefined) return undefined;

    // A record the engine rewrote on its own must be findable afterwards.
    process.stdout.write(
      `Telar engine: ${project.name} came back on its own drive at a new path — ${moved.previousRoot} → ${root}` +
        `${moved.sessions > 0 ? ` (${moved.sessions} session${moved.sessions === 1 ? "" : "s"} moved with it)` : ""}\n`,
    );

    this.retryCutsFailedWhileAway(project.id, root);
    return moved.project;
  }

  async relocate(projectId: string, requested: unknown): Promise<Project> {
    const project = this.deps.registry.get(projectId);
    if (project.removedAt !== undefined) throw new EngineStateError("conflict", "this project was removed from Telar; restore it to change its folder");
    const root = existingDirectory(requested);
    if (root !== project.root) {
      const other = this.deps.registry.read().projects.find((candidate) => candidate.id !== projectId && candidate.root === root);
      if (other) {
        throw new EngineStateError("conflict", `${other.name} already uses that folder${other.removedAt === undefined ? "" : " (removed from Telar; restore it instead)"}`);
      }
      const sessions = this.deps.sessions().filter((session) => session.projectId === projectId);
      const busy = sessions.filter((session) => this.deps.hasWorkInFlight(session.id)).length;
      if (busy > 0) {
        throw new EngineStateError("conflict", `${busy === 1 ? "A session has" : `${busy} sessions have`} work in flight — let it finish or stop it first`);
      }
      const worktrees = await planRelocation(this.deps.asyncGit, { name: project.name, previousRoot: project.root, root, sessions });
      await repairWorktrees(this.deps.asyncGit, root, worktrees);
      const volume = volumeForRoot(root, this.deps.volumes);
      if (this.moveRoot(projectId, root, volume) === undefined) throw new EngineStateError("not_found", "project does not exist");
      this.deps.registry.recordVolumeLater(projectId, root, volume);
      for (const worktree of worktrees) this.deps.probes.forgetReads({ id: projectId, root: worktree });
      this.retryCutsFailedWhileAway(projectId, root);
    }
    const updated = this.deps.registry.get(projectId);
    return { ...updated, availability: await this.deps.probes.probe(updated) };
  }

  // Local sessions work in the root and move with it; a worktree's checkout lives on the internal disk and stays.
  private moveRoot(projectId: string, root: string, volume: VolumeIdentity | undefined): { project: Project; previousRoot: string; sessions: number } | undefined {
    const parsed = this.deps.registry.read();
    const stored = parsed.projects.find((candidate) => candidate.id === projectId);
    if (stored === undefined) return undefined;
    const previousRoot = stored.root;
    stored.root = root;
    if (volume === undefined) delete stored.volume;
    else stored.volume = volume;
    stored.updatedAt = this.kernel.now();
    this.kernel.writeDocument(this.kernel.paths.projects, parsed);

    let sessions = 0;
    const prefix = previousRoot.endsWith(path.sep) ? previousRoot : `${previousRoot}${path.sep}`;
    for (const session of this.deps.sessions()) {
      if (session.projectId !== projectId) continue;
      const current = workspacePath(session.workspace);
      if (current === undefined) continue;
      if (current !== previousRoot && !current.startsWith(prefix)) continue;
      const next = current === previousRoot ? root : path.join(root, current.slice(prefix.length));
      const updated: Session = {
        ...session,
        workspace: { ...session.workspace, path: next } as Session["workspace"],
        updatedAt: this.kernel.now(),
      };
      this.kernel.writeDocument(sessionMetadataFile(this.kernel.paths, session.id), storedSession(updated));
      this.kernel.appendEvent(session.id, { type: "session.updated", session: updated });
      sessions += 1;
    }

    this.deps.probes.forgetReads({ id: projectId, root: previousRoot });
    this.deps.probes.forgetReads({ id: projectId, root });
    this.deps.probes.forgetAvailability(projectId);
    return { project: structuredClone(stored), previousRoot, sessions };
  }

  // Once, and only on recovery: a cut that failed for its own reasons still fails with the folder back.
  private retryCutsFailedWhileAway(projectId: string, projectRoot: string): void {
    for (const session of this.deps.sessions()) {
      if (session.projectId !== projectId) continue;
      if (session.preparation?.state !== "failed") continue;
      if (session.workspace.mode !== "worktree") continue;
      const plan: WorktreePlan = { path: session.workspace.path, branch: session.workspace.branch, named: false };
      const baseSha = workspaceBaseRef(session.workspace);
      if (baseSha === undefined) continue;
      this.deps.prepareWorktree(session.id, projectRoot, plan, baseSha);
    }
  }

  /** Asks every project's disk now, when the shell sees a mount change, and searches for any that cannot be read. */
  async reprobe(): Promise<{ projects: number; changed: number; recovered: number }> {
    forgetVolumeIds(this.deps.volumes);
    const projects = this.deps.registry.read().projects.filter((project) => project.removedAt === undefined);
    const outcomes = await Promise.all(projects.map(async (project) => {
      const before = this.deps.probes.lastAvailability(project.id);
      let availability = await this.deps.probes.probe(project);
      const recovered = availability !== "available" && (await this.recover(project)) !== undefined;
      if (recovered) availability = await this.deps.probes.probe(this.deps.registry.get(project.id));
      return { changed: availability !== before, recovered };
    }));
    return {
      projects: projects.length,
      changed: outcomes.filter((outcome) => outcome.changed).length,
      recovered: outcomes.filter((outcome) => outcome.recovered).length,
    };
  }
}
