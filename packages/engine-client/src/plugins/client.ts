import type { EngineTransport } from "../platform/transport";
import type { PluginInstallInput, PluginStatus, ProjectPlugins } from "./schema";
import type { DataScienceCreateEnvironment } from "./toolchains";

export const pluginsClient = {
  machinePlugins(this: EngineTransport): Promise<{ plugins: PluginStatus[]; machine: ProjectPlugins }> {
    return this.request("GET", "/v2/plugins");
  },

  /** Refused with the manifest's problem when the plugin would not load. */
  installPlugin(this: EngineTransport, input: PluginInstallInput): Promise<{ plugin: PluginStatus }> {
    return this.request("POST", "/v2/plugins/installed", input);
  },

  /** A linked plugin is only unlinked. */
  uninstallPlugin(this: EngineTransport, id: string): Promise<{ removed: true }> {
    return this.request("DELETE", `/v2/plugins/installed/${encodeURIComponent(id)}`);
  },

  async pluginAsset(this: EngineTransport, pluginId: string, asset: string): Promise<{ text: string; contentType: string }> {
    const { data, contentType } = await this.readBytes(`/v2/plugin-assets/${encodeURIComponent(pluginId)}/${asset.split("/").map(encodeURIComponent).join("/")}`);
    return { text: new TextDecoder().decode(data), contentType };
  },

  updateMachinePlugins(
    this: EngineTransport,
    plugins: Record<string, { enabled: boolean; settings?: Record<string, unknown> } | null>,
  ): Promise<{ machine: ProjectPlugins }> {
    return this.request("PATCH", "/v2/plugins", { plugins });
  },

  dataScienceCreateEnvironment(this: EngineTransport, projectId: string, request: DataScienceCreateEnvironment): Promise<{ jobId: string }> {
    return this.request("POST", `/v2/projects/${encodeURIComponent(projectId)}/data-science/environments`, request);
  },
};
