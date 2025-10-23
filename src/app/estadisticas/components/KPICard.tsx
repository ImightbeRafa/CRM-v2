'use client';

import { Card, CardContent } from '@/app/components/ui/card';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { motion } from 'framer-motion';
import CountUp from 'react-countup';
import Skeleton from 'react-loading-skeleton';
import 'react-loading-skeleton/dist/skeleton.css';

interface KPICardProps {
  title: string;
  value: number | string;
  subtitle?: string;
  trend?: {
    value: number;
    isPositive: boolean;
    period: string;
  };
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'purple' | 'orange';
  loading?: boolean;
  onClick?: () => void;
  prefix?: string;
  suffix?: string;
  decimals?: number;
}

export default function KPICard({
  title,
  value,
  subtitle,
  trend,
  icon,
  color = 'blue',
  loading = false,
  onClick,
  prefix = '',
  suffix = '',
  decimals = 0,
}: KPICardProps) {
  const colorClasses = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    red: 'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  const numericValue = typeof value === 'number' ? value : parseFloat(value) || 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      whileHover={{ scale: onClick ? 1.02 : 1 }}
      className={onClick ? 'cursor-pointer' : ''}
      onClick={onClick}
    >
      <Card className="hover:shadow-lg transition-shadow">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-600 mb-2">{title}</p>
              <div className="flex items-baseline gap-2 mb-1">
                {loading ? (
                  <Skeleton width={120} height={36} />
                ) : (
                  <p className="text-3xl font-bold text-gray-900 tabular-nums">
                    {prefix}
                    {typeof value === 'number' ? (
                      <CountUp
                        end={numericValue}
                        duration={1}
                        decimals={decimals}
                        separator=","
                      />
                    ) : (
                      value
                    )}
                    {suffix}
                  </p>
                )}
              </div>
              {!loading && trend && (
                <div className="flex items-center gap-1 mt-2">
                  <span
                    className={`text-sm font-medium flex items-center gap-1 ${
                      trend.isPositive ? 'text-green-600' : 'text-red-600'
                    }`}
                  >
                    {trend.isPositive ? (
                      <TrendingUp className="w-4 h-4" />
                    ) : (
                      <TrendingDown className="w-4 h-4" />
                    )}
                    {Math.abs(trend.value).toFixed(1)}%
                  </span>
                  <span className="text-xs text-gray-500">{trend.period}</span>
                </div>
              )}
              {!loading && subtitle && !trend && (
                <p className="text-xs text-gray-500 mt-1">{subtitle}</p>
              )}
            </div>
            <div className={`p-3 rounded-xl ${colorClasses[color]} flex-shrink-0 ml-4`}>
              {icon}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

