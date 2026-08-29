export class CorreosAuthError extends Error {
  readonly statusCode: number;

  constructor(statusCode: number) {
    super(
      statusCode === 401 || statusCode === 403
        ? 'Correos rechazó las credenciales'
        : `Correos token auth failed (${statusCode})`,
    );
    this.name = 'CorreosAuthError';
    this.statusCode = statusCode;
  }
}

export function isCorreosCredentialRejection(error: string | null | undefined): boolean {
  if (!error) return false;
  return /401|403|rechazó las credenciales|token auth failed/i.test(error);
}

export function formatGuiaFailureLabel(error: string | null | undefined): string {
  return isCorreosCredentialRejection(error) ? 'Correos rechazó las credenciales' : 'Fallida';
}

export function formatGuiaFailureDetail(error: string | null | undefined): string | null {
  if (!error) return null;
  return isCorreosCredentialRejection(error) ? 'Correos rechazó las credenciales' : error;
}
