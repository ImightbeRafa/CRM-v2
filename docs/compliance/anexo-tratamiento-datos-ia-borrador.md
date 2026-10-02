# Anexo de tratamiento de datos y uso de inteligencia artificial — BORRADOR para revisión legal

Betsy CRM (encargada) · Negocio cliente (responsable) · Versión de términos de IA: `ia-2026-10-v1` (la misma que se acepta en Config → Agentes)

> **Estado:** borrador preparado el 2026-10-02 para revisión de un abogado costarricense de protección de datos. **No es asesoría legal ni está publicado.** Los textos entre [corchetes] son decisiones o datos que debe completar Rafael. Donde dice «Ley 8968» se refiere a la Ley N.º 8968 de Protección de la Persona frente al Tratamiento de sus Datos Personales y su Reglamento (Decreto 37554-JP).

## 1. Partes, roles y objeto

1.1. **Negocio** (el «Responsable»): la persona física o jurídica titular de la cuenta en Betsy CRM, que decide para qué y cómo se tratan los datos personales de sus clientes («Clientes Finales»).
1.2. **Betsy CRM** (la «Encargada»): [nombre legal completo, cédula, domicilio y correo de Rafael García Montoya / razón social], que trata esos datos por cuenta del Negocio para prestar el servicio (gestión de conversaciones, pedidos, inventario y agentes de IA).
1.3. Este Anexo regula ese encargo conforme a los arts. 29-31 del Reglamento de la Ley 8968 y forma parte de los Términos de Servicio.

## 2. Instrucciones y límites del tratamiento

2.1. La Encargada trata los datos **únicamente** según este Anexo y las instrucciones documentadas del Negocio (incluida su configuración dentro de la plataforma), y no los usa para fines propios.
2.2. **Prohibición de entrenamiento y de venta.** La Encargada no usa datos de Clientes Finales para entrenar ni mejorar modelos de inteligencia artificial —propios o de terceros—, no los vende y no los comunica a terceros para fines ajenos al servicio. Las pruebas y evaluaciones de los agentes se hacen con mensajes escritos por la Encargada o por el propio Negocio.
2.3. Si una instrucción del Negocio infringe la ley, la Encargada podrá negarse a ejecutarla e informará al Negocio.

## 3. Descripción del tratamiento

| Elemento | Detalle |
|---|---|
| Titulares | Clientes Finales del Negocio y sus contactos |
| Datos | Texto y archivos de las conversaciones de WhatsApp/Instagram, nombre visible, identificadores de contacto, datos de pedidos y envíos que el Negocio registre |
| Finalidad | Gestionar conversaciones, pedidos y atención al cliente; si el Negocio lo autoriza, generar respuestas y sugerencias con IA |
| Duración | Mientras dure la relación y los plazos de la sección 9 |
| Datos enmascarados antes de enviarse a la IA | Números de tarjeta, cuenta/IBAN/SINPE y cédula detectables por patrón (no se garantiza detectar todos los formatos) |

## 4. Uso de inteligencia artificial (autorización previa del Negocio)

4.1. Los agentes de IA permanecen **apagados** hasta que el propietario o un administrador del Negocio acepte los términos de IA en la plataforma. La aceptación registra quién, cuándo y qué versión, es **revocable en cualquier momento** y, al revocarla, los agentes dejan de generar respuestas y sugerencias de inmediato. Un cambio de versión exige una nueva aceptación.
4.2. El ayudante de pegado de clientes (Ventas) sigue la misma autorización; el asistente interno de Telegram/WhatsApp usa xAI y no está cubierto por ella (se rige por la Política y los Términos).
4.2 bis. Cuando un agente está activo, se envían al proveedor de IA únicamente: el texto del mensaje, el nombre visible, el contexto reciente de la conversación y, si corresponde, el estado de un pedido.
4.3. Los proveedores de IA procesan esos datos solo para devolver la respuesta, no pueden entrenar sus modelos con ellos según los términos de sus interfaces empresariales y pueden conservarlos hasta **30 días** únicamente por seguridad y prevención de abusos, salvo que se acuerde retención cero [Rafael: solicitar a OpenAI/xAI].
4.4. Los agentes nuevos operan en modo «Sugerir» (una persona revisa); el envío sin revisión requiere aprobación expresa del Negocio por canal. La IA nunca confirma pagos; los pagos, reembolsos, solicitudes de hablar con una persona, fotos, notas de voz y casos inciertos se pasan a una persona.
4.5. Existe un interruptor de emergencia que la Encargada puede activar para detener todos los agentes (por canal de operación o por seguridad).

## 5. Subencargados

