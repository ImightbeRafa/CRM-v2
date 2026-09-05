export class CorreosAuthError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(messageForTokenStatus(statusCode));
    this.name = 'CorreosAuthError';
    this.statusCode = statusCode;
  }
}

export function isCorreosProxyUnavailableStatus(statusCode: number): boolean {
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

function messageForTokenStatus(statusCode: number): string {
  if (statusCode === 401 || statusCode === 403) {
    return 'Correos rechazó las credenciales';
  }
  if (isCorreosProxyUnavailableStatus(statusCode)) {
    return `Correos proxy/token unavailable (${statusCode})`;
  }
  return `Correos token auth failed (${statusCode})`;
}

/**
 * True only for real credential rejections.
 * Do not treat generic "token auth failed" as 401 — a 502 from the Jetson
 * proxy is an upstream/outage, not bad Correos credentials.
 */
export function isCorreosCredentialRejection(error: string | null | undefined): boolean {
  if (!error) return false;
  if (isCorreosProxyUnavailable(error)) return false;
  return /rechazó las credenciales|\b401\b|\b403\b/i.test(error);
}

export function isCorreosProxyUnavailable(error: string | null | undefined): boolean {
  if (!error) return false;
  return /proxy\/token unavailable|\b502\b|\b503\b|\b504\b/i.test(error);
}

export function formatGuiaFailureLabel(error: string | null | undefined): string {
  if (isCorreosCredentialRejection(error)) return 'Correos rechazó las credenciales';
  if (isCorreosProxyUnavailable(error)) return 'Correos no disponible';
  return 'Fallida';
}

export function formatGuiaFailureDetail(error: string | null | undefined): string | null {
  if (!error) return null;
  if (isCorreosCredentialRejection(error)) return 'Correos rechazó las credenciales';
  if (isCorreosProxyUnavailable(error)) {
    return 'Correos :447 rechazó la conexión (ECONNREFUSED). El proxy y Cloudflare están bien; el token service de Correos no acepta TCP desde el Jetson.';
  }
  return error;
}

/** Admin-safe message for logistics / tenant guía APIs. */
export function formatLogisticsGuiaError(err: unknown): string {
  if (err instanceof CorreosAuthError) {
    return err.message;
  }
  const message = err instanceof Error ? err.message : '';
  if (isCorreosCredentialRejection(message) || isCorreosProxyUnavailable(message)) {
    return message;
  }
  if (/^ccr(GenerarGuia|RegistroEnvio|Tarifa) failed:/.test(message)) {
    return message;
  }
  return 'Guia generation failed due to a connection or service error';
}
