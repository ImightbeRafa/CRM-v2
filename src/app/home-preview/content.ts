/**
 * Copy for the public landing (/home). Spanish (Costa Rica, voseo like /soporte).
 * Only real product capabilities: no invented metrics, customers or testimonials.
 * Prices come from src/lib/pricing/plan.ts, contact info from getSupportContactConfig().
 */

export const HERO = {
  eyebrow: 'Hecho en Costa Rica para negocios que venden por chat',
  lead:
    'Betsy junta WhatsApp e Instagram en una sola bandeja, convierte cada conversación en un pedido y lo sigue hasta que llega a la puerta del cliente. Y si querés, construimos un agente de IA que atiende como tu mejor vendedor.',
}

export const INBOX = {
  label: 'Bandeja unificada',
  title: 'Todos tus chats de WhatsApp e Instagram, en una sola pantalla.',
  lead: 'Tu equipo ve las mismas conversaciones, sabe quién está atendiendo y qué falta. Nadie le contesta dos veces al mismo cliente y nadie se queda sin respuesta.',
  points: [
    { title: 'Varias líneas, una bandeja', text: 'Conectá tus números de WhatsApp Business y tus cuentas de Instagram. Filtrá por línea, canal o etiqueta.' },
    { title: 'Vistas de trabajo', text: 'Persona, Revisar pago, Pedido, IA y Seguimientos: cada chat cae donde alguien lo tiene que mover.' },
    { title: 'Del chat al pedido', text: 'Creá el pedido desde la conversación con los datos del cliente ya llenos, y el chat queda ligado al pedido.' },
    { title: 'Respuestas guardadas y fotos', text: 'Plantillas, catálogo e imágenes listas para mandar sin buscar en el teléfono.' },
  ],
}

export const OPERATIONS = {
  label: 'Ventas, producción y envíos',
  title: 'Desde que el cliente dice “lo quiero” hasta que lo recibe.',
  lead: 'Cada pedido pasa por las mismas etapas y todo el equipo ve en qué va. Sin hojas de Excel sueltas ni notas en el chat.',
  steps: [
    { title: 'Venta', text: 'Pedidos con cliente, productos, pago y método de envío. Campos a la medida de tu negocio e importación desde Excel.' },
    { title: 'Producción', text: 'Tablero por etapas para lo que se fabrica, se empaca o se prepara. Movés el pedido de etapa y todos lo ven.' },
    { title: 'Envío', text: 'Guías de Correos de Costa Rica desde Betsy, mensajería propia y contra entrega con el cobro registrado.' },
    { title: 'Números', text: 'Ventas, productos, canales y cobros en reportes claros. Sabés qué se vendió y qué falta cobrar.' },
  ],
  extras: [
    'Inventario y disponibilidad',
    'Clientes con historial de compras',
    'Roles y permisos por persona',
    'Registro de auditoría',
    'Asistente para tu equipo por Telegram o WhatsApp',
    'Respaldos diarios de tus datos',
  ],
}

export const AGENTS = {
  label: 'Agentes de IA',
  title: 'Un agente de ventas que conoce tu negocio, hecho para vos.',
  lead:
    'No es un bot genérico ni un formulario que llenás vos. Nosotros construimos el agente para tu negocio con modelos de OpenAI: aprende de tu sitio y de tus chats reales, contesta en tu tono y le pasa el chat a una persona cuando hace falta.',
  points: [
    { title: 'Atiende en WhatsApp e Instagram', text: 'Responde precios, disponibilidad, envíos y formas de pago con la información de tu negocio, no inventada.' },
    { title: 'Vende y da seguimiento', text: 'Toma los datos del pedido, pide el comprobante y vuelve a escribir a quien se quedó a medias.' },
    { title: 'Sabe cuándo parar', text: 'Si el cliente pide una persona, se enoja o pregunta algo que no sabe, el chat pasa a tu equipo con aviso.' },
    { title: 'Vos tenés el control', text: 'Pausalo en un chat o en todos con un botón. Ves cada respuesta y cuánto cuesta.' },
  ],
}

