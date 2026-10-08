import {
  AudioLinesIcon,
  BlocksIcon,
  FlaskConicalIcon,
  FolderPlusIcon,
  BookMarkedIcon,
  CameraIcon,
  CircleUserRoundIcon,
  DownloadIcon,
  ExternalLinkIcon,
  FolderGitIcon,
  InfoIcon,
  KeyRoundIcon,
  KeyboardIcon,
  LanguagesIcon,
  LayersIcon,
  ListTreeIcon,
  MicIcon,
  MonitorIcon,
  PackageIcon,
  PaletteIcon,
  PlugIcon,
  PlugZapIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  SlidersHorizontalIcon,
  SparklesIcon,
  StethoscopeIcon,
  TimerIcon,
  TypeIcon,
  WrenchIcon,
} from "lucide-react";
import type { SettingsPageSpec } from "./search";
import { EXPERIMENTS } from "./experiments";

export const APP_PAGES: SettingsPageSpec[] = [
  {
    id: "general",
    label: "General",
    icon: SlidersHorizontalIcon,
    groups: [
      {
        title: "New sessions",
        rows: [
          {
            title: "Workspace",
            hint: "Each session gets its own checkout and branch, or every session shares the project checkout.",
            keywords: ["worktree", "branch", "git", "isolation"],
            icon: FolderGitIcon,
          },
          {
            title: "Access",
            hint: "The access mode a new conversation opens in. Each conversation can still change its own.",
            keywords: ["permissions", "supervised", "auto", "full access", "approval", "runtime mode", "prompts"],
            icon: ShieldCheckIcon,
          },
        ],
      },
      {
        title: "Organization",
        rows: [
          {
            title: "Group sessions by project",
            hint: "Off, the rail is one list, newest first, with spawned sessions under the one that started them.",
            keywords: ["group by", "flat", "none", "list", "sidebar", "order", "newest"],
            icon: ListTreeIcon,
          },
          {
            title: "Settle quiet sessions",
            hint: "Quiet sessions leave the list on their own, or nothing does. Shelved ones are on the rail, under Settled.",
            keywords: ["inbox", "archive", "auto", "shelf", "settled", "unsettle", "restore", "hidden", "put away", "quiet"],
            icon: TimerIcon,
          },
          {
            title: "Settle quiet sessions after",
            hint: "Time without activity. Pinned sessions and open questions stay put.",
            keywords: ["hours", "days", "window"],
            icon: TimerIcon,
          },
          {
            title: "Settle delegated conversations after their result is delivered",
            hint: "A conversation another session handed work to settles once the result is back.",
            keywords: ["delegated", "errand", "coordinator", "handoff", "result", "settle"],
            icon: TimerIcon,
          },
          {
            title: "Settle delegated conversations after",
            hint: "How long after delivery. A failed errand, a pinned row and an open question all stay put.",
            keywords: ["hours", "days", "window", "delegated"],
            icon: TimerIcon,
          },
          {
            title: "Continue after a usage limit resets",
            hint: "A turn stopped by a usage limit runs again once the limit lifts.",
            keywords: ["rate limit", "usage limit", "resume", "five-hour", "weekly", "claude"],
            icon: RefreshCwIcon,
          },
          {
            title: "Continue after Telar restarts",
            hint: "When Telar restarts to update, the sessions it stopped pick up where they left off.",
            keywords: ["resume", "restart", "update", "continue", "interrupted"],
            icon: RefreshCwIcon,
          },
        ],
      },
      {
        title: "Text generation",
        rows: [
          {
            title: "Written by",
            hint: "Which provider writes the session title and branch name.",
            keywords: ["claude", "codex", "opencode", "driver"],
            icon: SparklesIcon,
          },
          {
            title: "Model",
            hint: "The small model that writes titles and branch names.",
            keywords: ["title model", "textgen"],
            icon: SparklesIcon,
          },
          {
            title: "Effort",
            hint: "How hard the model thinks before it names a session.",
            keywords: ["reasoning", "thinking", "textgen"],
            icon: SparklesIcon,
          },
          {
            title: "Name sessions",
            hint: "Replaces the truncated first message. A title you set yourself is never touched.",
            keywords: ["title", "rename", "automatic"],
            icon: SparklesIcon,
          },
        ],
      },
      {
        title: "Experimental",
        rows: EXPERIMENTS.map((experiment) => ({
          title: experiment.label,
          hint: experiment.hint,
          keywords: ["experiment", "trial", "beta", "preview"],
          icon: FlaskConicalIcon,
        })),
      },
      {
        title: "About",
        rows: [
          { title: "Version", hint: "Which build of Telar this install is.", keywords: ["about", "this build"], icon: InfoIcon },
          {
            title: "Engine",
            hint: "Whether the thing that runs turns is answering.",
            keywords: ["daemon", "offline", "health"],
            icon: InfoIcon,
          },
          {
            title: "Update status",
            hint: "Check for a new build, and install one that has been found.",
            keywords: ["upgrade", "download", "version", "updates"],
            icon: DownloadIcon,
          },
          {
            title: "Channel",
            hint: "Which stream of builds this install follows.",
            keywords: ["beta", "nightly", "stable", "release", "updates"],
            icon: DownloadIcon,
          },
          {
            title: "Install on quit",
            hint: "A downloaded update installs itself the next time you quit Telar.",
            keywords: ["restart", "automatic", "updates"],
            icon: DownloadIcon,
          },
        ],
      },
    ],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaletteIcon,
    groups: [
      {
        title: "Window",
        rows: [
          {
            title: "Translucency",
            hint: "Off, blurred or clear glass. Rebuilds the window. The macOS desktop app only.",
            keywords: ["glass", "blur", "clear", "frost", "vibrancy", "transparent"],
            icon: MonitorIcon,
          },
          {
            title: "Layers through canvas and rail",
            hint: "How much of the composition's layers, and the desktop behind a translucent window, show through the app.",
            keywords: ["show-through", "show through", "opacity", "wallpaper", "backdrop", "layers"],
            icon: MonitorIcon,
          },
          {
            title: "Colour scheme",
            hint: "Light, dark, or whatever the system is doing — and which state of the composition the composer edits.",
            keywords: ["light", "dark", "system", "theme", "mode"],
            icon: MonitorIcon,
          },
          {
            title: "Chat width",
            hint: "How wide the conversation and the composer can grow.",
            keywords: ["wide", "full", "comfortable", "column", "measure", "transcript"],
            icon: MonitorIcon,
          },
        ],
      },
      {
        title: "Background",
        rows: [
          {
            title: "Base",
            hint: "The app colour every surface is derived from, per colour state.",
            keywords: ["colour", "color", "theme", "palette", "hue", "tint", "background", "canvas"],
            icon: PaletteIcon,
          },
          {
            title: "Match the other state",
            hint: "Carries this state's look over to the other one, light or dark.",
            keywords: ["light", "dark", "copy", "sync", "both"],
            icon: PaletteIcon,
          },
        ],
      },
      {
        title: "Type and surfaces",
        rows: [
          {
            title: "Accent",
            hint: "The one hue that means a person acted — buttons, links, the caret.",
            keywords: ["colour", "color", "highlight", "primary", "hue"],
            icon: PaletteIcon,
          },
          {
            title: "Depth",
            hint: "How far raised surfaces — cards, the composer, menus — sit off the page.",
            keywords: ["shadow", "elevation", "flat", "soft", "deep", "raised"],
            icon: LayersIcon,
          },
        ],
      },
    ],
  },
  {
    id: "keybindings",
    label: "Keybindings",
    icon: KeyboardIcon,
    groups: [
      {
        rows: [
          {
            navigateOnly: true,
            title: "Keyboard shortcuts",
            hint: "Every chord this app answers to, and what each one does — the same list the command palette runs.",
            keywords: [
              "shortcut",
              "hotkey",
              "chord",
              "accelerator",
              "binding",
              "cmd",
              "command key",
              "keyboard",
              "command palette",
              "palette",
              "cmd k",
              "go to file",
              "quick open",
            ],
            icon: KeyboardIcon,
          },
        ],
      },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    icon: PlugZapIcon,
    groups: [
      {
        rows: [
          {
            navigateOnly: true,
            title: "Browser profiles",
            hint: "The identities Telar's own browser signs in as, one set of cookies each.",
            keywords: ["cookies", "account", "sign in", "chrome", "profile", "default", "browser", "integrations"],
            icon: CircleUserRoundIcon,
          },
          {
            navigateOnly: true,
            title: "Remembered logins",
            hint: "Logins you allowed agents to fill without asking again, one 1Password item each.",
            keywords: ["1password", "password", "credential", "autofill", "revoke", "vault", "integrations"],
            icon: KeyRoundIcon,
          },
          {
            title: "Use a password manager in the browser",
            hint: "Lets Telar's browser and agents fill logins from your password manager.",
            keywords: ["1password", "extension", "autofill", "disable", "off", "credential", "integrations"],
            icon: KeyRoundIcon,
          },
          {
            title: "Offer to remember after you sign in",
            hint: "After you type a login in Telar's browser, ask whether agents may reuse it.",
            keywords: ["1password", "save login", "remember", "offer", "prompt", "password"],
            icon: KeyRoundIcon,
          },
        ],
      },
      {
        title: "Site permissions",
        rows: [
          {
            title: "Nothing decided yet",
            hint: "Camera, microphone, notifications, location, clipboard and screen sharing, per site and per browser profile.",
            keywords: ["camera", "microphone", "mic", "webcam", "notifications", "location", "geolocation", "clipboard", "screen share", "screen sharing", "permission", "permissions", "allow", "block", "revoke", "site"],
            icon: CameraIcon,
          },
        ],
      },
      {
        title: "Links",
        rows: [
          {
            title: "Open in the session's browser",
            hint: "Issues and pull requests open in the right panel; other links open as tabs the agent can see.",
            keywords: ["external", "system browser", "tabs"],
            icon: ExternalLinkIcon,
          },
        ],
      },
      {
        title: "Simulators",
        rows: [
          {
            title: "Simulators",
            hint: "Who may list, start and use the simulators on this Mac: nobody, you, or you and agents.",
            keywords: ["simulator", "emulator", "iphone", "ios", "android", "device", "xcode", "agent", "agent-device", "tap", "automation"],
            icon: SmartphoneIcon,
          },
        ],
      },
      {
        title: "Agent tools",
        rows: [
          {
            title: "Tell agents they are inside Telar",
            hint: "A paragraph each turn and a skill file for each provider, so agents read Telar's words the way you mean them.",
            keywords: ["orientation", "preamble", "system prompt", "prompt", "context", "skill", "SKILL.md", "instructions", "telar", "show the text"],
            icon: SparklesIcon,
          },
        ],
      },
      {
        rows: [
          {
            navigateOnly: true,
            title: "Add a server",
            hint: "Tool servers every project sees. A project can define one with the same id to replace it for itself.",
            keywords: ["mcp", "stdio", "sse", "http", "tool", "server"],
            icon: WrenchIcon,
          },
        ],
      },
      {
        rows: [
          {
            title: "Computer use",
            hint: "Whether sessions can drive Mac apps — screenshots, clicks, typing.",
            keywords: [
              "cua",
              "driver",
              "automation",
              "engine",
              "access",
              "permission",
              "privacy",
              "accessibility",
              "screen recording",
              "grant",
            ],
            icon: MonitorIcon,
          },
        ],
      },
      {
        title: "Dictation",
        rows: [
          {
            title: "Provider",
            hint: "Who transcribes, or nobody. Off by default: no mic button anywhere, and this computer's own dictation keeps working in the message box.",
            keywords: [
              "dictation",
              "dictate",
              "microphone",
              "mic",
              "voice",
              "speech",
              "transcribe",
              "transcription",
              "provider",
              "off",
              "disable",
              "turn off",
              "turn on",
              "enable",
              "deepgram",
            ],
            icon: MicIcon,
          },
          {
            title: "Language",
            hint: "Which language is transcribed. Automatic detects it; one language is more accurate within it.",
            keywords: ["spanish", "english", "automatic", "multilingual", "locale"],
            icon: LanguagesIcon,
          },
          {
            title: "Service key",
            hint: "The credential this computer spends on transcription. Stored with its engine state; the browser and the phone only ever get a token that expires in minutes.",
            keywords: ["dictation", "dictate", "microphone", "mic", "voice", "speech", "transcribe", "transcription", "deepgram", "key", "api key", "credential"],
            icon: KeyRoundIcon,
          },
          {
            title: "Vocabulary",
            hint: "Words the recogniser has no reason to expect, one per line. Your conversations, projects and branches are already sent; this is the rest.",
            keywords: [
              "dictation",
              "vocabulary",
              "glossary",
              "keyterm",
              "keyterms",
              "terms",
              "custom words",
              "jargon",
              "names",
              "spelling",
              "accuracy",
              "wrong word",
            ],
            icon: BookMarkedIcon,
          },
        ],
      },
      {
        title: "Microphone",
        rows: [
          {
            title: "Input",
            hint: "Which microphone dictation records from. Kept in this browser alone, so a phone or another computer keeps its own.",
            keywords: ["input", "device", "which microphone", "choose microphone", "headset", "airpods", "usb", "interface", "built-in", "default input", "wrong microphone"],
            icon: MicIcon,
          },
          {
            title: "Level",
            hint: "Whether the microphone is being heard at all, read straight off the input without transcribing — so it works with no key and no connection.",
            keywords: ["level", "meter", "volume", "test microphone", "not hearing", "no audio", "silent", "muted", "dead", "check"],
            icon: AudioLinesIcon,
          },
          {
            title: "Live transcript",
            hint: "A real transcription in the pane, discarded rather than sent — to see the words arrive and be rewritten in place before they settle.",
            keywords: ["demo", "preview", "try", "live", "test transcription", "interim", "rewritten", "see it working"],
            icon: TypeIcon,
          },
        ],
      },
    ],
  },
  {
    id: "providers",
    label: "Providers",
    icon: PlugIcon,
    groups: [
      {
        rows: [
          {
            navigateOnly: true,
            title: "Add a login",
            hint: "Each login is a CLI already on this machine. Telar never signs you in; tokens stay where the CLI put them.",
            keywords: ["account", "claude", "codex", "api key", "sign in", "auth", "provider"],
            icon: PlugIcon,
          },
        ],
      },
      {
        title: "Usage providers",
        rows: [
          {
            navigateOnly: true,
            title: "Add hub",
            hint: "Hubs that pool subscription accounts. Their remaining quota shows under Limits on the Usage page.",
            keywords: ["cliproxy", "cliproxyapi", "hub", "proxy", "quota", "limit", "limits", "usage", "pooled", "rate limit", "5h", "weekly", "remaining"],
            icon: ServerIcon,
          },
        ],
      },
      {
        title: "Diagnosis",
        rows: [
          {
            title: "Diagnose usage",
            hint: "An agent reads this computer's usage in the background, read-only, and explains what drives it.",
            keywords: ["diagnose", "diagnosis", "high usage", "why", "tokens", "cost", "spend", "expensive", "report"],
            icon: StethoscopeIcon,
          },
        ],
      },
    ],
  },
  {
    id: "plugins",
    label: "Plugins",
    icon: BlocksIcon,
    groups: [
      {
        rows: [
          {
            navigateOnly: true,
            title: "Plugins",
            hint: "Which plugins are registered with the engine, whether each is on for this computer, and the defaults a project inherits.",
            keywords: [
              "latex",
              "data science",
              "extension",
              "enable",
              "tectonic",
              "tex distribution",
              "texlive",
              "default engine",
              "packages",
              "default python",
            ],
            icon: BlocksIcon,
          },
          {
            title: "Add plugin from folder",
            hint: "Copy it in, or link it to keep editing it where it is.",
            keywords: ["install", "plugin", "folder", "link", "remove", "uninstall", "plugin.json"],
            icon: FolderPlusIcon,
          },
        ],
      },
      {
        title: "TeX distribution",
        rows: [
          {
            id: "plugins-latex-managed",
            title: "Telar (managed)",
            hint: "A TeX engine Telar downloads itself, so LaTeX works on a computer with no TeX installed.",
            keywords: ["tectonic", "latex", "install", "tex", "download"],
            icon: DownloadIcon,
          },
        ],
      },
      {
        rows: [
          {
            id: "plugins-data-science-packages",
            title: "Default packages",
            hint: "Installed into environments Telar creates from here on.",
            keywords: ["pandas", "numpy", "packages", "pip", "environment", "data science"],
            icon: PackageIcon,
          },
        ],
      },
    ],
  },
];
