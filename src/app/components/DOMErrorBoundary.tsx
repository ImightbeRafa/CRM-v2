'use client';

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { Button } from './ui/button';
import { AlertTriangle, RefreshCw, Bug } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  errorInfo?: ErrorInfo;
  errorCount: number;
}

export class DOMErrorBoundary extends Component<Props, State> {
  private retryTimeoutId: NodeJS.Timeout | null = null;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('🚨 DOM Error Boundary caught an error:', error, errorInfo);
    
    // Enhanced logging for DOM manipulation errors
    if (error.name === 'NotFoundError' && error.message.includes('removeChild')) {
      console.error('🚨 DOM Manipulation Error Details:', {
        error: error.message,
        stack: error.stack,
        componentStack: errorInfo.componentStack,
        errorBoundary: 'DOMErrorBoundary',
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href,
        errorCount: this.state.errorCount + 1
      });

      // Track error frequency
      this.setState(prevState => ({ 
        errorCount: prevState.errorCount + 1 
      }));

      // Auto-retry for DOM manipulation errors (up to 3 times)
      if (this.state.errorCount < 3) {
        this.retryTimeoutId = setTimeout(() => {
          this.handleRetry();
        }, 1000 * (this.state.errorCount + 1)); // Exponential backoff
      }
    }

    this.setState({ error, errorInfo });
    
    // Call custom error handler if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  componentWillUnmount() {
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId);
    }
  }

  handleRetry = () => {
    console.log('🔄 DOM Error Boundary: Attempting retry...');
    this.setState({ 
      hasError: false, 
      error: undefined, 
      errorInfo: undefined 
    });
  };

  handleForceReload = () => {
    console.log('🔄 DOM Error Boundary: Force reloading page...');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const isDOMError = this.state.error?.name === 'NotFoundError' && 
                        this.state.error?.message?.includes('removeChild');

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <div className="flex justify-center mb-4">
              {isDOMError ? (
                <Bug className="h-12 w-12 text-orange-500" />
              ) : (
                <AlertTriangle className="h-12 w-12 text-red-500" />
              )}
            </div>
            
            <h2 className="text-xl font-semibold text-gray-900 mb-2">
              {isDOMError ? 'Error de Interfaz' : 'Algo salió mal'}
            </h2>
            
            <p className="text-gray-600 mb-6">
              {isDOMError 
                ? 'Se detectó un problema con la interfaz de usuario. Esto suele resolverse automáticamente.'
                : 'Ha ocurrido un error inesperado. Por favor, intenta recargar la página.'
              }
            </p>

            {isDOMError && this.state.errorCount > 0 && (
              <div className="bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4">
                <p className="text-sm text-orange-800">
                  <strong>Intento {this.state.errorCount}/3</strong> - 
                  {this.state.errorCount < 3 
                    ? ' Reintentando automáticamente...' 
                    : ' Se requieren más acciones.'
                  }
                </p>
              </div>
            )}
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mb-4 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Detalles del error
                </summary>
                <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto">
                  {this.state.error.message}
                  {this.state.errorInfo?.componentStack}
                </pre>
              </details>
            )}
            
            <div className="flex flex-col gap-3">
              {this.state.errorCount < 3 && (
                <Button
                  onClick={this.handleRetry}
                  className="flex items-center gap-2"
                >
                  <RefreshCw className="h-4 w-4" />
                  {isDOMError ? 'Reintentar' : 'Intentar de nuevo'}
                </Button>
              )}
              
              <Button
                onClick={this.handleForceReload}
                variant="outline"
                className="flex items-center gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Recargar página
              </Button>
            </div>

            {isDOMError && (
              <div className="mt-4 text-xs text-gray-500">
                <p>💡 <strong>Consejo:</strong> Si este error persiste, intenta:</p>
                <ul className="mt-1 text-left">
                  <li>• Limpiar la caché del navegador</li>
                  <li>• Deshabilitar extensiones temporalmente</li>
                  <li>• Usar una ventana de incógnito</li>
                </ul>
              </div>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useDOMErrorHandler() {
  const handleError = (error: Error) => {
    if (error.name === 'NotFoundError' && error.message.includes('removeChild')) {
      console.error('🚨 DOM Manipulation Error Handled:', {
        error: error.message,
        timestamp: new Date().toISOString()
      });
      
      // Prevent the error from propagating
      return true;
    }
    return false;
  };

  return { handleError };
}