5.1. El Negocio autoriza de forma general a los subencargados de la lista publicada en la Política de Privacidad (sección 6): OpenAI, xAI, Meta, Cloudflare, Railway, Supabase, Vercel, Upstash, Resend, Tilopay, Correos de Costa Rica, Google y Telegram, cada uno solo para su finalidad indicada.
5.2. La Encargada impone a cada subencargado obligaciones de protección equivalentes, responde por ellos y avisa al Negocio con [30] días de antelación de cualquier incorporación o cambio; el Negocio puede oponerse por motivos razonables y, de no resolverse, terminar el servicio.

## 6. Transferencias al extranjero

Los subencargados pueden tratar datos fuera de Costa Rica, incluidos los Estados Unidos. El Negocio autoriza expresamente estas transferencias con la finalidad descrita y se compromete a informarlas a sus Clientes Finales (ver 8.2). La Encargada exige medidas de seguridad y confidencialidad contractuales comparables a las de la Ley 8968.

## 7. Seguridad

La Encargada mantiene medidas técnicas y organizativas adecuadas (Ley 8968, art. 10): aislamiento de datos entre negocios, cifrado en tránsito, control de accesos, auditoría de acciones administrativas, copias de seguridad verificadas, interruptor de emergencia de IA y gestión de claves separada por función. Su personal y subencargados están sujetos a confidencialidad (art. 11).

## 8. Obligaciones del Negocio

8.1. Contar con base legítima para tratar los datos de sus Clientes Finales y para escribirles por WhatsApp/Instagram (incluido el permiso exigido por las políticas de Meta).
8.2. **Informar a sus Clientes Finales** (Ley 8968, art. 5) y que los atiende un asistente de IA. Texto sugerido (editable):

> «Este chat es atendido por un asistente de inteligencia artificial de [NOMBRE DEL NEGOCIO] que puede responderle de forma automática, y una persona de nuestro equipo puede intervenir cuando lo solicite. Sus mensajes se procesan con proveedores tecnológicos en el extranjero (por ejemplo, Estados Unidos) únicamente para responderle y gestionar su pedido; más información y sus derechos en [URL de la política del negocio] o en [correo del negocio]. Si prefiere hablar con una persona, escriba “agente”.»

8.3. No pedir ni cargar en la plataforma datos que no necesite ni identificadores sensibles de pago.
8.4. Decidir, con su asesor, si debe inscribir su base de datos ante la PRODHAB.
8.5. Revisar y aprobar la configuración de sus agentes y decidir cuándo pueden enviar sin revisión.

## 9. Plazos de conservación

| Dato | Plazo |
|---|---|
| Conversaciones y datos del negocio | Mientras la cuenta esté activa; al desconectar un canal se eliminan los tokens y el historial permanece hasta que el Negocio pida su eliminación o cierre la cuenta (entonces, 30 días) |
| Texto de respuestas de IA guardado para revisión | 90 días, junto con su traza técnica (luego solo se conservan conteos y costos) |
| Identificadores de clic de anuncios (si la medición está activa) | 90 días |
| Copias de seguridad | Hasta 90 días |
| Proveedores de IA | Hasta 30 días (seguridad y abuso), salvo retención cero |
| Registro de aceptación de IA y auditoría | Mientras exista la cuenta y [plazo legal] después |

Al terminar la relación la Encargada devuelve o elimina los datos (art. 31 del Reglamento), salvo obligación legal.

## 10. Derechos de los titulares

La Encargada traslada al Negocio, en un máximo de [5] días hábiles, las solicitudes de acceso, rectificación, supresión u oposición que reciba, y le brinda la asistencia razonable para responderlas. El Negocio responde a los titulares.

## 11. Incidentes de seguridad

La Encargada avisa al Negocio sin dilación y a más tardar en [48] horas desde que tenga conocimiento, con la naturaleza del incidente, los datos comprometidos, las acciones correctivas y un contacto. El Negocio, como responsable, informa a los titulares afectados (5 días hábiles, art. 38 del Reglamento) y, en su caso, a la Agencia.

## 12. Auditoría

El Negocio puede solicitar información razonable sobre el cumplimiento de este Anexo y, con aviso previo y sin afectar a otros clientes, una auditoría proporcional.

## 13. Responsabilidad, ley aplicable y vigencia

Rigen las limitaciones de los Términos de Servicio. Ley aplicable y jurisdicción: Costa Rica. Este Anexo entra en vigor al aceptar el Negocio los términos de IA o los Términos de Servicio y dura mientras se presten los servicios.

## Pendientes antes de usarlo

- [ ] Revisión por abogado costarricense (ver las 5 preguntas en `agentes-ia-cumplimiento-2026-10-02.md`).
- [ ] Completar los datos legales de la Encargada y los plazos entre corchetes.
- [ ] Decidir cómo se acepta el Anexo en el alta de cada negocio (hoy la aceptación del uso de IA ya se registra en Config → Agentes; la aceptación del Anexo completo todavía no tiene pantalla propia).
- [ ] Confirmar con OpenAI y xAI la retención cero y el DPA de cada cuenta de API.
