// Integration code snippet template for client websites
// This template can be customized for different frameworks

export const nextjsIntegrationSnippet = `
// Add to your .env.local file:
// BETSY_API_KEY=your-api-key-here
// BETSY_API_URL=https://your-betsy-domain.com/api/integration/orders/create

// Example integration in your Next.js API route (e.g., app/api/submit-order/route.ts)
import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  try {
    const formData = await req.json();
    
    // Process your payment with Tilopay/Stripe/etc first
    // ... payment processing logic ...
    
    if (paymentSuccess) {
      // Map your form data to Betsy format
      const orderData = {
        orderId: generateOrderId(), // Your order ID generation logic
        customer: {
          name: formData.customerName,
          phone: formData.phone,
          email: formData.email,
        },
        product: {
          name: formData.productName,
          quantity: formData.quantity || 1,
          unitPrice: formData.unitPrice,
        },
        shipping: {
          cost: formData.shippingCost || 'GRATIS',
          address: {
            province: formData.province,
            canton: formData.canton,
            district: formData.district,
            fullAddress: formData.address,
          },
        },
        total: formData.total,
        payment: {
          method: 'Tilopay', // or your payment method
          transactionId: paymentTransactionId,
          status: 'PAGADO',
          date: new Date().toLocaleString(),
        },
        source: 'Mi Sitio Web', // Optional: identify your website
      };

      // Send to Betsy CRM
      try {
        const response = await fetch(process.env.BETSY_API_URL!, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': process.env.BETSY_API_KEY!,
          },
          body: JSON.stringify(orderData),
        });

        const result = await response.json();
        
        if (!response.ok) {
          console.error('Betsy API error:', result);
          // Handle error - maybe retry or alert admin
        } else {
          console.log('Order sent to Betsy CRM:', result.crmOrderId);
        }
      } catch (error) {
        console.error('Failed to send to Betsy CRM:', error);
        // Handle error - maybe queue for retry
      }

      // Continue with your existing flow (send email, redirect, etc.)
      return NextResponse.json({ success: true });
    }
    
    return NextResponse.json({ error: 'Payment failed' }, { status: 400 });
  } catch (error) {
    console.error('Order processing error:', error);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
`;

export const vanillaJsSnippet = `
// For vanilla JavaScript or other frameworks
// Add this to your form submission handler

async function submitOrderToBetsy(orderData) {
  try {
    const response = await fetch('https://your-betsy-domain.com/api/integration/orders/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'your-api-key-here', // Store securely!
      },
      body: JSON.stringify({
        orderId: orderData.orderId,
        customer: {
          name: orderData.customerName,
          phone: orderData.phone,
          email: orderData.email,
        },
        product: {
          name: orderData.productName,
          quantity: orderData.quantity || 1,
          unitPrice: orderData.unitPrice,
        },
        shipping: {
          cost: orderData.shippingCost || 'GRATIS',
          address: {
            province: orderData.province,
            canton: orderData.canton,
            district: orderData.district,
            fullAddress: orderData.address,
          },
        },
        total: orderData.total,
        payment: {
          method: orderData.paymentMethod,
          transactionId: orderData.transactionId,
          status: 'PAGADO',
          date: new Date().toLocaleString(),
        },
        source: 'Mi Sitio Web',
      }),
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('Order sent to Betsy CRM successfully');
      return result;
    } else {
      console.error('Betsy API error:', result);
      throw new Error(result.error || 'API error');
    }
  } catch (error) {
    console.error('Failed to send order to Betsy CRM:', error);
    throw error;
  }
}

// Usage example:
// After successful payment processing:
/*
try {
  await submitOrderToBetsy({
    orderId: '12345',
    customerName: 'Juan Pérez',
    phone: '88887777',
    email: 'juan@example.com',
    productName: 'Mi Producto',
    quantity: 1,
    unitPrice: '₡10.000',
    province: 'San José',
    canton: 'San José',
    district: 'Carmen',
    address: 'Calle 123, Casa 456',
    total: '₡10.000',
    paymentMethod: 'Tilopay',
    transactionId: 'TXN123456',
  });
} catch (error) {
  // Handle error appropriately
}
*/
`;

