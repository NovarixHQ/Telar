import { requireCli } from "../../domains/providers";
import { createAcpDriver, type AcpDriverOptions } from "../acp";
import { ProviderUnavailableError, type TurnDriver } from "../contract";

function resolveCursorBinary(binaryPath?: string): string {
  try {
    return requireCli("cursor", binaryPath ? { binaryPath } : {});
  } catch (error) {
    throw new ProviderUnavailableError(error instanceof Error ? error.message : String(error));
  }
}

export function createCursorDriver(options: AcpDriverOptions & { resolveBin?: (binaryPath?: string) => string } = {}): TurnDriver {
  const acp = createAcpDriver(options);
  const resolve = options.resolveBin ?? resolveCursorBinary;
  return { ...acp, run: async (run) => acp.run({ ...run, binaryPath: resolve(run.binaryPath), extraArgs: ["acp", ...(run.extraArgs ?? [])] }) };
}