export const AGENT_PROCESS = {
  label: 'Cómo creamos tu agente',
  title: 'Cinco pasos antes de que hable con un solo cliente.',
  steps: [
    { title: 'Conversamos', text: 'Entendemos qué vendés, cómo cobrás, cómo enviás y cómo le hablás a tus clientes.' },
    { title: 'Aprende de tu negocio', text: 'Armamos su conocimiento con tu sitio web y con conversaciones reales de tu bandeja: precios, políticas y las preguntas que más te hacen.' },
    { title: 'Lo ponemos a prueba', text: 'Un examen con las preguntas reales de tus clientes, clientes incógnito que intentan confundirlo y una prueba en silencio sobre chats reales sin enviar nada.' },
    { title: 'Vos lo aprobás', text: 'Revisás sus respuestas y nos decís qué cambiar. No sale hasta que estés conforme.' },
    { title: 'Sale en vivo', text: 'Atiende, da seguimiento y le pasa el chat a tu equipo cuando hace falta. Lo seguimos afinando con lo que pasa en tus chats.' },
  ],
}

export const PROOF = {
  label: 'Lo que hay detrás',
  title: 'Sin promesas raras.',
  items: [
    { title: 'Conexiones oficiales', text: 'WhatsApp Business Platform e Instagram por medio de Meta. Nada de apps no oficiales que bloquean tu número.' },
    { title: 'Tus datos, respaldados', text: 'Respaldos automáticos todos los días, y cada negocio ve solo su información.' },
    { title: 'Costos a la vista', text: 'Ves cuánto gasta la IA por día, por función y por agente, y le ponés un tope mensual.' },
    { title: 'Gente de verdad', text: 'Te atendemos por WhatsApp, Instagram y correo, desde Costa Rica.' },
  ],
}

export const PRICING = {
  label: 'Precios',
  title: 'Un plan, todo incluido.',
  lead: 'Sin planes escondidos ni cobros por pedido. La IA se cobra por lo que se usa, y siempre ves la cuenta.',
  planFeatures: [
    'Bandeja de WhatsApp e Instagram',
    'Pedidos, producción y envíos',
    'Correos de Costa Rica, mensajería y contra entrega',
    'Pedidos ilimitados y hasta 25 usuarios',
    'Reportes, inventario y clientes',
    'Créditos de IA incluidos cada mes',
  ],
  aiTitle: 'Agentes de IA',
  aiLead: 'Un servicio hecho a la medida. Construimos y afinamos tu agente; vos pagás solo lo que usa.',
  aiFeatures: [
    'Diseño, conocimiento y pruebas del agente',
    'Créditos prepagados: recargás cuando querés',
    'Costo del modelo + margen + IVA, desglosado',
    'Tope de gasto mensual que vos definís',
  ],
}

export const FAQ = [
  {
    q: '¿Qué incluye el plan?',
    a: 'Todo Betsy: bandeja de WhatsApp e Instagram, pedidos, producción, envíos, reportes, hasta 25 usuarios y unos créditos de IA al mes para las funciones de ayuda. Los agentes de ventas se contratan aparte.',
  },
  {
    q: '¿Cómo se cobra la IA?',
    a: 'Cada uso de IA tiene un costo del modelo (OpenAI). Betsy cobra ese costo más un margen y el IVA, y te muestra el cálculo. Las cuentas con agente usan créditos prepagados; vos definís un tope mensual y, si se acaba el saldo, la IA se pausa y tu equipo sigue atendiendo.',
  },
  {
    q: '¿El agente puede vender algo que no tengo o inventar precios?',
    a: 'Contesta con la información de tu negocio que revisamos juntos. Si no sabe algo, no lo inventa: le pasa el chat a tu equipo.',
  },
  {
    q: '¿Puedo probar Betsy antes de pagar?',
    a: 'Sí. Tenés 7 días de prueba con todas las funciones para 1 usuario, sin tarjeta.',
  },
  {
    q: '¿Necesito cambiar mi número de WhatsApp?',
    a: 'No. Conectás tu número de WhatsApp Business por medio de Meta y seguís usando el mismo.',
  },
]
