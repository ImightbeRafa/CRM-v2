# Informe de cumplimiento: agentes de IA del inbox de Betsy CRM (WhatsApp / Instagram)

Fecha de acceso de las fuentes: 2026-10-02 · Preparado para revisión de un abogado costarricense de protección de datos.

> **Aviso.** Es investigación de apoyo, **no asesoría legal**. Lo marcado "no verificado" no se pudo comprobar (páginas que devolvieron 403 a la herramienta, resúmenes automáticos de baja confianza o ausencia de fuentes). Ningún texto de este documento se ha publicado: la política de privacidad pública (`src/app/privacy/page.tsx`) **no se modificó** y requiere aprobación de Rafael y revisión legal antes de publicarse.

## A. Resumen ejecutivo (obligaciones y riesgos, por prioridad)

1. **BLOQUEANTE de política.** La política de privacidad actual contradice la función: la sección 7.4 dice que **no** se comparten ni transfieren datos de Instagram/Facebook/WhatsApp a terceros, pero el agente envía el texto de los clientes finales a OpenAI/xAI; la sección 7.2 no menciona IA. Debe corregirse **antes de activar el envío real de mensajes por IA**. (Confianza alta: leído del repo.)
2. **Cláusula §4.7 de los Términos de WhatsApp Business Platform (vigentes 23-sep-2026).** Prohíbe permitir que los datos de la plataforma se usen para crear, desarrollar, entrenar o mejorar sistemas de IA/ML, con una excepción limitada (modelos de uso exclusivo del negocio). Usar OpenAI/xAI solo para **responder** (inferencia) no es entrenamiento, siempre que el proveedor no entrene con los datos. Afecta a: (a) el uso de chats de WhatsApp para evaluar/mejorar agentes con un juez de IA (Claude), (b) cualquier reentrenamiento. **Consecuencia práctica para Betsy:** las pruebas del playground y las pruebas de evaluación deben usar conversaciones **simuladas escritas por el equipo**, no chats reales de WhatsApp, hasta que un abogado confirme la lectura de §4.7. (Confianza media: lectura por resumen automático.)
3. **Contrato encargado/responsable.** Betsy es **encargada**; cada negocio es **responsable** (Reglamento 37554-JP, arts. 30-31: tratar solo según contrato e instrucciones, sin transferir ni difundir sin instrucción expresa, confidencialidad, seguridad y supresión al terminar). Hace falta un **DPA** firmado o aceptado con cada negocio que autorice expresamente a los subencargados (OpenAI, xAI, etc.). Hoy el repo no tiene DPA.
4. **Aviso al cliente final (Ley 8968, art. 5).** Información "expresa, precisa e inequívoca": existencia de la base, fines, destinatarios, tratamiento, derechos, identidad y dirección del responsable. El aviso por negocio debe nombrar al negocio y mencionar a los proveedores de IA como destinatarios.
5. **Decir que es una IA.** Meta lo exige en Messenger/Instagram. No se encontró una norma costarricense que lo exija literalmente; es buena práctica y parte de informar el "tratamiento" (art. 5). (Confianza media.)
6. **Transferencias al extranjero.** La Ley 8968 no tiene régimen de transferencia internacional tipo GDPR; ver B4. Es la pregunta clave para el abogado.
7. **Retención del proveedor.** OpenAI, xAI y Anthropic retienen entradas/salidas **30 días** para monitoreo de abuso salvo acuerdo de retención cero (ZDR). `store:false` evita guardar el estado de la respuesta pero **no** equivale a ZDR. Debe declararse en la política y el DPA.
8. **Incidentes.** Reglamento arts. 38-39: el responsable informa a los titulares afectados en 5 días hábiles con contenido mínimo; el encargado debe avisar al responsable sin dilación.
9. **PRODHAB.** Ley art. 21 / Reglamento art. 44: inscripción de bases "con fines de distribución, difusión o comercialización". Ambiguo si aplica a cada negocio o a Betsy: pregunta para el abogado.
10. **Decisiones automatizadas.** La Ley 8968 no contiene un equivalente al art. 22 del GDPR. Existe el proyecto de reforma 22.388 (estado 2026 **no verificado**).

## B. Hallazgos por tema (con fuentes)

### B1. Ley 8968 y Reglamento 37554-JP

Fuentes: Ley — https://www.sutel.go.cr/sites/default/files/normativas/ley_proteccion_de_la_persona_frente_al_tratamiento_de_sus_ley_8968.pdf · Reglamento — https://www.tse.go.cr/pdf/normativa/reglamentoleyproteccionpersona.pdf (La Gaceta 45, 05-mar-2013). Confianza alta (texto leído).

