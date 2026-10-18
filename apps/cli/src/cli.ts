import { parseArgs } from "node:util";
import { auth, parseDuration, parseScopes } from "./auth";
import { doctor } from "./doctor";
import { resolveHome } from "./home";
import { UsageError, type Io } from "./io";
import { pair } from "./pair";
import { VERSION } from "./version";
import { serve, serveOptions } from "./serve";
import { defaultContext, installService, restartService, serviceStatus, uninstallService } from "./service";

const USAGE = `Usage: telar <command> [options]

  serve [--host <addr>] [--port <n>] [--tailscale-serve]   Run the engine in the foreground
  pair [--tailscale] [--name <device>] [--scopes <list>] [--expires <dur>]
                                                            Print a link and code for a new device
  auth session list                                         List paired sessions
  auth session revoke <id> | --all-others [--keep <id>]     Cut sessions off
  service install|status|restart|uninstall [--host <addr>] [--port <n>] [--tailscale-serve]
                                                            Run the engine in the background at login
  doctor                                                    Check this machine
  version                                                   Print the version

Every command takes --home <dir> (default: $TELAR_HOME, then $XDG_DATA_HOME/telar).`;

const OPTIONS = {
  home: { type: "string" },
  host: { type: "string" },
  port: { type: "string" },
  name: { type: "string" },
  scopes: { type: "string" },
  expires: { type: "string" },
  keep: { type: "string" },
  "all-others": { type: "boolean" },
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
    if (command === "version") {
      io.out(VERSION);
      return 0;
    }
    const home = resolveHome(values.home);
    if (command === "serve") {
      await serve(serveOptions(values, home), io);
      return 0;
    }
    if (command === "pair") {
      const abort = new AbortController();
      process.once("SIGINT", () => abort.abort());
      return await pair({ home, tailscale: values.tailscale === true, ...(values.name ? { name: values.name } : {}), ...(values.scopes ? { scopes: parseScopes(values.scopes) } : {}), ...(values.expires ? { expiresInMs: parseDuration(values.expires) } : {}), signal: abort.signal }, io);
    }
    if (command === "auth") {
      if (positionals[1] !== "session") throw new UsageError("Usage: telar auth session list | revoke <id>");
      return await auth({ home, action: positionals[2], ...(positionals[3] ? { id: positionals[3] } : {}), allOthers: values["all-others"] === true, ...(values.keep ? { keep: values.keep } : {}) }, io);
    }
    if (command === "service") {
      const ctx = defaultContext(home);
      const action = positionals[1];
      if (action === "install") await installService(ctx, serveOptions(values, home), io);
      else if (action === "status") return await serviceStatus(ctx, io);
      else if (action === "restart") await restartService(ctx, io);
      else if (action === "uninstall") await uninstallService(ctx, io);
      else throw new UsageError("Usage: telar service install|status|restart|uninstall");
      return 0;
    }
    if (command === "doctor") return await doctor(home, io);
    throw new UsageError(`Unknown command: ${command}\n\n${USAGE}`);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return error instanceof UsageError || (error as NodeJS.ErrnoException).code === "ERR_PARSE_ARGS_UNKNOWN_OPTION" ? 2 : 1;
  }
}
