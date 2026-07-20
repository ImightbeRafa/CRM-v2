# Guía: Bot de WhatsApp con Meta Cloud API (envío de reportes)

Guía práctica para implementar envío de reportes por WhatsApp usando **WhatsApp Cloud API** (Graph API de Meta): conectar un número, autenticarte, y enviar mensajes/documentos desde tu backend de forma automática.



---

## Objetivo final

1. Tener un número de WhatsApp Business conectado a tu app vía **WhatsApp Cloud API**.
2. (Opcional pero recomendado) Recibir webhooks de Meta (mensajes entrantes y/o statuses).
3. Desde tu backend, generar un reporte y **enviarlo por WhatsApp** a un cliente.
4. Disparar ese envío de forma **automática** (cron, evento, cola).

---

## Arquitectura (mental model)

```
Tu app (backend)
  ├── Genera el reporte (PDF / texto / link)
  ├── Llama Graph API de Meta
  │     POST /{PHONE_NUMBER_ID}/messages
  └── Opcional: recibe eventos en
        POST https://TU_DOMINIO/.../whatsapp/webhook

Cliente WhatsApp
  ← recibe template / texto / documento
```

**Regla clave:** Meta solo transporta mensajes. Los reportes, horarios y a quién se envían los decides tú en tu código.

Credenciales globales (un número = un remitente):

| Variable | Para qué |
|----------|----------|
| `WHATSAPP_ACCESS_TOKEN` | Bearer token para Graph API |
| `WHATSAPP_PHONE_NUMBER_ID` | ID del número que envía (no es el número visible) |
| `WHATSAPP_VERIFY_TOKEN` | String que **tú inventas** para verificar el webhook |
| `META_APP_SECRET` | Validar firma `x-hub-signature-256` de webhooks |

API base típica: `https://graph.facebook.com/v24.0` (ajusta la versión a la que uses en el dashboard).

---

## Regla crítica de Meta (léela antes de codear)

WhatsApp distingue dos modos:

| Situación | Qué puedes enviar |
|-----------|-------------------|
| El **cliente te escribió** en las últimas ~24h (Customer Service Window / CSW) | Texto libre, PDF/documento, botones, etc. |
| **Tú inicias** el contacto (reporte automático, sin CSW abierta) | Solo **Message Templates** aprobados por Meta |

Importante:

- Enviar un template **NO** abre la ventana de mensajes libres.
- La CSW se abre solo cuando el **cliente** te escribe (o responde a tu template).
- Si el cliente **no responde**, no puedes mandar un PDF “libre” después del template. Tienes que incluir el documento en el template, o usar un link, o esperar su respuesta.

Para reportes push automáticos, diseña el flujo con templates desde el día 1.

---

## Fase 1 — Meta: crear app y producto WhatsApp

### Paso 1.1 — Cuentas necesarias

