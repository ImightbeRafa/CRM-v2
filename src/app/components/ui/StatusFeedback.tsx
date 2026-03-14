'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, X, Info } from 'lucide-react';

type FeedbackType = 'success' | 'error' | 'info';

interface StatusFeedbackProps {
  type: FeedbackType;
  title: string;
  description?: string;
  show: boolean;
  onDismiss?: () => void;
  autoDismissMs?: number;
}

const config: Record<FeedbackType, { icon: typeof CheckCircle; gradient: string; border: string }> = {
  success: {
    icon: CheckCircle,
    gradient: 'from-emerald-50 to-green-50',
    border: 'border-emerald-200',
  },
  error: {
    icon: AlertCircle,
    gradient: 'from-red-50 to-rose-50',
    border: 'border-red-200',
  },
  info: {
    icon: Info,
    gradient: 'from-blue-50 to-indigo-50',
    border: 'border-blue-200',
  },
};

const iconColors: Record<FeedbackType, string> = {
  success: 'text-emerald-600',
  error: 'text-red-600',
  info: 'text-blue-600',
};

export function StatusFeedback({
  type,
  title,
  description,
  show,
  onDismiss,
  autoDismissMs = 4000,
}: StatusFeedbackProps) {
  const [visible, setVisible] = useState(show);
  const { icon: Icon, gradient, border } = config[type];

  useEffect(() => {
    setVisible(show);
    if (show && autoDismissMs > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        onDismiss?.();
      }, autoDismissMs);
      return () => clearTimeout(timer);
    }
  }, [show, autoDismissMs, onDismiss]);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -8, height: 0 }}
          animate={{ opacity: 1, y: 0, height: 'auto' }}
          exit={{ opacity: 0, y: -8, height: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className={`bg-gradient-to-r ${gradient} border ${border} rounded-lg px-4 py-3 flex items-start gap-3`}
        >
          <Icon className={`h-5 w-5 flex-shrink-0 mt-0.5 ${iconColors[type]}`} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm text-foreground">{title}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
            )}
          </div>
          {onDismiss && (
            <button
              onClick={() => { setVisible(false); onDismiss(); }}
              className="text-muted-foreground hover:text-foreground p-1 -mr-1"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
