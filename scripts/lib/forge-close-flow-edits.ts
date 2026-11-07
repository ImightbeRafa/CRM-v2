/**
 * Forge close flow (Rafael 2026-11-06, approved "Forge first"): when the agent asks for the shipping data it also asks
 * how they will pay, in the same turn; SINPE / transferencia → that method's details + "mandame el comprobante" right
 * away; data that arrives afterwards → "¡Gracias! Quedo atento al comprobante 🙌" (the chat waits for the receipt).
 * Replaces Forge's own "Nunca juntes datos y pago" / "en ese mensaje nada de pago" (Betsy's default close already
 * asks data + method together). Applied with deepsleep-no-weight-apply.ts --set=close-flow (backup + revert).
 */
import type { TextEdit } from '@/lib/soft-ai/text-patch'

export const CLOSE_INSTRUCTION_EDITS: TextEdit[] = [
  {
    // Instructions cap 1200: live 1197 → 1200.
    from: 'Comprar: 1) talla y cantidad 2) envío o retiro 3) datos en lista 4) pago. Nunca juntes datos y pago.',
    to: 'Comprar: talla/cantidad → envío/retiro → total + datos + cómo paga, juntos. SINPE: datos y comprobante.',
  },
]

/** The closing rule as applied on 2026-11-06 23:27Z (v1). */
const CLOSING_V1 =
  '1) "Lo quiero" sin talla: mandá la guía de tallas y pedí que elija su talla y la cantidad, nada más. 2) Si no lo dijo: ¿envío a domicilio o retiro con cita? 3) Con talla y cantidad cerrá en UN turno, cada cosa en su propio mensaje: el total; los datos, uno por renglón: Nombre completo / Teléfono / Correo (opcional) / Provincia / Cantón / Distrito / Dirección exacta con señas (retiro: nombre, teléfono y correo); y al final la pregunta de pago. 4) Si elige SINPE o transferencia: mandá esos datos de pago y pedí el comprobante, aunque falten sus datos. 5) Si manda sus datos después: «¡Gracias! Quedo atento al comprobante 🙌».'
/** SecureDog INT-266: rule 5 never covers a "ya pagué" (closing cap 800: 774 → 793). */
const CLOSING_V2 =
  '1) "Lo quiero" sin talla: guía de tallas y pedí talla y cantidad. 2) Si no lo dijo: ¿envío a domicilio o retiro con cita? 3) Con talla y cantidad cerrá en UN turno, cada cosa en su propio mensaje: el total; los datos, uno por renglón: Nombre completo / Teléfono / Correo (opcional) / Provincia / Cantón / Distrito / Dirección exacta con señas (retiro: nombre, teléfono y correo); y al final la pregunta de pago. 4) Si elige SINPE o transferencia: mandá esos datos de pago y pedí el comprobante, aunque falten sus datos. 5) Solo sus datos después: «¡Gracias! Quedo atento al comprobante 🙌»; si dice que ya pagó: escalate_to_human(payment_or_sinpe).'

export const CLOSE_SALES_RULE_EDITS: { closing: TextEdit[] } = {
  closing: [
    // Live v1 → v2 first (the original → v1 edit below then reads as already applied).
    { from: CLOSING_V1, to: CLOSING_V2 },
    {
      // Closing cap 800: live 601 → 793 (v2).
      from: 'UN paso por mensaje. 1) "Lo quiero" sin talla: mandá la guía de tallas y pedí que elija su talla y la cantidad, nada más. 2) Con la talla: ¿envío a domicilio o retiro con cita? 3) SOLO los datos, uno por renglón: Nombre completo / Teléfono / Correo (opcional) / Provincia / Cantón / Distrito / Dirección exacta con señas (retiro: nombre, teléfono y correo); en ese mensaje nada de pago. 4) Con los datos: cómo prefiere pagar y solo los datos de ese método.',
      to: CLOSING_V2,
    },
  ],
}
