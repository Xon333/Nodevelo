// Structured substrate logging (ROADMAP P8): one grep-able line per event, routed through catches
// that used to fail silently. Not a framework — console.error/warn under a consistent shape.

type LogFields = Record<string, unknown>;

function emit(status: "error" | "warn", route: string, step: string, fields?: LogFields): void {
  const line = { t: new Date().toISOString(), route, step, status, ...fields };
  (status === "error" ? console.error : console.warn)(JSON.stringify(line));
}

export function logError(route: string, step: string, err: unknown, fields?: LogFields): void {
  emit("error", route, step, { message: err instanceof Error ? err.message : String(err), ...fields });
}

export function logWarn(route: string, step: string, message: string, fields?: LogFields): void {
  emit("warn", route, step, { message, ...fields });
}
