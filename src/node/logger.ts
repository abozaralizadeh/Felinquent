import fs from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
/** Keys that never reach a log file at the default level. Window titles are personal. */
const PRIVATE_KEYS = new Set(["title", "titles", "window_title", "windowTitle", "text", "caret"]);

export interface LoggerOptions {
  dir: string;
  /** File name without extension. */
  name: string;
  /** Default 5 MB. */
  maxBytes?: number;
  /** Total files kept including the current one. Default 3. */
  maxFiles?: number;
  level?: LogLevel;
  /** Mirror lines to stdout (journald picks them up on a VM). */
  stdout?: boolean;
}

/**
 * Size-limited log file. When the file is full it rotates: name.log -> name.log.1 -> name.log.2 ...
 * The oldest file is deleted, so the folder never grows past maxBytes * maxFiles.
 */
export class RotatingLogger {
  readonly file: string;
  private size = 0;
  private readonly maxBytes: number;
  private readonly maxFiles: number;
  private level: LogLevel;

  constructor(private opts: LoggerOptions) {
    this.maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
    this.maxFiles = Math.max(1, opts.maxFiles ?? 3);
    this.level = opts.level ?? "info";
    fs.mkdirSync(opts.dir, { recursive: true });
    this.file = path.join(opts.dir, `${opts.name}.log`);
    try {
      this.size = fs.statSync(this.file).size;
    } catch {
      this.size = 0;
    }
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  private rotate(): void {
    const oldest = `${this.file}.${this.maxFiles - 1}`;
    if (this.maxFiles > 1 && fs.existsSync(oldest)) fs.rmSync(oldest);
    for (let i = this.maxFiles - 2; i >= 1; i--) {
      const from = `${this.file}.${i}`;
      if (fs.existsSync(from)) fs.renameSync(from, `${this.file}.${i + 1}`);
    }
    if (this.maxFiles > 1) fs.renameSync(this.file, `${this.file}.1`);
    else fs.rmSync(this.file);
    this.size = 0;
  }

  private clean(fields: Record<string, unknown> | undefined): string {
    if (!fields) return "";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (this.level !== "debug" && PRIVATE_KEYS.has(k)) continue;
      out[k] = typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}...` : v;
    }
    return Object.keys(out).length ? ` ${JSON.stringify(out)}` : "";
  }

  log(level: LogLevel, message: string, fields?: Record<string, unknown>): void {
    if (ORDER[level] < ORDER[this.level]) return;
    const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${this.clean(fields)}\n`;
    const bytes = Buffer.byteLength(line);
    if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
    fs.appendFileSync(this.file, line);
    this.size += bytes;
    if (this.opts.stdout) process.stdout.write(line);
  }

  debug(m: string, f?: Record<string, unknown>): void {
    this.log("debug", m, f);
  }
  info(m: string, f?: Record<string, unknown>): void {
    this.log("info", m, f);
  }
  warn(m: string, f?: Record<string, unknown>): void {
    this.log("warn", m, f);
  }
  error(m: string, f?: Record<string, unknown>): void {
    this.log("error", m, f);
  }
}
