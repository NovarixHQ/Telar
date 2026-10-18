const detail = (error: unknown): string => (error instanceof Error ? (error.stack ?? error.message) : String(error));
const headline = (error: unknown): string => (error instanceof Error ? `${error.name}: ${error.message}` : String(error));

// A client that vanishes mid-request is not a reason to stop every session on the engine.
const PEER_GONE = new Set(["ECONNRESET", "EPIPE", "ECONNABORTED", "ERR_STREAM_PREMATURE_CLOSE"]);

export function installLastResortHandlers(): void {
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`Telar engine: kept running past an unhandled rejection: ${detail(reason)}\n`);
  });
  process.on("uncaughtException", (error) => {
    if (PEER_GONE.has((error as NodeJS.ErrnoException).code ?? "")) {
      process.stderr.write(`Telar engine: kept running past a dropped connection: ${headline(error)}\n`);
      return;
    }
    process.stderr.write(`Telar engine stopped: uncaught ${headline(error).split("\n")[0]}\n${detail(error)}\n`);
    process.exit(1);
  });
}