- [ ] Cuenta de Facebook / Meta
- [ ] [Meta Business Manager](https://business.facebook.com/)
- [ ] [Meta for Developers](https://developers.facebook.com/)

### Paso 1.2 — Crear la app

1. Entra a [developers.facebook.com/apps](https://developers.facebook.com/apps).
2. **Create App** → tipo orientado a **Business** (el wizard de Meta cambia de UI; elige la opción de negocio / Other → Business si aplica).
3. Asóciala a tu Business Manager.
4. Guarda:
   - **App ID**
   - **App Secret** (Settings → Basic) → solo servidor, como `META_APP_SECRET`

### Paso 1.3 — Agregar WhatsApp

1. Dashboard de la app → **Add Product** → **WhatsApp**.
2. Entra a **WhatsApp → API Setup**.
3. Anota:
   - **Temporary access token** (caduca; solo pruebas)
   - **Phone number ID**
   - **WhatsApp Business Account ID** (WABA ID)
   - Número de prueba que Meta te asigna

```
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_BUSINESS_ACCOUNT_ID=...   # opcional pero útil
```

### Paso 1.4 — Allowlist en modo Development

Mientras la app esté en **Development**:

1. En API Setup, agrega los números de WhatsApp que vas a usar para probar (tu celular, etc.).
2. Esos números deben aceptar la invitación / estar verificados según el flujo actual de Meta.
3. Sin eso, Graph puede aceptar la llamada pero el mensaje no llega (o falla).

### Paso 1.5 — Token permanente (producción)

El temporary token de API Setup **no** sirve para producción.

1. Business Settings → **Users → System users**.
2. Crea un System User.
3. **Assign assets** → tu WhatsApp Business Account (WABA), con control total / permisos de mensajería.
4. **Generate token** para tu Meta App, con:
   - `whatsapp_business_messaging`
   - `whatsapp_business_management`
5. Elige token que no expire (opción de System User), si está disponible.
6. Guárdalo como `WHATSAPP_ACCESS_TOKEN` (secreto de servidor, nunca en frontend ni git).

### Paso 1.6 — Número de producción

1. Agrega un número real al WABA (WhatsApp Manager / phone numbers).
2. Completa display name / verificación de negocio si Meta lo pide.
3. Usa el **Phone Number ID** de ese número (no el dígito que ve el usuario).
4. Para hablar con clientes reales fuera de la allowlist: app en **Live** y acceso avanzado a los permisos de WhatsApp (App Review si Meta lo exige en tu caso).

---

## Fase 2 — Webhook (recomendado)

Para **solo enviar** reportes, el webhook no es obligatorio. Sí conviene para:

- Confirmar que Meta puede hablar con tu servidor
- Recibir respuestas del cliente (abre CSW → puedes mandar PDF libre)
- Opcionalmente trackear `statuses` (sent / delivered / read / failed)

### Paso 2.1 — Inventa el verify token

```
WHATSAPP_VERIFY_TOKEN=un_string_largo_aleatorio
```

Exactamente el mismo valor en Meta y en tu `.env`.

### Paso 2.2 — Endpoint en tu backend

URL pública HTTPS, ejemplo:

```
https://TU_DOMINIO/api/bot/whatsapp/webhook
```

#### GET — verificación

Meta envía:

- `hub.mode` (= `subscribe`)
- `hub.verify_token`
- `hub.challenge`

Si `hub.mode === 'subscribe'` y el token coincide → responde **200** con body = `hub.challenge` en **texto plano** (`Content-Type: text/plain`).  
Si no → **403**.

#### POST — eventos

1. Lee el **raw body** como string (antes de parsear JSON).
2. En producción, valida `x-hub-signature-256`:
   - Header: `sha256=<hex>`
   - Calculas: HMAC-SHA256(rawBody, `META_APP_SECRET`)
   - Comparación timing-safe
   - Si falta firma o no coincide → 401/403
3. Parsea JSON.
4. Responde **rápido** `200` (Meta reintenta si fallas o te pasas del timeout; ~20s).
5. Procesa en background si el trabajo es pesado.

Payload típico (mensaje entrante, simplificado):

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "changes": [{
      "value": {
        "metadata": { "phone_number_id": "YOUR_PHONE_NUMBER_ID" },
        "messages": [{
          "from": "50688887777",
          "id": "wamid....",
          "timestamp": "1710000000",
          "type": "text",
          "text": { "body": "Hola" }
        }],
        "contacts": [{
          "profile": { "name": "Juan" },
          "wa_id": "50688887777"
        }]
      },
      "field": "messages"
    }]
  }]
}
```

También pueden llegar `value.statuses` (delivered/read/failed). Si no los usas, ignóralos y responde 200.

Deduplica por `messages[].id`: Meta puede reenviar el mismo POST.

### Paso 2.3 — Configurar webhook en Meta

1. App → WhatsApp → **Configuration** → Webhook → Edit.
2. Callback URL: tu URL HTTPS.
3. Verify token: = `WHATSAPP_VERIFY_TOKEN`.
4. Suscribe al menos: **`messages`**.
5. (Opcional) campos de status si quieres delivery receipts.
6. Guarda. Meta hace el GET; debe quedar “Verified”.

### Paso 2.4 — Variables de entorno mínimas

```env
WHATSAPP_ACCESS_TOKEN=...
WHATSAPP_PHONE_NUMBER_ID=...
WHATSAPP_VERIFY_TOKEN=...
META_APP_SECRET=...
```

Opcional: `WHATSAPP_BUSINESS_ACCOUNT_ID`.

---

## Fase 3 — Enviar mensajes con Graph API

Todo el envío sale de tu **servidor**. Nunca expongas el access token al cliente.

### Paso 3.1 — Enviar texto (solo dentro de CSW)

```
POST https://graph.facebook.com/v24.0/{PHONE_NUMBER_ID}/messages
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: application/json
```

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "50688887777",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "Tu reporte del mes está listo."
  }
}
```

