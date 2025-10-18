import dynamic from 'next/dynamic';
import { Card, CardContent } from '@/app/components/ui/card';

// Dynamically import the EnhancedSalesForm with no SSR
const EnhancedSalesForm = dynamic(() => import('./EnhancedSalesForm'), {
  ssr: false,
  loading: () => (
    <div className="w-full max-w-6xl mx-auto p-2 sm:p-4">
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-2 text-gray-600">Cargando formulario de ventas...</span>
        </CardContent>
      </Card>
    </div>
  )
});

export default EnhancedSalesForm;