- **Ley art. 2:** aplica a datos en bases automatizadas o manuales, públicas o privadas.
- **Ley art. 5(1):** deber de informar de previo: existencia de la base, fines, destinatarios, carácter obligatorio/facultativo, tratamiento, consecuencias de negarse, derechos, identidad y dirección del responsable.
- **Ley art. 5(2):** consentimiento expreso, por escrito (físico o electrónico), revocable sin efecto retroactivo.
- **Reglamento art. 4-6:** consentimiento libre, específico, informado, expreso e individualizado; en documento independiente, de fácil comprensión; la carga de la prueba es del responsable.
- **Ley art. 10-11:** medidas técnicas y organizativas de seguridad; confidencialidad de quienes intervienen en el tratamiento.
- **Ley art. 14:** transferir datos solo con autorización expresa y válida del titular. **Reglamento art. 40-43:** definen "transferencia" como comercialización entre responsables; un encargo a un procesador parece regirse por los arts. 29-31 (interpretación; confianza media).
- **Reglamento art. 29:** contratar proveedores o intermediarios tecnológicos "siempre y cuando no implique tratamiento de datos personales" (ambiguo para un LLM que sí trata datos); el responsable debe verificar medidas de seguridad mínimas.
- **Reglamento arts. 38-39:** incidentes (5 días hábiles; naturaleza, datos comprometidos, acciones correctivas, medios de contacto).
- **Ley art. 21 / Reglamento art. 44:** inscripción de bases ante PRODHAB y documentos requeridos (contrato con encargados, ubicación, finalidades, medidas de seguridad, destinatarios de transferencias).

No verificado: estado 2026 del proyecto 22.388; criterios de PRODHAB sobre IA/chatbots/encargados extranjeros; plazos exactos ARCO (arts. 18-22 del Reglamento).

### B2. WhatsApp Business e Instagram

- Términos de WhatsApp Business Platform (vigentes 23-sep-2026): https://www.facebook.com/legal/Meta-Terms-for-WhatsApp-Business-Platform (confianza media). §4.7 prohíbe el acceso de proveedores de IA cuando la IA es la funcionalidad principal (chatbots de propósito general); un bot de ventas/soporte de un negocio no se ve afectado — confirmado por Meta: https://techcrunch.com/2025/10/18/whatssapp-changes-its-terms-to-bar-general-purpose-chatbots-from-its-platform (vigente desde 15-ene-2026). §4.1: no transferir datos de la plataforma a terceros salvo "Solution Providers" (Betsy lo es); **no verificado** si OpenAI/xAI quedan cubiertos como subprocesadores en el DPA de Meta.
- Política de mensajería (23-sep-2026): https://whatsappbusiness.com/es-la/policy/ — opt-in obligatorio; ventana de 24 h (fuera, solo plantillas); la automatización debe ofrecer escalamiento a un humano; prohibido solicitar identificadores sensibles (tarjetas completas, cuentas, documentos de identidad).
- Messenger/Instagram: https://developers.facebook.com/docs/messenger-platform/send-messages — las experiencias automatizadas deben divulgar que es un servicio automatizado; ventana de 24 h; la etiqueta Human Agent no es para bots.

### B3. Proveedores de IA

- **OpenAI API:** https://developers.openai.com/api/docs/guides/your-data — sin entrenamiento por defecto; logs de abuso 30 días; **ZDR** requiere aprobación previa (contactar ventas); `store:false` ≠ ZDR; regiones de datos: EE. UU., Europa, EAU (no Latinoamérica). DPA incorporado a los Business Terms: https://openai.com/policies/business-terms (la página del DPA devolvió 403: abrir en navegador). Vía exacta de firma para una cuenta de API: **no verificada**.
- **xAI (Grok):** https://x.ai/legal/data-processing-addendum · https://x.ai/legal/faq-enterprise (403 a la herramienta; confianza media-baja) — sin entrenamiento con datos empresariales/API, retención 30 días, ZDR empresarial; DPA para cuentas self-serve **no verificado**.
- **Anthropic API (solo si se usa un juez Claude):** https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data · https://platform.claude.com/docs/en/manage-claude/api-and-data-retention — borrado a 30 días salvo ZDR; nunca entrena sin permiso; ZDR por ventas (https://claude.com/contact-sales); algunos modelos requieren retención de 30 días y no admiten ZDR.
- **Subprocesadores realmente presentes en el repo** (por dependencias/variables): OpenAI, xAI, Meta (WhatsApp/Instagram/Graph/Conversions API), Supabase, Resend, Upstash, Vercel Blob (respaldos), Telegram, Tilopay, Correos de Costa Rica, Google OAuth; por documentación: Cloudflare (producción) y Railway (vista previa). Anthropic y Sentry **no** están en el código.