Notas:

- `to`: dígitos internacionales **sin** `+` ni espacios (ej. `50688887777`).
- Límite de texto ~4096 caracteres; parte mensajes largos si hace falta.
- Fuera de CSW esto **falla**; usa template.

Respuesta OK típica incluye `messages[0].id` (wamid). Guárdalo en tu log.

### Paso 3.2 — Enviar PDF como documento libre (solo dentro de CSW)

Dos pasos (path recomendado):

**1) Subir media**

```
POST https://graph.facebook.com/v24.0/{PHONE_NUMBER_ID}/media
Authorization: Bearer {WHATSAPP_ACCESS_TOKEN}
Content-Type: multipart/form-data
```

Campos:

- `messaging_product` = `whatsapp`
- `file` = binario del PDF
- `type` = `application/pdf`

Respuesta: `{ "id": "MEDIA_ID" }`.

Límite típico de documentos: hasta ~100 MB (confirma en la doc actual). Para reportes, apunta a PDFs livianos.

**2) Enviar mensaje document**

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "50688887777",
  "type": "document",
  "document": {
    "id": "MEDIA_ID",
    "filename": "reporte-marzo.pdf",
    "caption": "Reporte de marzo"
  }
}
```

Alternativa: `document.link` con URL HTTPS pública (Meta lo documenta; suele ser menos fiable que upload + `id`).

### Paso 3.3 — Enviar template (fuera de CSW / inicio proactivo)

```json
{
  "messaging_product": "whatsapp",
  "to": "50688887777",
  "type": "template",
  "template": {
    "name": "monthly_report_ready",
    "language": { "code": "es" },
    "components": [
      {
        "type": "body",
        "parameters": [
          { "type": "text", "text": "Juan" },
          { "type": "text", "text": "Marzo 2026" }
        ]
      }
    ]
  }
}
```

Si el template tiene **header DOCUMENT**, al enviar debes incluir también el componente header con el media:

```json
{
  "type": "header",
  "parameters": [
    {
      "type": "document",
      "document": {
        "id": "MEDIA_ID",
        "filename": "reporte-marzo.pdf"
      }
    }
  ]
}
```

(Primero subes el PDF con `/media`, luego usas ese `MEDIA_ID` en el template.)

---

## Fase 4 — Templates para reportes proactivos

### Paso 4.1 — Elegir categoría con cuidado

| Categoría | Cuándo |
|-----------|--------|
| **UTILITY** | Avisos transaccionales / cuenta (facturas, estados). Meta puede **recategorizar** si parece marketing. |
| **MARKETING** | Newsletters, promos, muchos “reportes mensuales” genéricos. Suele exigir opt-in más estricto y tiene otro pricing. |
| **AUTHENTICATION** | OTP / códigos. No aplica a reportes. |

No asumas Utility. Si Meta lo rechaza o lo mueve a Marketing, ajusta copy y opt-in.

### Paso 4.2 — Tres patrones válidos para mandar el reporte

**Patrón A — Template con PDF en el header (recomendado para push puro)**

1. Creas template con header `DOCUMENT` + body con variables.
2. Job: genera PDF → upload `/media` → `sendTemplate` con header document + body params.
3. El cliente recibe el aviso **y** el PDF sin necesidad de responder.

**Patrón B — Template con botón URL**

1. Template con texto + botón URL a `https://tuapp.com/reportes/{token}`.
2. El PDF vive en tu app (link firmado / expira).
3. Más simple de aprobar a veces; el archivo no viaja por WhatsApp.

