import { BETSY_PLAN } from '@/lib/pricing/plan'

/**
 * Copy for home v2 (/home-preview). Spanish (Costa Rica, voseo). Only what the product does today; anything not
 * built yet lives in COMING_SOON and is labeled "Próximamente". No metrics, logos or testimonials.
 * Price: src/lib/pricing/plan.ts. Contact: getSupportContactConfig(). Demo names and products are made-up examples.
 */

export const LINKS = {
  signup: '/auth/signin?signup=true',
  signin: '/auth/signin',
  agent: '/soporte?tema=agente',
  support: '/soporte',
  docs: '/docs',
}

export const NAV = [
  { href: '#como-funciona', label: 'Cómo funciona' },
  { href: '#agente', label: 'Agente de IA' },
  { href: '#operacion', label: 'Envíos' },
  { href: '#precios', label: 'Precios' },
  { href: '#contacto', label: 'Contacto' },
]

export const HERO = {
  pill: 'Hecho en Costa Rica para negocios que venden por chat',
  lead:
    'Betsy junta WhatsApp e Instagram en una bandeja, convierte cada conversación en un pedido y lo sigue hasta la entrega. Y si querés, construimos un agente de IA que atiende como tu mejor vendedor.',
}

/** One chat, start to finish. Each step is one frame of the hero demo; `caption` is also the accessible step list. */
export const STORY = {
  customer: { name: 'Daniela R.', initials: 'DR', channel: 'ig' as const, line: 'Instagram · @tu_tienda' },
  agentName: 'Sofi',
  steps: [
    { caption: 'Una clienta escribe por Instagram a las 10:42 p. m.' },
    { caption: 'El agente contesta con tu precio y tus envíos, en mensajes cortos.' },
    { caption: 'Ella elige Correos y manda el comprobante de SINPE Móvil.' },
    { caption: 'El chat pasa a “Revisar pago” y alguien de tu equipo lo confirma.' },
    { caption: 'Se crea el pedido con sus datos, sin copiar nada a mano.' },
    { caption: 'El pedido entra a Producción: lo empacan.' },
    { caption: 'Se genera la guía de Correos de Costa Rica.' },
    { caption: 'En tránsito: el pedido va en camino y todo quedó ligado al chat.' },
  ],
  messages: {
    ask: 'Hola! ¿Tienen los parches para dormir? ¿Cuánto cuestan?',
    a1: '¡Hola Daniela! Sí, hay 😊',
    a2: 'Caja de 30 parches: ₡12.900',
    a3: '¿Te lo enviamos por Correos o preferís mensajería?',
    pick: 'Por Correos. Ya te hice el SINPE',
    a4: '¡Pago recibido, gracias! Ya preparamos tu pedido 🙌',
    a4By: 'Carlos (equipo)',
  },
  order: { id: '#2041', item: '1× Parches para dormir ×30', total: '₡12.900', pay: 'Pagado por SINPE', ship: 'Correos' },
  guia: { number: 'CR 4021 7735 06', to: 'Daniela R. · Heredia 40101', weight: '0,3 kg' },
  columns: ['Pendiente', 'En Proceso', 'Enviado'],
}

export const AGENT = {
  label: 'Agente de IA',
  title: 'Un vendedor que conoce tu negocio, ',
  titleEm: 'hecho para vos.',
  lead:
    'No es un bot genérico. Lo construimos con modelos de OpenAI sobre tu información real: precios, envíos, formas de pago y la manera en que tu equipo le habla a tus clientes.',
  steps: [
    {
      key: 'info',
      title: 'Contesta con tu información',
      text: 'Precios, disponibilidad, envíos y formas de pago salen de lo que revisamos con vos. Si no lo sabe, no lo inventa.',
    },
    {
      key: 'handoff',
      title: 'Le pasa el chat a una persona',
      text: 'Comprobantes, reclamos o un cliente que pide hablar con alguien: el chat queda en “Necesita persona” con el motivo.',
    },
    {
      key: 'followup',
      title: 'Da seguimiento',
      text: 'A quien se quedó a medias le vuelve a escribir una vez, sin subir el chat en tu bandeja. Lo ves en Seguimientos.',
    },
    {
      key: 'pause',
      title: 'Vos lo pausás cuando querés',
      text: 'En un chat con “Pausar” o “Tomar control”, o en toda una línea desde Configuración. Ves cada respuesta y cuánto cuesta.',
    },
  ],
}