### B4. Transferencias transfronterizas (confianza media)

La Ley 8968 no establece un régimen de adecuación/cláusulas tipo/BCR como el GDPR. Aplican los principios, el art. 14 (consentimiento para transferir) y los arts. 29-31 (encargado). Práctica habitual a validar por abogado: (1) informar que los datos pueden procesarse en EE. UU.; (2) contrato de encargo con instrucciones y confidencialidad; (3) subencargados con aviso previo; (4) garantía de no entrenamiento y borrado; (5) seguridad equivalente.

## C. Textos borrador (español formal costarricense)

### C1. Sección para la política de privacidad: agentes de IA y subencargados

> **Agentes de inteligencia artificial (IA) y proveedores de procesamiento**
>
> **1. Qué hace el Agente de IA.** Betsy CRM ofrece a cada negocio cliente (el «Negocio») un agente de inteligencia artificial que puede responder, en nombre del Negocio, a las personas que le escriben por WhatsApp e Instagram (los «Clientes Finales»). Para generar la respuesta se envían al proveedor de IA el texto del mensaje, el nombre visible, el contexto reciente de la conversación y, cuando corresponda, el estado de un pedido. No se envían números de tarjeta, claves ni documentos de identidad.
>
> **2. Roles.** El Negocio es el responsable de la base de datos de sus Clientes Finales y decide las finalidades. Betsy CRM actúa como encargada del tratamiento y trata esos datos únicamente conforme a las instrucciones del Negocio y a nuestro acuerdo de tratamiento de datos. Para los datos de las cuentas de nuestros usuarios, Betsy CRM es responsable.
>
> **3. Proveedores de IA y subencargados.** Pueden tratar datos personales por cuenta nuestra: OpenAI (EE. UU.) y xAI (EE. UU.) para generar respuestas; Meta Platforms (WhatsApp e Instagram) para la mensajería; Cloudflare, Railway y Supabase para alojamiento y base de datos; Upstash para limitación de solicitudes; Resend para correo transaccional; Vercel (almacenamiento de copias de seguridad); Tilopay para pagos; Correos de Costa Rica para envíos. Mantenemos la lista actualizada en [URL] y avisamos con [30] días de antelación los cambios.
>
> **4. Uso de los datos.** Los proveedores de IA procesan los mensajes únicamente para generar la respuesta solicitada. Configuramos las solicitudes para que no se conserven para uso propio del proveedor y, según los términos de cada proveedor, no se utilizan para entrenar sus modelos. Los proveedores pueden conservar temporalmente las solicitudes hasta 30 días con fines de seguridad y prevención de abusos, salvo que se haya acordado retención cero.
>
> **5. Transferencia internacional.** Estos proveedores pueden procesar datos fuera de Costa Rica, incluidos los Estados Unidos. Exigimos medidas de seguridad contractuales y técnicas comparables a las requeridas por la Ley N.º 8968 y su Reglamento.
>
> **6. Supervisión humana y evaluación.** Las respuestas de la IA pueden ser revisadas por el personal del Negocio, que puede marcarlas como útiles o inadecuadas; esa valoración se usa para mejorar el agente de ese Negocio. Si el Negocio lo autoriza de manera expresa y la persona titular lo consiente cuando corresponda, podrán usarse fragmentos de conversaciones para evaluar la calidad de los agentes, de forma revocable y sin efecto retroactivo. No usamos mensajes de WhatsApp para entrenar modelos de IA.
>
> **7. Decisiones.** El agente no toma decisiones jurídicas ni financieras sobre las personas; los casos sensibles se escalan a una persona del Negocio.
>
> **8. Derechos.** Las personas pueden ejercer los derechos de acceso, rectificación, supresión y oposición escribiendo al Negocio o a [privacy@betsycrm.com], y pueden acudir a la Agencia de Protección de Datos de los Habitantes (PRODHAB).
>
> **9. Incidentes.** Si ocurre una vulneración de seguridad que afecte datos personales, lo comunicaremos al Negocio responsable sin dilación para que cumpla su deber de notificación.

### C2. Cláusulas del DPA (Betsy encargada / Negocio responsable)

