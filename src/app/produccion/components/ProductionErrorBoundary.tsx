'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from '@/app/components/ui/button';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
}

export class ProductionErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Production Error Boundary caught an error:', error, errorInfo);
    this.setState({ error, errorInfo });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="max-w-md w-full bg-card rounded-lg shadow-lg p-6 text-center">
            <div className="flex justify-center mb-4">
              <AlertTriangle className="h-12 w-12 text-red-500" />
            </div>
            
            <h2 className="text-xl font-semibold text-foreground mb-2">
              Error en Producción
            </h2>
            
            <p className="text-muted-foreground mb-6">
              Ha ocurrido un error en el módulo de producción. Esto puede deberse a problemas de conexión o configuración.
            </p>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4 text-left">
                <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                  Detalles del error
                </summary>
                <pre className="mt-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2 rounded overflow-auto">
                  {this.state.error.message}
                </pre>
                {this.state.errorInfo && (
                  <pre className="mt-2 text-xs text-muted-foreground bg-muted p-2 rounded overflow-auto">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}
              </details>
            )}
            
            <div className="flex gap-3 justify-center">
              <Button
                onClick={this.handleReset}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Intentar de nuevo
              </Button>
              
              <Button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2"
              >
                Recargar página
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export function useProductionErrorHandler() {
  const router = useRouter();
  
  const handleError = (error: Error) => {
    console.error('Production error:', error);
  };

  return { handleError };
}
