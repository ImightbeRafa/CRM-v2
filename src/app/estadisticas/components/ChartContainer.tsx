'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { AlertCircle } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string;
}

export default function ChartContainer({
  title,
  subtitle,
  children,
  actions,
  loading = false,
  error,
}: ChartContainerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-xl font-semibold">{title}</CardTitle>
            {subtitle && <p className="text-sm text-gray-500 mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 w-full rounded bg-gradient-to-r from-gray-100 via-gray-200 to-gray-100 animate-pulse" />
          ) : error ? (
            <div className="h-64 w-full flex items-center justify-center">
              <div className="text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
                <p className="text-red-600">{error}</p>
              </div>
            </div>
          ) : (
            children
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

