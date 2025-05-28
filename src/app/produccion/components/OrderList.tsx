import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/components/ui/table";
import { Sale } from '../types/sales';
import { StatusBadge } from "@/app/components/ui/StatusBadge";
import { Button } from "@/app/components/ui/button";
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';

interface OrderListProps {
  orders: Sale[];
  onSelectOrder: (order: Sale) => void;
  loading: boolean;
  error: string;
}

export function OrderList({ orders, onSelectOrder, loading, error }: OrderListProps) {
  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8 text-red-500">
        {error}
      </div>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Orden</TableHead>
          <TableHead>Cliente</TableHead>
          <TableHead>Negocio</TableHead>
          <TableHead>Producto</TableHead>
          <TableHead>Estado</TableHead>
          <TableHead>Fecha</TableHead>
          <TableHead></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {orders.map((order) => (
          <TableRow key={order.orderId}>
            <TableCell className="font-medium">{order.orderId}</TableCell>
            <TableCell>
              <div>
                <p>{order.customerName}</p>
                <p className="text-sm text-muted-foreground">{order.phone}</p>
              </div>
            </TableCell>
            <TableCell>
              <p>{order.business || 'No especificado'}</p>
            </TableCell>
            <TableCell>
              <div>
                <p>{order.product}</p>
                <p className="text-sm text-muted-foreground">
                  Cant: {order.quantity} - {order.size}
                </p>
              </div>
            </TableCell>
            <TableCell>
              <StatusBadge status={order.status} />
            </TableCell>
            <TableCell>
              <div>
                <p className="text-sm">
                  {(() => {
                    const date = new Date(order.timestamp);
                    return isNaN(date.getTime())
                      ? 'Fecha inválida'
                      : formatDistanceToNow(date, {
                          addSuffix: true,
                          locale: es
                        });
                  })()}
                </p>
                {order.orderType === 'EA' ? (
                  <p className="text-xs text-muted-foreground">Espera: {order.expectedDate}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">Retiro: {order.agreedDate}</p>
                )}
              </div>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onSelectOrder(order)}
              >
                Ver detalles
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}