export const phpSnippet = `
<?php
// PHP integration example
function sendOrderToBetsy($orderData) {
    $apiKey = 'your-api-key-here'; // Store securely!
    $apiUrl = 'https://your-betsy-domain.com/api/integration/orders/create';
    
    $payload = [
        'orderId' => $orderData['orderId'],
        'customer' => [
            'name' => $orderData['customerName'],
            'phone' => $orderData['phone'],
            'email' => $orderData['email'],
        ],
        'product' => [
            'name' => $orderData['productName'],
            'quantity' => $orderData['quantity'] ?? 1,
            'unitPrice' => $orderData['unitPrice'],
        ],
        'shipping' => [
            'cost' => $orderData['shippingCost'] ?? 'GRATIS',
            'address' => [
                'province' => $orderData['province'],
                'canton' => $orderData['canton'],
                'district' => $orderData['district'],
                'fullAddress' => $orderData['address'],
            ],
        ],
        'total' => $orderData['total'],
        'payment' => [
            'method' => $orderData['paymentMethod'],
            'transactionId' => $orderData['transactionId'],
            'status' => 'PAGADO',
            'date' => date('d/m/Y, H:i:s'),
        ],
        'source' => 'Mi Sitio Web PHP',
    ];
    
    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $apiUrl);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($payload));
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
        'Content-Type: application/json',
        'x-api-key: ' . $apiKey,
    ]);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    
    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    
    if ($httpCode === 200) {
        $result = json_decode($response, true);
        error_log('Order sent to Betsy CRM: ' . $result['crmOrderId']);
        return $result;
    } else {
        error_log('Betsy API error: ' . $response);
        throw new Exception('Failed to send order to Betsy CRM');
    }
}

// Usage after successful payment:
/*
try {
    sendOrderToBetsy([
        'orderId' => '12345',
        'customerName' => 'Juan Pérez',
        'phone' => '88887777',
        'email' => 'juan@example.com',
        'productName' => 'Mi Producto',
        'quantity' => 1,
        'unitPrice' => '₡10.000',
        'province' => 'San José',
        'canton' => 'San José',
        'district' => 'Carmen',
        'address' => 'Calle 123, Casa 456',
        'total' => '₡10.000',
        'paymentMethod' => 'Tilopay',
        'transactionId' => 'TXN123456',
    ]);
} catch (Exception $e) {
    // Handle error appropriately
    error_log('Integration error: ' . $e->getMessage());
}
*/
?>
`;

export const integrationGuide = `
# Guía de Integración - Betsy CRM

## Pasos para Conectar tu Sitio Web

### 1. Crear API Key
1. Ve a **Config > Integraciones** en tu dashboard de Betsy
2. Haz clic en "Nueva API Key"
3. Dale un nombre descriptivo (ej: "Mi Tienda Online")
4. Guarda la clave de forma segura - solo se muestra una vez

### 2. Configurar Variables de Entorno
Añade estas variables a tu proyecto:
\`\`\`
BETSY_API_KEY=tu-clave-api-aqui
BETSY_API_URL=https://tu-dominio-betsy.com/api/integration/orders/create
\`\`\`

### 3. Integrar en tu Código
Después de procesar el pago exitosamente, envía los datos del pedido a Betsy:

**Endpoint:** \`POST /api/integration/orders/create\`
**Headers:** \`x-api-key: tu-clave-api\`

### 4. Formato de Datos Requerido
\`\`\`json
{
  "orderId": "string (único)",
  "customer": {
    "name": "string",
    "phone": "string", 
    "email": "string"
  },
  "product": {
    "name": "string",
    "quantity": "number",
    "unitPrice": "string"
  },
  "shipping": {
    "cost": "string",
    "address": {
      "province": "string",
      "canton": "string", 
      "district": "string",
      "fullAddress": "string"
    }
  },
  "total": "string",
  "payment": {
    "method": "string",
    "transactionId": "string",
    "status": "string",
    "date": "string"
  },
  "source": "string (opcional)"
}
\`\`\`

### 5. Manejo de Errores
- **200**: Pedido creado exitosamente
- **400**: Datos inválidos - revisa el formato
- **401**: API key inválida o faltante
- **409**: Pedido duplicado (orderId ya existe)
- **500**: Error interno del servidor

### 6. Mejores Prácticas
- ✅ Nunca expongas la API key en el frontend
- ✅ Usa HTTPS siempre
- ✅ Implementa reintentos para errores temporales
- ✅ Registra errores para debugging
- ✅ Valida datos antes de enviar
- ✅ Usa orderIds únicos para evitar duplicados

### 7. Soporte
Si tienes problemas con la integración:
1. Revisa los logs de integración en tu dashboard
2. Verifica que la API key esté activa
3. Confirma el formato de los datos
4. Contacta soporte técnico si persisten los problemas
`;
