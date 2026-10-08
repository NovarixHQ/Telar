"use client";

import { LoadFailure } from "@/ui/load-failure";

export default function RouteError({ error, retry }: { error: Error; retry: () => void }) {
  return <LoadFailure error={error} retry={retry} label="This page" />;
}
