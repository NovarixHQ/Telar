type TelarTheme = { scheme: "light" | "dark"; variables: Record<string, string> };

type TelarFile = { path: string; text: string; sha256: string; bytes: number; binary: boolean; truncated: boolean };

interface TelarView {
  readonly version: 1;
  context(): Promise<{ plugin: string; view: string; path?: string }>;
  readFile(path?: string): Promise<TelarFile>;
  call<T = unknown>(verb: string, input?: Record<string, unknown>): Promise<T>;
  openFile(path: string, line?: number): Promise<void>;
  insertText(text: string): Promise<void>;
  onTheme(listener: (theme: TelarTheme) => void): void;
  onEvent(listener: (event: { name: string; data: unknown }) => void): void;
}

declare const telar: TelarView;
