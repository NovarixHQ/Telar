const LIMIT = 48_000;

type State = "text" | "escape" | "csi" | "string" | "stringEscape" | "charset";

/** A terminal's bytes as plain text: escapes dropped, a carriage return rewrites its line, the oldest lines trimmed past 48k. */
export class TerminalScreen {
  private lines: string[] = [];
  private kept = 0;
  private line = "";
  private state: State = "text";
  private returned = false;

  get text(): string {
    return this.lines.length === 0 ? this.line : `${this.lines.join("\n")}\n${this.line}`;
  }

  feed(chunk: string): void {
    for (const char of chunk) {
      switch (this.state) {
        case "text":
          this.put(char);
          break;
        case "escape":
          if (char === "[") this.state = "csi";
          else if ("]P_^X".includes(char)) this.state = "string";
          else if ("()*+".includes(char)) this.state = "charset";
          else this.state = "text";
          break;
        case "csi": {
          const code = char.codePointAt(0)!;
          if (code >= 0x40 && code <= 0x7e) this.state = "text";
          break;
        }
        case "string":
          if (char === "\u0007") this.state = "text";
          else if (char === "\u001b") this.state = "stringEscape";
          break;
        default:
          this.state = "text";
      }
    }
    if (this.kept + this.line.length > LIMIT) this.trim();
  }

  private put(char: string): void {
    if (char === "\u001b") this.state = "escape";
    else if (char === "\r") this.returned = true;
    else if (char === "\n") {
      this.returned = false;
      this.lines.push(this.line);
      this.kept += this.line.length + 1;
      this.line = "";
    } else if (char === "\b") this.line = this.line.slice(0, -1);
    else if (char === "\t" || (char >= " " && char !== "\u007f")) this.write(char);
  }

  private write(char: string): void {
    if (this.returned) {
      this.returned = false;
      this.line = "";
    }
    this.line += char;
  }

  private trim(): void {
    let drop = 0;
    while (drop < this.lines.length && this.kept + this.line.length > (LIMIT * 3) / 4) this.kept -= this.lines[drop++]!.length + 1;
    this.lines = this.lines.slice(drop);
    if (this.kept + this.line.length > LIMIT) this.line = "";
  }
}
