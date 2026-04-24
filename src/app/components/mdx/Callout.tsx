'use client';

import React from 'react';
import { Info, Lightbulb, AlertTriangle, XCircle } from 'lucide-react';

const VARIANTS = {
  info: {
    icon: Info,
    border: 'border-l-blue-500',
    bg: 'bg-blue-50/70 dark:bg-blue-950/30',
    iconColor: 'text-blue-700 dark:text-blue-300',
    title: 'Información',
  },
  tip: {
    icon: Lightbulb,
    border: 'border-l-emerald-500',
    bg: 'bg-emerald-50/70 dark:bg-emerald-950/30',
    iconColor: 'text-emerald-700 dark:text-emerald-300',
    title: 'Consejo',
  },
  warning: {
    icon: AlertTriangle,
    border: 'border-l-amber-500',
    bg: 'bg-amber-50/70 dark:bg-amber-950/30',
    iconColor: 'text-amber-700 dark:text-amber-300',
    title: 'Advertencia',
  },
  danger: {
    icon: XCircle,
    border: 'border-l-red-500',
    bg: 'bg-red-50/70 dark:bg-red-950/30',
    iconColor: 'text-red-700 dark:text-red-300',
    title: 'Importante',
  },
} as const;

interface CalloutProps {
  type?: keyof typeof VARIANTS;
  title?: string;
  children: React.ReactNode;
}

export function Callout({ type = 'info', title, children }: CalloutProps) {
  const variant = VARIANTS[type];
  const Icon = variant.icon;

  return (
    <div className={`not-prose my-6 rounded-lg border border-border border-l-4 ${variant.border} ${variant.bg} p-4`}>
      <div className="flex gap-3">
        <Icon className={`h-5 w-5 shrink-0 mt-0.5 ${variant.iconColor}`} />
        <div className="min-w-0">
          <p className={`font-semibold text-sm mb-1 ${variant.iconColor}`}>
            {title || variant.title}
          </p>
          <div className="text-sm text-foreground/80 [&>p]:m-0 [&>ul]:mt-1 [&>ul]:mb-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