1. Partes, roles y objeto (Reglamento art. 30).
2. Instrucciones documentadas; prohibición de usar los datos para fines propios (art. 31).
3. Descripción del tratamiento: titulares (clientes finales), datos (mensajes, nombre visible, estado de pedido), finalidad, duración.
4. Confidencialidad del personal y de subencargados (Ley art. 11).
5. Medidas de seguridad técnicas y organizativas, con anexo (Ley art. 10; Reglamento arts. 34-37).
6. Subencargados: autorización general con lista anexa; aviso previo de [30] días; derecho de oposición; obligaciones equivalentes.
7. Transferencias a EE. UU.: autorización expresa del responsable, informada en el aviso al cliente final.
8. No entrenamiento de modelos propios o de terceros; cumplimiento de la cláusula 4.7 de Meta.
9. Derechos ARCO: asistencia razonable; traslado de solicitudes en [5] días hábiles.
10. Incidentes: aviso de la encargada al responsable en máximo [48] horas, con el contenido mínimo del art. 39; el responsable notifica a titulares y Agencia en 5 días hábiles (art. 38).
11. Retención y supresión al terminar la relación (art. 31 f); copias de respaldo hasta [90] días.
12. Auditoría razonable con previo aviso.
13. Responsabilidades del Negocio: informar a sus clientes (art. 5), obtener consentimientos, no instruir tratamiento ilícito, decidir sobre inscripción en PRODHAB.
14. Datos sensibles e identificadores de pago: no enviarlos al agente.
15. Evaluación con fragmentos de conversaciones: solo con activación expresa del Negocio y consentimiento revocable.
16. Ley aplicable y jurisdicción: Costa Rica. 17. Vigencia y modificación.

### C3. Aviso al cliente final (≤3 frases, por negocio)

> «Este chat es atendido por un asistente de inteligencia artificial de [NOMBRE DEL NEGOCIO] que puede responderle de forma automática, y una persona de nuestro equipo puede intervenir cuando lo solicite. Sus mensajes se procesan con proveedores tecnológicos en el extranjero (por ejemplo, Estados Unidos) únicamente para responderle y gestionar su pedido; más información y sus derechos en [URL de la política] o en [correo del negocio]. Si prefiere hablar con una persona, escriba "agente".»

### C4. Consentimiento opt-in para fragmentos de evaluación

> «Autorizo a [NOMBRE DEL NEGOCIO] (responsable) y a Betsy CRM (encargada) a conservar y usar fragmentos de esta conversación, con mi nombre y datos de contacto retirados o reemplazados, únicamente para evaluar y mejorar la calidad de las respuestas del asistente de este negocio, incluyendo su análisis por un proveedor de IA en el extranjero (por ejemplo, Estados Unidos). Esta autorización es voluntaria, no condiciona mi atención, puede revocarse en cualquier momento escribiendo a [correo] sin efecto retroactivo, y los fragmentos se eliminarán en un plazo máximo de [90] días. No se usarán para entrenar modelos de inteligencia artificial.»

Notas: solicitarlo por separado (Reglamento art. 5), conservar la prueba (art. 6), no condicionar el servicio. **No se usará hasta que un abogado confirme §4.7 de Meta.**

## D. Lista de acciones para Rafael (por prioridad)

