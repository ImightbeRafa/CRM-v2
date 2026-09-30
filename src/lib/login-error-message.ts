/**
 * Spanish text for the codes the credentials login can return (src/lib/auth-gates.ts), shared by
 * every login form (sign-in page, landing modal, accept-invite). Client-safe.
 */
export function loginErrorMessage(code: string | null | undefined, fallback = 'Credenciales inválidas'): string {
  if (code === 'EMAIL_NOT_VERIFIED') return 'Verifica tu email para entrar. Te enviamos un enlace al registrarte.'
  if (code === 'LOCKED') return 'Demasiados intentos fallidos. Espera 15 minutos o restablece tu contraseña.'
  // Google sign-in with an invite that could not be accepted (redirect from the signIn callback).
  if (code === 'invite_seat_limit') return 'El negocio que te invitó llegó a su límite de usuarios. Pedile al dueño que amplíe el plan.'
  if (code === 'invite_invalid') return 'La invitación ya no es válida. Pedí una nueva.'
  return fallback
}
