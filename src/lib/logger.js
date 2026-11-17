const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function write(level, scope, message, extra) {
  if (LEVELS[level] < minLevel) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  if (extra === undefined) out(line);
  else out(line, extra);
}

export function createLogger(scope) {
  return {
    debug: (msg, extra) => write("debug", scope, msg, extra),
    info: (msg, extra) => write("info", scope, msg, extra),
    warn: (msg, extra) => write("warn", scope, msg, extra),
    error: (msg, extra) => write("error", scope, msg, extra),
  };
}
