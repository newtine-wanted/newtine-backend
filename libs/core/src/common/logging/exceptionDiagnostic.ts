const MAX_CAUSE_DEPTH = 5;
const MAX_STACK_LENGTH = 8_192;
const SENSITIVE_ASSIGNMENT =
  /((?:pass(?:word|code|phrase)?|secret|token|authorization|cookie|credential|(?:access|refresh)[-_ ]?token|(?:api|private)[-_ ]?key)\s*[=:]\s*)([^\s,;]+)/gi;
const SENSITIVE_QUERY =
  /([?&](?:token|access_token|refresh_token|code|key|secret|password|signature)=)[^&\s]+/gi;
const BEARER_TOKEN = /(Bearer\s+)[^\s]+/gi;

export function exceptionDiagnostic(exception: unknown): Record<string, unknown> {
  return toDiagnostic(exception, new Set<Error>());
}

function toDiagnostic(exception: unknown, seen: Set<Error>): Record<string, unknown> {
  if (!(exception instanceof Error)) {
    return { thrownType: typeof exception };
  }

  if (seen.has(exception) || seen.size >= MAX_CAUSE_DEPTH) {
    return { causeTruncated: true };
  }
  seen.add(exception);

  const diagnostic: Record<string, unknown> = {
    name: safeExceptionName(exception.name),
  };
  const stack = safeStack(exception.stack);
  if (stack !== undefined) {
    diagnostic.stack = stack;
  }

  if (exception.cause !== undefined) {
    diagnostic.cause = toDiagnostic(exception.cause, seen);
  }

  return diagnostic;
}

function safeExceptionName(name: string): string {
  return /^[A-Za-z][A-Za-z0-9_.-]{0,100}$/.test(name) ? name : 'Error';
}

function safeStack(stack: string | undefined): string | undefined {
  if (stack === undefined) return undefined;

  // Error.stack starts with "<name>: <message>". Drop that line so exception
  // messages cannot be copied into structured logs, even when they contain secrets.
  const frames = stack.split('\n').slice(1).join('\n').trim();
  if (frames.length === 0) return undefined;

  const sanitized = frames
    .replace(SENSITIVE_ASSIGNMENT, '$1[REDACTED]')
    .replace(SENSITIVE_QUERY, '$1[REDACTED]')
    .replace(BEARER_TOKEN, '$1[REDACTED]');

  return sanitized.length > MAX_STACK_LENGTH
    ? `${sanitized.slice(0, MAX_STACK_LENGTH)}…[TRUNCATED]`
    : sanitized;
}
