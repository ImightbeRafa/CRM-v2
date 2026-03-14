'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { Button, type ButtonProps } from './button';

interface MotionButtonProps extends ButtonProps {
  children: React.ReactNode;
}

export const MotionButton = React.forwardRef<HTMLButtonElement, MotionButtonProps>(
  ({ children, ...props }, ref) => {
    return (
      <motion.div
        whileTap={{ scale: 0.95 }}
        whileHover={{ scale: 1.02 }}
        transition={{ type: 'spring', damping: 15, stiffness: 400 }}
        className="inline-flex"
      >
        <Button ref={ref} {...props}>
          {children}
        </Button>
      </motion.div>
    );
  }
);
MotionButton.displayName = 'MotionButton';
