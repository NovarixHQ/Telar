import { HostRegistry, wakeOnForeground } from "../../platform/connection";

export const hosts = new HostRegistry();

wakeOnForeground(hosts);
