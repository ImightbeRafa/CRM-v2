import type { CSSProperties, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The one chip / badge for order states across Betsy (payment, shipping method,
 * fulfilment status). Same radius, 1px border, padding and lucide icon scale
 * everywhere; no emoji.
 *
 * surface="aurora" (default) uses palette classes, so it follows dark mode.
 * surface="dark" is for the always-dark Logística pages (fixed tints).
 */
export type ChipTone = 'neutral' | 'brand' | 'violet' | 'info' | 'success' | 'warning' | 'danger';

const AURORA_TONE: Record<ChipTone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-600',
  brand: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  violet: 'border-violet-200 bg-violet-50 text-violet-700',
  info: 'border-sky-200 bg-sky-50 text-sky-700',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  warning: 'border-amber-200 bg-amber-50 text-amber-700',
  danger: 'border-red-200 bg-red-50 text-red-700',
};

const DARK_TONE: Record<ChipTone, CSSProperties> = {
  neutral: { color: 'rgba(255,255,255,0.7)', background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.14)' },
  brand: { color: '#a5b4fc', background: 'rgba(129,140,248,0.12)', borderColor: 'rgba(129,140,248,0.32)' },
  violet: { color: '#c4b5fd', background: 'rgba(167,139,250,0.12)', borderColor: 'rgba(167,139,250,0.32)' },
  info: { color: '#93c5fd', background: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.32)' },
  success: { color: '#6ee7b7', background: 'rgba(52,211,153,0.12)', borderColor: 'rgba(52,211,153,0.32)' },
  warning: { color: '#fcd34d', background: 'rgba(251,191,36,0.12)', borderColor: 'rgba(251,191,36,0.32)' },
  danger: { color: '#fca5a5', background: 'rgba(248,113,113,0.12)', borderColor: 'rgba(248,113,113,0.32)' },
};

const SIZE = {
  sm: { box: 'h-6 gap-1 px-2 text-[11.5px]', icon: 12 },
  md: { box: 'h-7 gap-1.5 px-2.5 text-[12.5px]', icon: 14 },
} as const;

export function Chip({
  tone = 'neutral',
  icon: Icon,
  dot = false,
  size = 'sm',
  surface = 'aurora',
  title,
  className = '',
  style,
  children,
}: {
  tone?: ChipTone;
  icon?: LucideIcon;
  /** Small status dot in the chip colour (for free-form status names). */
  dot?: boolean;
  size?: keyof typeof SIZE;
  surface?: 'aurora' | 'dark';
  title?: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const s = SIZE[size];
  const toneClass = surface === 'aurora' ? AURORA_TONE[tone] : '';
  const toneStyle = surface === 'dark' ? DARK_TONE[tone] : undefined;
  return (
    <span
      title={title}
      data-chip-tone={tone}
      className={`inline-flex max-w-full shrink-0 items-center whitespace-nowrap rounded-full border font-medium leading-none ${s.box} ${toneClass} ${className}`}
      style={toneStyle || style ? { ...toneStyle, ...style } : undefined}
    >
      {Icon ? <Icon size={s.icon} strokeWidth={2} aria-hidden className="shrink-0" /> : null}
      {!Icon && dot ? <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-80" /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
