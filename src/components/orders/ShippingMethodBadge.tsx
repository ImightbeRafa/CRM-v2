'use client';

import type { CSSProperties } from 'react';
import {
  COD_LABEL,
  resolveShippingMethod,
  type ShippingMethodInput,
  type ShippingMethodKind,
} from '@/lib/orders/shipping-method';

type Theme = 'light' | 'dark';

const ICONS: Record<ShippingMethodKind, string> = {
  correos: '📮',
  mensajeria: '🛵',
  retiro: '🏬',
  unknown: '📦',
};

const TONES: Record<Theme, Record<ShippingMethodKind | 'cod', { fg: string; bg: string; border: string }>> = {
  // Palette vars (src/app/theme-palette.css, RGB channels) follow the app's dark mode.
  light: {
    correos: { fg: 'rgb(var(--p-tx-blue-700, 29 78 216))', bg: 'rgb(var(--p-bg-blue-50, 239 246 255))', border: 'rgb(var(--p-bd-blue-200, 191 219 254))' },
    mensajeria: { fg: 'rgb(var(--p-tx-violet-700, 109 40 217))', bg: 'rgb(var(--p-bg-violet-50, 245 243 255))', border: 'rgb(var(--p-bd-violet-200, 221 214 254))' },
    retiro: { fg: 'rgb(var(--p-tx-emerald-700, 4 120 87))', bg: 'rgb(var(--p-bg-emerald-50, 236 253 245))', border: 'rgb(var(--p-bd-emerald-200, 167 243 208))' },
    unknown: { fg: 'rgb(var(--p-tx-slate-600, 71 85 105))', bg: 'rgb(var(--p-bg-slate-50, 248 250 252))', border: 'rgb(var(--p-bd-slate-200, 226 232 240))' },
    cod: { fg: 'rgb(var(--p-tx-amber-700, 180 83 9))', bg: 'rgb(var(--p-bg-amber-50, 255 251 235))', border: 'rgb(var(--p-bd-amber-200, 253 230 138))' },
  },
  dark: {
    correos: { fg: '#93c5fd', bg: 'rgba(96,165,250,0.12)', border: 'rgba(96,165,250,0.35)' },
    mensajeria: { fg: '#c4b5fd', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.35)' },
    retiro: { fg: '#6ee7b7', bg: 'rgba(52,211,153,0.12)', border: 'rgba(52,211,153,0.35)' },
    unknown: { fg: 'rgba(255,255,255,0.55)', bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.14)' },
    cod: { fg: '#fbbf24', bg: 'rgba(251,191,36,0.12)', border: 'rgba(251,191,36,0.35)' },
  },
};

/**
 * One pill that says how the order ships, e.g. "📮 Correos · Contra entrega".
 * Inline-styled so it fits both the dark logistics pages and Aurora/Tailwind.
 */
export default function ShippingMethodBadge({
  order,
  theme = 'light',
  size = 'sm',
  showCod = true,
  style,
}: {
  order: ShippingMethodInput;
  theme?: Theme;
  size?: 'xs' | 'sm';
  /** false where a payment column already says "Contra entrega". */
  showCod?: boolean;
  style?: CSSProperties;
}) {
  const resolved = resolveShippingMethod(order);
  const info = showCod ? resolved : { ...resolved, cod: false, label: resolved.methodLabel };
  const tones = TONES[theme];
  const tone = info.kind === 'unknown' && info.cod ? tones.cod : tones[info.kind];
  const showMethod = !(info.kind === 'unknown' && info.cod);
  const title = [
    `Envío: ${info.methodLabel}`,
    info.courierName ? `(${info.courierName})` : '',
    info.cod ? `· ${COD_LABEL}` : '',
  ].filter(Boolean).join(' ');

  return (
    <span
      title={title}
      aria-label={info.label}
      data-shipping-method={info.kind}
      data-cod={info.cod ? 'true' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
        maxWidth: '100%',
        padding: size === 'xs' ? '1px 7px' : '2px 8px',
        borderRadius: 999,
        border: `1px solid ${tone.border}`,
        background: tone.bg,
        color: tone.fg,
        fontSize: size === 'xs' ? 10 : 11,
        fontWeight: 700,
        lineHeight: 1.35,
        whiteSpace: 'normal',
        ...style,
      }}
    >
      {showMethod && (
        <span>
          <span aria-hidden="true">{ICONS[info.kind]} </span>
          {info.methodLabel}
        </span>
      )}
      {info.cod && (
        <span style={{ color: tones.cod.fg }}>
          {showMethod ? '· ' : ''}
          <span aria-hidden="true">💵 </span>
          {COD_LABEL}
        </span>
      )}
    </span>
  );
}
