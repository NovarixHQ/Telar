export type ServiceSpec = { command: string[]; home: string; logFile: string };

export const SYSTEMD_UNIT = "telar.service";
export const LAUNCHD_LABEL = "com.telar.cli";

const systemdQuote = (arg: string): string => `"${arg.replace(/[\\"]/g, "\\$&").replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
const xml = (text: string): string => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function systemdUnit({ command }: ServiceSpec): string {
  return `[Unit]
Description=Telar engine
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=${command.map(systemdQuote).join(" ")}
Restart=on-failure
RestartSec=3
KillMode=control-group
TimeoutStopSec=20

[Install]
WantedBy=default.target
`;
}

export function launchdPlist({ command, home, logFile }: ServiceSpec): string {
  const args = command.map((arg) => `    <string>${xml(arg)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>WorkingDirectory</key>
  <string>${xml(home)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}
