/**
 * Spanish text for the codes the credentials login can return (src/lib/auth-gates.ts), shared by
 * every login form (sign-in page, landing modal, accept-invite). Client-safe.
 */
export function loginErrorMessage(code: string | null | undefined, fallback = 'Credenciales inválidas'): string {
  if (code === 'EMAIL_NOT_VERIFIED') return 'Verifica tu email para entrar. Te enviamos un enlace al registrarte.'
  if (code === 'LOCKED') return 'Demasiados intentos fallidos. Espera 15 minutos o restablece tu contraseña.'
  return fallback
}
