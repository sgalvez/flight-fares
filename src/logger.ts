const ranks = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof ranks;

export class Logger {
  constructor(private readonly minimum: Level = "info") {}

  private write(level: Level, message: string, context?: Record<string, unknown>) {
    if (ranks[level] < ranks[this.minimum]) return;
    const entry = { timestamp: new Date().toISOString(), level, message, ...context };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  debug(message: string, context?: Record<string, unknown>) { this.write("debug", message, context); }
  info(message: string, context?: Record<string, unknown>) { this.write("info", message, context); }
  warn(message: string, context?: Record<string, unknown>) { this.write("warn", message, context); }
  error(message: string, context?: Record<string, unknown>) { this.write("error", message, context); }
}
