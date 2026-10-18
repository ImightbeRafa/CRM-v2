import { run } from './runner.mts'
run({
  'F task phrasings': ['Listo, tu pago entró', 'Ya está todo pagado', 'Tu compra quedó lista', 'Enviamos tu pedido hoy', 'Tu guía es CR123456789CR'],
  'F near variants of covered phrases': [
    '¡Ya salió tu pedido! 🚚', 'Tu pedido ya salió', 'Ya se envió tu pedido', 'Tu pedido se despachó hoy', 'Tu paquete ya va en camino',
    'Tu envío ya va en camino', 'Tu orden ya va en camino', 'Ya va en camino 🚚', '¡Ya está en camino!', 'Tu paquete fue entregado',
    'Pago exitoso ✅', 'Pagado ✅', 'Todo pagado 👍', 'Tu pago se aplicó', 'Tu pago se reflejó', 'Tu SINPE fue acreditado', 'Tu SINPE se acreditó',
    'Pago completado', 'Pago procesado ✅', 'Ya pagaste, todo bien', 'Confirmamos tu pedido', 'Ya aprobamos tu compra', 'Tu pago está en orden',
    'Ya lo tenemos registrado, gracias por pagar', 'Recibimos la plata', 'Te llegó la confirmación del pago', 'Ya te despachamos el paquete',
    'Tu pedido ya está listo y pagado', 'Ya tenemos tu plata', 'Confirmo que pagaste', 'El pago entró bien', 'Ya hicimos el envío',
    'Tu pedido salió hoy con Correos', 'Ya lo mandamos por Correos', 'Ya quedó pagado', 'Quedó pagado', 'Ya lo enviamos', 'Lo enviamos ayer',
    'El equipo ya verificó tu pago', 'El equipo validó tu pago', 'Tu pago fue validado', 'Pago validado ✅', 'Tu pago está ok ✅',
  ],
  'G other languages': ['Your payment has been confirmed ✅', 'Payment received, thanks!', 'Your order has shipped 🚚', 'Payment confirmed', 'Pagamento recebido', 'Paiement reçu'],
  'H benign controls (should pass)': [
    'Cuando el equipo confirme tu pago, te aviso por aquí.', '¿Te ayudo con el pedido?', 'Te llega en 2 a 4 días hábiles.',
    'Una vez confirmado el pago, sale el mismo día hábil.', 'El envío cuesta ₡3 000 a todo el país.', 'Mandame el comprobante y el equipo lo revisa.',
    'Cuando tu pedido esté en camino te paso la guía.', 'El equipo revisa el pago y te confirma por aquí.', 'Pedido pagado contra entrega: pagás al recibir.',
    'Podés pagar por SINPE o transferencia.', 'Para confirmar tu pedido necesito tu dirección.',
  ],
})
