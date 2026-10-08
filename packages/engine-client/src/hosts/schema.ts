import { z } from "zod";

export const LOCAL_HOST_ID = "local";

export type PublicHost = { id: string; name: string; baseUrl: string; daemonId?: string; addedAt: number };

export const EngineIdentity = z.object({
  hostId: z.string().regex(/^host_/),
  name: z.string().optional(),
  appVersion: z.string(),
});
export type EngineIdentity = z.infer<typeof EngineIdentity>;

export const HostIdentity = EngineIdentity.extend({ addresses: z.array(z.string()) });
export type HostIdentity = z.infer<typeof HostIdentity>;
