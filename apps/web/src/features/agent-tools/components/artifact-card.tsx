"use client";

import { createContext, Suspense, useContext, useMemo, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { Artifact, Item } from "@telar/engine-client";
import { latestArtifacts } from "../artifacts";

const ArtifactView = dynamic(() => import("./artifact-view").then((mod) => mod.ArtifactView));

type Shelf = { latest: ReadonlyMap<string, Artifact>; hostId?: string };

const ShelfContext = createContext<Shelf>({ latest: new Map() });

export function ArtifactShelf({ items, hostId, children }: { items: Iterable<Pick<Item, "detail">>; hostId?: string; children: ReactNode }) {
  const latest = useMemo(() => latestArtifacts(items), [items]);
  const shelf = useMemo(() => ({ latest, ...(hostId ? { hostId } : {}) }), [latest, hostId]);
  return <ShelfContext.Provider value={shelf}>{children}</ShelfContext.Provider>;
}

export function ArtifactCard({ sessionId, artifact }: { sessionId: string; artifact: Artifact }) {
  const { latest, hostId } = useContext(ShelfContext);
  const newest = latest.get(artifact.id) ?? artifact;
  if (newest.version > artifact.version) return <p className="my-1 text-xs text-muted-foreground">{artifact.title} · updated below</p>;
  return (
    <figure aria-label={artifact.title} className="my-2">
      <Suspense fallback={null}>
        <ArtifactView {...(hostId ? { hostId } : {})} sessionId={sessionId} artifact={newest} />
      </Suspense>
    </figure>
  );
}
