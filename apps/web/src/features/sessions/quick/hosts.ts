"use client";

import { useEffect, useState } from "react";
import type { Project, PublicHost } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";

export type QuickProject = Project & { hostId: string; hostName?: string };

const apis = new Map<string, ReturnType<typeof createEngineApi>>();

export function hostApi(hostId: string = LOCAL_HOST_ID) {
  let api = apis.get(hostId);
  if (!api) {
    api = createEngineApi(hostFetcher(hostId));
    apis.set(hostId, api);
  }
  return api;
}

export const projectKey = (project: Pick<QuickProject, "id" | "hostId">) => `${project.hostId}:${project.id}`;

export function useHostProjects(hosts: readonly PublicHost[]) {
  const [projects, setProjects] = useState<readonly QuickProject[]>([]);
  const book = JSON.stringify(hosts.map((host) => [host.id, host.name]));
  useEffect(() => {
    let live = true;
    const remotes = (JSON.parse(book) as [string, string][]).map(([id, name]) => ({ id, name }));
    const reach: { id: string; name?: string }[] = [{ id: LOCAL_HOST_ID }, ...remotes];
    void Promise.allSettled(reach.map((host) => hostApi(host.id).projects().then(({ projects: listed }) => listed.map((project) => ({ ...project, hostId: host.id, ...(host.name ? { hostName: host.name } : {}) }))))).then((reads) => {
      if (live) setProjects(reads.flatMap((read) => (read.status === "fulfilled" ? read.value : [])));
    });
    return () => {
      live = false;
    };
  }, [book]);
  return projects;
}