**Patrón C — Template de aviso + PDF libre tras respuesta**

1. Mandas template: “Tu reporte está listo. Responde OK para recibirlo.”
2. Webhook recibe la respuesta del cliente → se abre CSW.
3. Ahí sí: `sendDocument` libre.

No uses el anti-patrón: template → inmediatamente `sendDocument` libre sin CSW. **Fallará.**

### Paso 4.3 — Crear el template en Meta

1. WhatsApp Manager → **Message templates** (o Business Suite).
2. Nombre: minúsculas/guiones bajos, ej. `monthly_report_ready`.
3. Idioma: `es` / `es_MX` / el que uses al enviar (debe coincidir).
4. Componentes: body con `{{1}}`, `{{2}}`; opcional header DOCUMENT; opcional botón URL.
5. Envía a revisión y espera **Approved**.

---

## Fase 5 — Lógica de reportes en tu app (lo que Meta no hace)

### Paso 5.1 — Datos mínimos por cliente

- `whatsappPhone` — E.164 sin `+`
- `optInWhatsAppReports` — consentimiento explícito (requerido por política de WhatsApp)
- preferencias: frecuencia, timezone, tipo de reporte
- opcional: `lastCustomerMessageAt` para saber si hay CSW abierta

Nunca envíes sin opt-in.

### Paso 5.2 — Generador de reporte

```
generateClientReport(clientId, period) → { textSummary, pdfBuffer, filename }
```

PDF, CSV, o link. Meta no participa aquí.

### Paso 5.3 — Módulo WhatsApp en el backend

Funciones sugeridas:

- `sendText(to, body)` — solo CSW
- `sendDocument(to, buffer, filename, caption?)` — upload + message; solo CSW
- `sendTemplate(to, name, language, components)` — fuera o dentro de CSW
- `uploadMedia(buffer, mime, filename)` → `mediaId`

Env vars: `WHATSAPP_ACCESS_TOKEN` + `WHATSAPP_PHONE_NUMBER_ID`.

### Paso 5.4 — Orquestador correcto

```
sendReportToClient(clientId, period):
  1. Cargar cliente: teléfono + opt-in
  2. Si no hay opt-in o teléfono → abortar + log
  3. generateClientReport(...)
  4. Elegir patrón:
     A) upload PDF → sendTemplate(con header document)
     B) sendTemplate(con URL al reporte)
     C) sendTemplate(aviso) y esperar webhook;
        cuando el cliente responda → sendDocument
  5. Guardar log: clientId, period, wamid, pattern, status, error
```

### Paso 5.5 — Disparo automático

| Trigger | Ejemplo |
|---------|---------|
| Cron | Lunes 8:00 → reportes semanales |
| Evento | Cierre de mes / job terminado |
| Cola | Worker procesa `ReportJob` uno a uno |
| Manual | Botón en admin |

Patrón recomendado:

1. Job crea N tareas `send_report` (una por cliente).
2. Worker con rate limiting (no saturar Graph).
3. Reintentos con backoff en 429/5xx.
4. Idempotencia: unique `(clientId, period, reportType)`.

### Paso 5.6 — Robustez

- No envíes miles de mensajes en un loop síncrono sin pausas.
- Guarda `messages[0].id`.
- Deduplica webhooks por `message.id`.
- Loguea `error.code` / `error.message` de Graph; **nunca** el token.
- Si usas CSW tracking, actualiza `lastCustomerMessageAt` en cada inbound del webhook.

---

## Fase 6 — Checklist (para la IA asistente)

### Meta

- [ ] App creada y asociada al Business Manager
- [ ] Producto WhatsApp agregado
- [ ] Phone Number ID anotado
- [ ] Números de prueba en allowlist (Development)
- [ ] System User + token permanente con permisos de messaging
- [ ] App Secret en env del servidor
- [ ] Webhook HTTPS verificado (si lo usan)
- [ ] Campo `messages` suscrito
- [ ] Template(s) de reporte **Approved** (obligatorio para push sin CSW)
- [ ] Decidido patrón A, B o C para el PDF
- [ ] Live + número de producción antes de clientes reales

