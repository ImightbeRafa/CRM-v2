'use client';

import { motion, AnimatePresence } from 'framer-motion';

const STATUS_MAP: Record<string, { dot: string; bg: string; text: string }> = {
  pendiente:        { dot: 'bg-amber-500',   bg: 'bg-amber-50 dark:bg-amber-950/40',   text: 'text-amber-700 dark:text-amber-400' },
  'en proceso':     { dot: 'bg-blue-500',    bg: 'bg-blue-50 dark:bg-blue-950/40',    text: 'text-blue-700 dark:text-blue-400' },
  completado:       { dot: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/40', text: 'text-emerald-700 dark:text-emerald-400' },
  entregado:        { dot: 'bg-violet-500',  bg: 'bg-violet-50 dark:bg-violet-950/40',  text: 'text-violet-700 dark:text-violet-400' },
  enviado:          { dot: 'bg-violet-500',  bg: 'bg-violet-50 dark:bg-violet-950/40',  text: 'text-violet-700 dark:text-violet-400' },
  cancelado:        { dot: 'bg-red-500',     bg: 'bg-red-50 dark:bg-red-950/40',     text: 'text-red-700 dark:text-red-400' },
  drive:            { dot: 'bg-yellow-600',  bg: 'bg-yellow-50 dark:bg-yellow-950/40',  text: 'text-yellow-700 dark:text-yellow-400' },
  impreso:          { dot: 'bg-gray-500',    bg: 'bg-gray-100 dark:bg-gray-800/40',   text: 'text-gray-700 dark:text-gray-400' },
  pendientediseño:  { dot: 'bg-purple-500',  bg: 'bg-purple-50 dark:bg-purple-950/40',  text: 'text-purple-700 dark:text-purple-400' },
};

function getStatusStyle(status: string) {
  const key = status.toLowerCase();
  return STATUS_MAP[key] ?? { dot: 'bg-gray-400', bg: 'bg-gray-100 dark:bg-gray-800/40', text: 'text-gray-700 dark:text-gray-400' };
}

export function StatusBadge({ status }: { status: string }) {
  const style = getStatusStyle(status);

  return (
    <AnimatePresence mode="wait">
      <motion.span
        key={status}
        initial={{ scale: 0.85, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${style.bg} ${style.text}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
        {status}
      </motion.span>
    </AnimatePresence>
  );
}
