import { parseArgs } from "node:util";
import { doctor } from "./doctor";
import { resolveHome } from "./home";
import { UsageError, type Io } from "./io";
import { pair } from "./pair";
import { serve, serveOptions } from "./serve";

const USAGE = `Usage: telar <command> [options]

  serve [--host <addr>] [--port <n>] [--tailscale-serve]   Run the engine in the foreground
  pair [--tailscale] [--name <device>]                      Print a link and code for a new device
  doctor                                                    Check this machine

Every command takes --home <dir> (default: $TELAR_HOME, then $XDG_DATA_HOME/telar).`;

const OPTIONS = {
  home: { type: "string" },
  host: { type: "string" },
  port: { type: "string" },
  name: { type: "string" },
  tailscale: { type: "boolean" },
  "tailscale-serve": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

/** Resolves to the exit code; `serve` resolves once listening and the process then stays up. */
export async function runCli(argv: string[], io: Io): Promise<number> {
  try {
    const { values, positionals } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
    const [command] = positionals;
    if (!command || values.help) {
      io.out(USAGE);
      return command || values.help ? 0 : 1;
    }
    const home = resolveHome(values.home);
    if (command === "serve") {
      await serve(serveOptions(values, home), io);
      return 0;
    }
    if (command === "pair") {
      const abort = new AbortController();
      process.once("SIGINT", () => abort.abort());
      return await pair({ home, tailscale: values.tailscale === true, ...(values.name ? { name: values.name } : {}), signal: abort.signal }, io);
    }
    if (command === "doctor") return await doctor(home, io);
    throw new UsageError(`Unknown command: ${command}\n\n${USAGE}`);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return error instanceof UsageError || (error as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? 2 : 1;
  }
}