export const NICHES = [
  {
    key: 'suplementos',
    label: 'Parches y suplementos',
    chat: [
      { from: 'in', text: '¿Los parches de colágeno sirven si tengo piel sensible?' },
      { from: 'out', text: 'Te paso lo que dice la marca sobre piel sensible 👇' },
      { from: 'out', text: 'Si tenés una condición de la piel, mejor consultalo con tu médico.' },
      { from: 'in', text: 'Ok, quiero 2 cajas' },
      { from: 'out', text: '¡Perfecto! ¿Cómo preferís pagar? SINPE Móvil, transferencia o contra entrega (solo GAM)' },
    ],
    notes: [
      ['Respuestas con cuidado', 'contesta con la información de la marca y no promete resultados de salud.'],
      ['Combos y promos', 'la promo del mes y los combos salen de tu catálogo, no de la memoria del agente.'],
      ['Pago por SINPE', 'el comprobante cae en “Revisar pago” para que alguien de tu equipo lo confirme.'],
    ],
  },
  {
    key: 'ropa',
    label: 'Ropa',
    chat: [
      { from: 'in', text: '¿La camisa negra la tienen en M?' },
      { from: 'out', text: 'Sí, la M en negro está disponible 😊' },
      { from: 'out', text: 'Mide 52 cm de pecho y 72 cm de largo' },
      { from: 'in', text: 'La quiero, ¿hacen envíos a Liberia?' },
      { from: 'out', text: 'Sí, por Correos llega en 2 a 3 días hábiles' },
    ],
    notes: [
      ['Disponibilidad', 'lo que marcás como agotado no se ofrece, y avisa cuándo vuelve si lo indicás.'],
      ['Fotos guardadas', 'manda la foto del producto que el cliente pregunta, desde tus respuestas guardadas.'],
      ['Del chat al pedido', 'los datos del cliente y el producto pasan al pedido, sin copiarlos a mano.'],
    ],
  },
  {
    key: 'dental',
    label: 'Dental y belleza',
    chat: [
      { from: 'in', text: '¿El kit de blanqueamiento trae todo?' },
      { from: 'out', text: 'Sí: gel, protector y guía de uso 🦷' },
      { from: 'in', text: 'Me da sensibilidad, ¿lo puedo usar?' },
      { from: 'out', text: 'Para eso te paso con alguien del equipo, un momento 🙏' },
    ],
    notes: [
      ['Sabe cuándo parar', 'una duda de salud pasa a una persona con el motivo marcado.'],
      ['Instrucciones claras', 'la guía de uso y los cuidados salen tal cual de tu información.'],
      ['Contra entrega', 'confirma los datos y deja el pedido listo para que tu equipo lo revise.'],
    ],
  },
  {
    key: 'gadgets',
    label: 'Gadgets',
    chat: [
      { from: 'in', text: '¿El cargador sirve para iPhone 15?' },
      { from: 'out', text: 'Sí, es USB-C de 20 W y sirve para el iPhone 15 ⚡' },
      { from: 'in', text: '¿Tiene garantía?' },
      { from: 'out', text: 'Sí, 3 meses por defectos de fábrica.' },
    ],
    notes: [
      ['Ficha técnica', 'compatibilidad, potencia y garantía salen de tu catálogo.'],
      ['Comparaciones', 'explica la diferencia entre modelos con tus datos, no con datos de internet.'],
      ['Pedidos con guía', 'del chat a la guía de Correos en el mismo flujo.'],
    ],
  },
] as const

export const OPS = {
  label: 'Ventas, producción y envíos',
  title: 'Desde que el cliente dice “lo quiero” ',
  titleEm: 'hasta que lo recibe.',
  lead: 'Cada pedido pasa por las mismas etapas y todo el equipo ve en qué va. Sin hojas sueltas ni notas en el chat.',
  inbox: { title: 'Una bandeja para todas tus líneas', text: 'Varios números de WhatsApp y cuentas de Instagram, con vistas de trabajo: Sin responder, Persona, Revisar pago, Pedido, IA y Seguimientos.' },
  guias: { title: 'Guías de Correos de Costa Rica', text: 'Generá la guía desde el pedido, imprimí la etiqueta y seguí el estado: Guía creada, Impreso, En tránsito, Entregado.' },
  cod: { title: 'Contra entrega sin perder plata', text: 'Cada cobro queda Pendiente o Cobrado, y un pedido no se marca entregado hasta confirmar el pago.' },
  courier: { title: 'Mensajería propia', text: 'Las entregas con tu propio mensajero, por día y con el estado y el cobro de cada una.' },
  ads: { title: 'Qué anuncio vende', text: 'Anuncio → chat → venta: cuántos chats, pedidos y ventas trae cada anuncio de Meta.' },
}

