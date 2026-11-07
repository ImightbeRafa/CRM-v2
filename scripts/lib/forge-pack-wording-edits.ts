/**
 * Forge "uno o dos" wording (Rafael 2026-11-06): "no el paquete de dos porque la gente cree que es otra cosa" — the
 * agent must offer ONE or TWO harnesses ("¿Te gustaría uno o dos?"), never "Pack de 2" / "paquete". Same prices
 * (1 = ₡14 900, 2 = ₡26 900, 3 = ₡41 800), only the words change. Exact sentence swaps on live Forge data, applied with
 * scripts/agent-pack/deepsleep-no-weight-apply.ts --set=pack-wording (backup + revert like the no-weight edits).
 * Saved-reply keywords ("pack de 2", "pack") stay: they are what customers type.
 */
import type { TextEdit } from '@/lib/soft-ai/text-patch'

export const PACK_INSTRUCTION_EDITS: TextEdit[] = [
  {
    from: 'Precio/soporte: Arnés ForgeCR ₡14 900, Pack de 2 ₡26 900, envío incluido + UNA pregunta que avance (apartar/cómo funciona/talla solo si ya compran).',
    // Instructions cap 1200: live 1199 → 1197.
    to: 'Precio: 1 arnés ₡14 900, 2 arneses ₡26 900, envío incluido + UNA pregunta (¿uno o dos?/cómo funciona/talla si compran). Nunca "pack" ni "paquete".',
  },
]

export const PACK_SHORTCUT_EDITS: Record<string, TextEdit[]> = {
  fg_precio: [
    {
      from: 'y el Pack de 2 sale ₡26 900 💪\n¿Te lo aparto o preferís ver cómo funciona?',
      to: 'y 2 arneses salen ₡26 900 en total 💪\n¿Te gustaría uno o dos?',
    },
  ],
  fg_dos: [{ from: 'El Pack de 2 sale ₡26 900 en total', to: 'Los 2 arneses salen ₡26 900 en total' }],
  fg_pareja: [{ from: 'Con el Pack de 2 salen ₡26 900 en total', to: 'Los 2 arneses salen ₡26 900 en total' }],
  fg_descuento: [{ from: 'o el Pack de 2 a ₡26 900', to: 'o 2 arneses por ₡26 900' }],
}

export const PACK_KNOWLEDGE_EDITS: Record<string, TextEdit[]> = {
  'ForgeCR · Preguntas frecuentes': [{ from: 'Pack de 2: ₡26 900 (podés mezclar tallas).', to: '2 arneses: ₡26 900 en total (podés mezclar tallas).' }],
  'ForgeCR · Arnés': [
    {
      from: 'Pack de 2: ₡26 900 (₡13 450 c/u, podés mezclar tallas); 3 = ₡41 800 (Pack de 2 + 1).',
      to: '2 arneses: ₡26 900 (₡13 450 c/u, podés mezclar tallas); 3 arneses: ₡41 800.',
    },
  ],
}

export const PACK_BRAND_FACT_EDITS: Record<string, TextEdit[]> = {
  'Precio (promo)': [{ from: 'Pack de 2: ₡26 900 (₡13 450 c/u, podés mezclar tallas).', to: '2 arneses: ₡26 900 en total (₡13 450 c/u, podés mezclar tallas).' }],
  'Totales (promo)': [
    {
      from: '1 = ₡14 900 · Pack de 2 = ₡26 900 · 3 = Pack de 2 + 1 = ₡41 800. Pareja (2 tallas distintas): Pack de 2, ₡26 900.',
      to: '1 = ₡14 900 · 2 = ₡26 900 · 3 = ₡41 800. Pareja (2 tallas distintas): 2 arneses, ₡26 900.',
    },
  ],
}

export const PACK_SALES_RULE_EDITS: {
  mustSay: TextEdit[]
  neverSay: TextEdit[]
  objections: TextEdit[]
  handoffWhen: TextEdit[]
  closing: TextEdit[]
  upsells: TextEdit[]
} = {
  mustSay: [
    {
      from: 'Precio (promo, como la web): ₡14 900 c/u con envío gratis; Pack de 2: ₡26 900',
      to: 'Precio (promo, como la web): 1 arnés ₡14 900 o 2 arneses ₡26 900, con envío gratis; preguntá "¿Te gustaría uno o dos?"',
    },
  ],
  neverSay: [
    {
      from: 'Cobrar envío (hoy es gratis por la promo) o inventar otros combos: solo el Pack de 2 (₡26 900); 3 = ₡41 800 (Pack de 2 + 1)',
      to: 'Cobrar envío (hoy es gratis por la promo), inventar otros combos o decir "pack" o "paquete": es 1 (₡14 900), 2 (₡26 900) o 3 arneses (₡41 800)',
    },
  ],
  objections: [{ from: '₡14 900 c/u o el Pack de 2 a ₡26 900', to: '₡14 900 c/u o 2 arneses por ₡26 900' }],
  handoffWhen: [{ from: 'y el Pack de 2 a ₡26 900 con envío gratis los respondés vos', to: 'y el precio de 2 arneses (₡26 900 con envío gratis) los respondés vos' }],
  closing: [{ from: '1 = ₡14 900 · Pack de 2 = ₡26 900 · 3 = ₡41 800 (Pack de 2 + 1)', to: '1 = ₡14 900 · 2 = ₡26 900 · 3 = ₡41 800' }],
  upsells: [
    {
      from: 'Si quiere 1, mencioná una vez el Pack de 2: ₡26 900 en total con envío gratis (₡13 450 c/u, podés mezclar tallas; ideal para pareja). 3 = ₡41 800 (Pack de 2 + 1).',
      to: 'Si quiere 1, mencioná una vez que 2 arneses salen ₡26 900 en total con envío gratis (₡13 450 c/u, podés mezclar tallas; ideal para pareja). 3 arneses = ₡41 800. Preguntá "¿Te gustaría uno o dos?", nunca "pack" ni "paquete".',
    },
  ],
}

/** salesRules.bundles: exact live name → new name (price / shipping unchanged). */
export const PACK_BUNDLE_RENAMES: Record<string, string> = {
  'Pack de 2 (mezclar tallas)': '2 arneses (podés mezclar tallas)',
  'Pack de 2 + 1 (3 arneses)': '3 arneses',
  '4 arneses (2 Pack de 2)': '4 arneses',
}
