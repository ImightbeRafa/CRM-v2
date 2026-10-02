# Cumplimiento y protección de datos — índice (Betsy CRM)

Actualizado 2026-10-02 · Rama `claudio/agent-ops`

## Decisión de fondo (Rafael, 2026-10-02)
- Betsy **no vende**, **no comparte** datos con terceros para fines ajenos al servicio y **no usa datos de clientes para entrenar ni mejorar IA**.
- Las pruebas y evaluaciones de los agentes se hacen con mensajes escritos por el propio equipo o negocio (datos propios), nunca con chats reales de clientes.
- El uso de proveedores de IA por parte de un negocio requiere **su autorización previa (opt-in)**, revocable.

## Documentos (rutas)

| Documento | Ruta | Estado |
|---|---|---|
| **Política de privacidad — inglés (v8.0)** | `src/app/privacy/page.tsx` (se ve en `/privacy`) | Borrador en la rama, **sin publicar** |
| **Política de privacidad — español (v8.0)** | `src/app/privacy/es/page.tsx` (se ve en `/privacy/es`) | Borrador en la rama, **sin publicar** |
| Lista de proveedores y fechas de la política (única fuente) | `src/lib/legal/privacy-content.ts` | Editar aquí para cambiar ambas páginas |
| Términos de servicio (cláusula 12 corregida + 12A «Funciones de IA») | `src/app/terms/page.tsx` | Borrador en la rama, **sin publicar** |
| **Anexo de tratamiento de datos y uso de IA** (contrato Betsy–negocio) | `docs/compliance/anexo-tratamiento-datos-ia-borrador.md` | Borrador para abogado |
| **Informe de cumplimiento** (Ley 8968, Meta, OpenAI/xAI/Anthropic, brechas, 5 preguntas para abogado) | `docs/compliance/agentes-ia-cumplimiento-2026-10-02.md` | Actualizado con la aclaración de hoy |
| Texto de la autorización de IA que acepta el negocio (única fuente) | `src/lib/soft-ai/ai-terms.ts` (versión `ia-2026-10-v1`) | Implementado |
| Runbook del SQL 043–047 | `docs/runbooks/agent-ops-sql-043-047.md` | Listo |

Ruta completa en este equipo: `D:\Coder\CRM-v2-agentops\docs\compliance\`.

## Qué está implementado en el producto
1. **Autorización previa por negocio** (Config → Agentes, tarjeta superior): hasta que el propietario o un administrador acepta, **ningún mensaje de clientes llega a un proveedor de IA**; los agentes no responden ni sugieren y la aprobación de envío real se rechaza. Queda registrado quién, cuándo y qué versión; es revocable y detiene a los agentes al instante; se audita. Probar no la requiere (solo usa texto del equipo). Cubre también el ayudante de pegado de clientes de Ventas. Antes de enviar, los agentes enmascaran tarjetas, cuentas y cédulas detectables por patrón. Si se revoca, un mensaje en curso tampoco se envía ni se sugiere.
2. Aislamiento por negocio, auditoría de acciones de administración, interruptor de emergencia de IA, claves de IA separadas del bot interno.
3. Flujos de análisis (flow mining) con solo conteos.

## Antes de publicar (lista para Rafael)
1. Revisión legal de las dos políticas, los Términos y el Anexo (5 preguntas en el informe).
2. Completar: datos legales de la encargada, plazos entre corchetes del Anexo, confirmar la **región** de Supabase/Cloudflare para describir «dónde» (hoy la política dice «puede incluir Estados Unidos»), y que `privacy@betsycrm.com` recibe correo.
3. Verificado en esta ronda: el historial NO se borra a las 24 h al desconectar (se corrigió a «hasta que el negocio lo pida / cierre, luego 30 días»); la traza técnica de IA ahora también se purga a los 90 días. Falta confirmar el plazo de 30 días de supresión y el de 90 días de copias.
4. Pedir a OpenAI y xAI el **DPA** y la **retención cero**; crear el proyecto de OpenAI aparte para `SOFT_AI_OPENAI_API_KEY`.
5. Publicar (merge + deploy) y avisar a los negocios con tiempo.
6. **Aviso importante de despliegue:** al activarse la autorización previa, los agentes ya existentes (incluido el piloto) **dejan de responder/sugerir hasta que su propietario haga clic en «Autorizar el uso de IA»** una vez.

## Pendiente de decisión
- Aviso a los clientes finales: hoy es una **obligación del negocio** con texto sugerido (Anexo 8.2). Se puede automatizar como un primer mensaje opcional del agente; requiere decidir texto y dónde se envía.
- Extender la autorización previa al asistente interno (Telegram/WhatsApp): hoy está cubierto solo por la política (declarado con honestidad en §5.6); exigirlo implica tocar el bot interno, que está bloqueado por decisión. El ayudante de pegado ya sigue la autorización.
- Aceptación del Anexo completo en el alta de cada negocio (hoy solo se registra la aceptación del uso de IA).
- Política de retención/borrado de las tablas nuevas de agentes dentro de la función de exportación/borrado de la Ley 8968 (en espera).