1. **Corregir y publicar la política de privacidad** (ver brechas abajo), en español, **antes de activar el envío real por IA**.
2. **OpenAI:** aceptar/solicitar el DPA (https://openai.com/policies/business-terms, https://openai.com/policies/data-processing-addendum) y pedir **ZDR** a ventas; crear un **proyecto de OpenAI aparte** para `SOFT_AI_OPENAI_API_KEY` con presupuesto propio.
3. **xAI:** confirmar DPA/ZDR para la cuenta de API usada, o dejar de enviar datos de clientes finales a xAI cuando los agentes pasen a Luna (el bot interno del equipo sigue usando Grok; es otro flujo).
4. **Anthropic (solo antes de usar un juez Claude):** DPA vía Console/ventas; datos pseudonimizados; y recordar §4.7 de Meta.
5. **DPA Betsy–negocio:** plantilla con las cláusulas C2, aceptación en el alta (versionada, con prueba de aceptación).
6. **Aviso al cliente final:** texto C3 en el primer mensaje de cada conversación, editable por negocio.
7. **Meta:** leer §4.1 y §4.7 completos y verificar el DPA de Meta como Solution Provider; garantizar opt-in y salida a humano; el agente no debe pedir identificadores sensibles.
8. **Lista pública de subencargados** con aviso de cambios (~30 días).
9. **PRODHAB:** consultar al abogado si Betsy o los negocios deben inscribir bases; preparar el expediente del art. 44.
10. **Plan de incidentes:** procedimiento para avisar al negocio en horas y documentar el contenido del art. 39.
11. **Retención unificada:** hoy hay plazos distintos (24 h en 7.3, 30 días en 9, 90 días en respaldos, "inmediata" en data-deletion).
12. **Exportación/borrado Ley 8968** (rama `claudio/phase1-data-export`, en espera): al fusionarla, **incluir las tablas nuevas** — `ChatAgentVersion` (instrucciones y datos de marca del agente), `ChatAgentFeedback` (👍/👎), `ChatAgentEvalRun`, `ChatAgentTestCase` (texto escrito por el equipo como cliente simulado), `ChatAgentInventoryItem`, `ChatAutomationRule/Run` — y las tablas de agentes ya existentes (`ChatAgentTurn`, `ChatAgentSuggestion`).
13. Definir plazo y finalidad de retención de feedback del equipo y scorecards en el DPA.

### Brechas en `src/app/privacy/page.tsx` (qué AGREGAR o CAMBIAR)

- **Cambiar 7.4** («do NOT share … with third parties»): contradice el envío a OpenAI/xAI.
- **Agregar** la sección de agentes de IA (C1): subencargados, transferencia a EE. UU., retención de 30 días del proveedor, no entrenamiento.
- **Agregar en 7.2:** respuestas automatizadas por IA, feedback, scorecards, análisis agregados, fragmentos opt-in.
- **Cambiar** la sección 4 («Service providers» genérico) y la 10 (transferencias vagas) por lista concreta y mecanismo.
- **Agregar** mención expresa a la Ley 8968, derechos ARCO (con plazos), PRODHAB y datos de contacto del responsable.
- **Unificar roles:** la sección GDPR dice que Betsy es «data controller» de todo; la 7.5 dice que el negocio es responsable y Betsy encargada. Encargada para datos de clientes finales; responsable para cuentas de usuarios.
- **Corregir «Last updated»** (usa la fecha de hoy): indicar versión y fecha fija.
- **Unificar la retención** (7.3, 9, data-deletion y respaldos) y agregar plazos para registros de IA y feedback.
- **Publicar también en español** (art. 5 exige información expresa, precisa e inequívoca; Reglamento art. 5, fácil comprensión).
- **Términos, sección 12** («al usar el Servicio, usted consiente»): no es un consentimiento válido según el Reglamento art. 5 (documento independiente). Agregar aceptación del DPA.
- **Verificar** que `data-deletion` («eliminados inmediatamente», 48 h) coincide con la realidad (respaldos hasta 90 días).

## E. Cinco preguntas para un abogado costarricense de protección de datos

1. ¿Enviar mensajes de clientes a un proveedor de IA en EE. UU., como encargado de Betsy, requiere consentimiento del titular (art. 14 de la Ley) o basta contrato de encargo más aviso? ¿Hay criterio de PRODHAB?
2. ¿Deben Betsy o cada negocio inscribir sus bases ante PRODHAB (art. 21 Ley; art. 44 Reglamento) dado que el texto habla de bases «con fines de distribución, difusión o comercialización»?
3. ¿Qué dicen exactamente la cláusula 4.7 de Meta y su DPA sobre subprocesadores de IA y sobre usar chats de WhatsApp para **evaluar** (no entrenar) agentes con un juez de IA?
4. ¿Es obligatorio o solo recomendable informar al cliente final que habla con una IA, y con qué contenido mínimo?
5. ¿Qué plazos y contenido debe tener la notificación de incidentes entre encargado y responsable, y aplican los 5 días hábiles del art. 38 al encargado extranjero? ¿Cómo afecta el proyecto de reforma 22.388?

## F. Lo que el producto ya hace para cumplir (estado del código)

- La IA nunca confirma pagos, pasa a una persona en pagos, medios, opt-out y casos inciertos (reglas fijas, probadas por el playground).
- Los agentes nuevos nacen en modo **Sugerir** (una persona revisa); el envío real requiere aprobación explícita por canal y re-aprobación al cambiar de modelo.
- Los registros de pruebas (playground) contienen solo texto simulado por el equipo; las salidas del agente se purgan a los 90 días; los rastros se enmascaran (teléfonos, correos, SINPE).
- La clave del proveedor de IA de los agentes es propia y separada de la del bot interno; hay **freno de emergencia** (variable de entorno y panel de super admin).
- Los informes de análisis de chats (flow mining) devuelven solo conteos, sin textos ni números.
- Pendiente por decisión humana/legal: puntos 1–13 de la sección D.
