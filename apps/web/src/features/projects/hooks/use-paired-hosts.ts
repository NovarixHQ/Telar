"use client";

import { useEffect, useState } from "react";
import type { PublicHost } from "@telar/engine-client";
import { createEngineApi } from "@/platform/engine";
import { hostFetcher, LOCAL_HOST_ID } from "@/platform/engine/host-client";

const localApi = createEngineApi(hostFetcher(LOCAL_HOST_ID));
let lastKnown: PublicHost[] | undefined;

export function usePairedHosts(open: boolean): PublicHost[] | undefined {
  const [hosts, setHosts] = useState(lastKnown);
  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    void localApi
      .hosts()
      .then((answer) => answer.hosts, () => [])
      .then((next) => {
        lastKnown = next;
        if (live) setHosts(next);
      });
    return () => {
      live = false;
    };
  }, [open]);
  return hosts;
}
