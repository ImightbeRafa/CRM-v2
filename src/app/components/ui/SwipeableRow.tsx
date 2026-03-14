'use client';

import React, { useRef } from 'react';
import { motion, useMotionValue, useTransform, PanInfo } from 'framer-motion';

interface SwipeAction {
  label: string;
  icon: React.ReactNode;
  color: string;
  onAction: () => void;
}

interface SwipeableRowProps {
  children: React.ReactNode;
  leftAction?: SwipeAction;
  rightAction?: SwipeAction;
  threshold?: number;
  className?: string;
}

const THRESHOLD = 80;

export function SwipeableRow({
  children,
  leftAction,
  rightAction,
  threshold = THRESHOLD,
  className = '',
}: SwipeableRowProps) {
  const x = useMotionValue(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const leftOpacity = useTransform(x, [0, threshold], [0, 1]);
  const rightOpacity = useTransform(x, [-threshold, 0], [1, 0]);
  const leftScale = useTransform(x, [0, threshold], [0.5, 1]);
  const rightScale = useTransform(x, [-threshold, 0], [1, 0.5]);

  const handleDragEnd = (_: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    const offset = info.offset.x;

    if (offset > threshold && leftAction) {
      leftAction.onAction();
    } else if (offset < -threshold && rightAction) {
      rightAction.onAction();
    }
  };

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {/* Left action (swipe right to reveal) */}
      {leftAction && (
        <motion.div
          className="absolute inset-y-0 left-0 flex items-center px-5"
          style={{ opacity: leftOpacity, background: leftAction.color }}
        >
          <motion.div className="flex flex-col items-center gap-1 text-white" style={{ scale: leftScale }}>
            {leftAction.icon}
            <span className="text-xs font-medium">{leftAction.label}</span>
          </motion.div>
        </motion.div>
      )}

      {/* Right action (swipe left to reveal) */}
      {rightAction && (
        <motion.div
          className="absolute inset-y-0 right-0 flex items-center px-5"
          style={{ opacity: rightOpacity, background: rightAction.color }}
        >
          <motion.div className="flex flex-col items-center gap-1 text-white" style={{ scale: rightScale }}>
            {rightAction.icon}
            <span className="text-xs font-medium">{rightAction.label}</span>
          </motion.div>
        </motion.div>
      )}

      {/* Draggable content */}
      <motion.div
        drag="x"
        dragConstraints={{ left: rightAction ? -threshold * 1.5 : 0, right: leftAction ? threshold * 1.5 : 0 }}
        dragElastic={0.3}
        onDragEnd={handleDragEnd}
        style={{ x }}
        animate={{ x: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative bg-white z-10 touch-pan-y"
      >
        {children}
      </motion.div>
    </div>
  );
}
