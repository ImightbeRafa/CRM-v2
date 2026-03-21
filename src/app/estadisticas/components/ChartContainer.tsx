'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card';
import { AlertCircle, BarChart3 } from 'lucide-react';
import { motion } from 'framer-motion';

interface ChartContainerProps {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
  loading?: boolean;
  error?: string;
  isEmpty?: boolean;
}

export default function ChartContainer({
  title,
  subtitle,
  children,
  actions,
  loading = false,
  error,
  isEmpty = false,
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
            {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="h-64 w-full rounded bg-gradient-to-r from-muted via-muted/60 to-muted animate-pulse" />
          ) : error ? (
            <div className="h-64 w-full flex items-center justify-center">
              <div className="text-center">
                <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
                <p className="text-red-600">{error}</p>
              </div>
            </div>
          ) : isEmpty ? (
            <div className="h-64 w-full flex items-center justify-center">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 text-muted-foreground/40 mx-auto mb-3" />
                <p className="text-muted-foreground font-medium">No hay datos disponibles</p>
                <p className="text-muted-foreground/70 text-sm mt-1">Los datos aparecerán aquí cuando haya pedidos registrados.</p>
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

