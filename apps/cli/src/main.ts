import { isMcpBridgeProcess, runMcpBridge } from "@telar/engine/headless";
import { runCli } from "./cli";
import { processIo } from "./io";

if (isMcpBridgeProcess()) process.exit(await runMcpBridge().then(() => 0));

const command = process.argv[2];
const code = await runCli(process.argv.slice(2), processIo);
if (code !== 0 || command !== "serve") process.exit(code);