export const BUILD = {
  label: 'Cómo creamos tu agente',
  title: 'Cinco pasos antes de que hable con un solo cliente.',
  steps: [
    { title: 'Conversamos', text: 'Qué vendés, cómo cobrás, cómo enviás y cómo le hablás a tus clientes.' },
    { title: 'Aprende de tu negocio', text: 'Tu sitio web y conversaciones reales de tu bandeja: precios, políticas y las preguntas de siempre.' },
    { title: 'Lo ponemos a prueba', text: 'Un examen con preguntas reales, clientes incógnito y una prueba en silencio sobre chats reales sin enviar nada.' },
    { title: 'Vos lo aprobás', text: 'Revisás sus respuestas y nos decís qué cambiar. No sale hasta que estés conforme.' },
    { title: 'Sale en vivo', text: 'Atiende, da seguimiento y le pasa el chat a tu equipo cuando hace falta. Lo seguimos afinando.' },
  ],
}

export const TRUST = {
  label: 'Lo que hay detrás',
  title: 'Sin promesas raras.',
  items: [
    { title: 'Conexiones oficiales', text: 'WhatsApp Business Platform e Instagram por medio de Meta. Seguís usando tu mismo número.' },
    { title: 'Tus datos, respaldados', text: 'Respaldos automáticos todos los días, y cada negocio ve solo su información.' },
    { title: 'Costos a la vista', text: 'Ves cuánto gasta la IA por día, por función y por agente, y le ponés un tope mensual.' },
    { title: 'Gente de verdad', text: 'Te atendemos por WhatsApp, Instagram y correo, desde Costa Rica.' },
  ],
}

export const COMING_SOON = {
  label: 'Próximamente',
  title: 'Lo que estamos construyendo.',
  lead: 'Todavía no está disponible. Te contamos para que sepás hacia dónde va Betsy.',
  items: [
    { key: 'app', title: 'Betsy en tu teléfono', text: 'Una app para iOS y Android: tu bandeja, tus pedidos y avisos en el bolsillo.' },
    {
      key: 'mcp',
      title: 'Tu negocio desde tu asistente de IA',
      text: 'Configurá y consultá Betsy desde asistentes compatibles con MCP, como Claude, ChatGPT o Grok. Más adelante, también Dots y Muse.',
    },
    { key: 'tools', title: 'Más tipos de negocio', text: 'Herramientas para negocios que no solo venden productos: servicios, reservas y más.' },
    { key: 'presets', title: 'Agentes listos para activar', text: 'Agentes de base que vos mismo configurás y encendés, sin esperar a que te armemos uno.' },
  ],
}

export const PRICING = {
  label: 'Precios',
  title: 'Un plan, todo incluido.',
  lead: 'Sin planes escondidos ni cobros por pedido. La IA se cobra por lo que se usa, y siempre ves la cuenta.',
  plan: [
    'Bandeja de WhatsApp e Instagram',
    'Pedidos, producción y envíos',
    'Correos de Costa Rica, mensajería y contra entrega',
    'Pedidos ilimitados y hasta 25 usuarios',
    'Reportes, inventario y clientes',
    'Créditos de IA incluidos cada mes',
  ],
  agentTitle: 'Agente de IA',
  agentPrice: 'Hecho para vos',
  agentLead: 'Construimos y afinamos tu agente. Pagás solo la IA que usa, con créditos que recargás cuando querés.',
  agent: [
    'Diseño, conocimiento y pruebas del agente',
    'Créditos prepagados, sin vencimiento',
    'Costo del modelo + margen, con el cálculo a la vista',
    'Tope de gasto mensual que vos definís',
  ],
}

export const FAQ = [
  {
    q: '¿Qué incluye el plan?',
    a: 'Todo Betsy: bandeja de WhatsApp e Instagram, pedidos, producción, envíos, reportes, hasta 25 usuarios y créditos de IA cada mes para las funciones de ayuda. Los agentes de ventas se construyen aparte.',
  },
  {
    q: '¿Cómo se cobra la IA?',
    a: 'Cada uso de IA tiene un costo del modelo (OpenAI). Betsy cobra ese costo más un margen y te muestra el cálculo; el IVA se suma una sola vez al comprar créditos. Si llegás a tu tope o se acaba el saldo, el agente se pausa y tu equipo sigue atendiendo.',
  },
  {
    q: '¿El agente puede inventar precios?',
    a: 'Contesta con la información de tu negocio que revisamos juntos. Si no sabe algo, no lo inventa: le pasa el chat a tu equipo.',
  },
  { q: '¿Puedo probar antes de pagar?', a: `Sí. Tenés ${BETSY_PLAN.trialDays} días de prueba con todas las funciones para 1 usuario, sin tarjeta.` },
  { q: '¿Tengo que cambiar mi número de WhatsApp?', a: 'No. Conectás tu número de WhatsApp Business por medio de Meta y seguís usando el mismo.' },
]