### Backend

- [ ] Env vars solo en servidor
- [ ] GET webhook verify (texto plano)
- [ ] POST webhook + HMAC en producción
- [ ] `sendText` / `uploadMedia` + `sendDocument` / `sendTemplate`
- [ ] Generador de reportes de dominio
- [ ] Teléfono + opt-in + log de envíos
- [ ] Job/cron/cola con idempotencia y reintentos
- [ ] Prueba texto dentro de CSW
- [ ] Prueba template sin CSW
- [ ] Prueba PDF (por template header o tras reply)
- [ ] Prueba job automático a 1 cliente

### Seguridad y compliance

- [ ] Token / App Secret fuera de git y frontend
- [ ] Firma de webhook en producción
- [ ] Opt-in almacenado y respetado
- [ ] HTTPS en callback
- [ ] No loguear tokens ni PII innecesaria

---

## Fase 7 — Prueba mínima end-to-end

1. Env con número de **prueba** + temporary o system token.
2. Agrega tu WhatsApp a la allowlist de Development.
3. (Si aplica) Verifica webhook en Meta.
4. Abre CSW: mándale un “Hola” al número del negocio desde tu WhatsApp.
5. Desde tu backend: `sendText` → debe llegar.
6. `uploadMedia` + `sendDocument` con un PDF chico → debe llegar.
7. Espera a que pase la CSW **o** usa otro número sin ventana: `sendTemplate` aprobado → debe llegar.
8. Prueba el patrón de reporte real (A, B o C).
9. Conecta el cron/job a un solo cliente de prueba.
10. Confirma Graph `200` + `messages[0].id` y el mensaje en el teléfono.

Luego: token permanente, número real, Live, cola, opt-ins.

---

## Errores comunes

| Síntoma | Causa típica |
|---------|----------------|
| Webhook no verifica | Token distinto, o GET no devuelve `challenge` en texto plano |
| `(#131047)` / outside messaging window | Enviaste texto/PDF libre sin CSW; falta template |
| Template OK pero el PDF libre después falla | El template **no** abre CSW; el cliente no respondió |
| 401 Graph | Token vencido o sin permisos / asset no asignado al System User |
| Llega en prueba pero no a clientes | Development mode, sin Live, o número incorrecto (Phone Number ID) |
| Webhook verified pero no llegan POST | No suscribiste `messages`, URL mal, o servidor no público |
| Firma inválida | No usas raw body, o `META_APP_SECRET` incorrecto |
| Template rechazado | Categoría/copy incorrectos (Marketing vs Utility) |
| Mensaje no llega en Development | Destino no está en allowlist |

---

## Qué pedirle a tu IA (prompts por fase)

1. **“Implementa GET/POST del webhook Cloud API: verify token, challenge en texto plano, HMAC con META_APP_SECRET sobre raw body.”**
2. **“Crea módulo whatsapp: sendText, uploadMedia, sendDocument, sendTemplate contra Graph v24 con WHATSAPP_ACCESS_TOKEN y WHATSAPP_PHONE_NUMBER_ID.”**
3. **“Diseña sendReportToClient con patrón A (template + header DOCUMENT): generar PDF, subir media, enviar template. Respeta opt-in.”**
4. **“Alternativa patrón C: template de aviso + al recibir reply en webhook, enviar PDF con sendDocument.”**
5. **“Job/cron semanal que encola envíos con reintentos, rate limit e idempotencia clientId+period.”**
6. **“Ayúdame a definir el Message Template en Meta (nombre, idioma, body variables, header document o botón URL) según categoría correcta.”**

---

## Resumen en una frase

**En Meta:** app + WhatsApp + Phone Number ID + token (System User) + webhook opcional + **templates aprobados** para mensajes proactivos.  
**En tu app:** generar reporte → Graph API → job automático solo a clientes con opt-in.  
**Restricción:** fuera de la ventana de 24h (abierta por el cliente) no hay PDF/texto libre; usa template (idealmente con documento o link).

Meta no genera reportes. Tu backend genera; WhatsApp entrega.
