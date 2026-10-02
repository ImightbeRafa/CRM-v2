# Runbook: aplicar el SQL 043–047 (Agent Ops) — paso a paso

Fecha: 2026-10-02 · Rama: `claudio/agent-ops` · Alcance: solo el inbox (agentes de chat). El bot interno de Telegram/WhatsApp **no** se toca.

Este documento es para quien aplica el SQL (Rafael). Cada paso dice **qué se hace, por qué y cómo saber que salió bien**. Nada de esto se ejecutó en producción: todo se probó en una base de datos desechable (Postgres 17 en Docker).

## 0. Qué se va a crear (y qué NO)

Cinco archivos, todos **solo crean tablas nuevas**. No modifican ni borran nada existente, no tocan `lm_*`, no usan `prisma db push`.

| Archivo | Tablas nuevas | Para qué |
|---|---|---|
| `043_chat_automation_rules.sql` | `ChatAutomationRule`, `ChatAutomationRuleRun` | Reglas simples (etiquetar / asignar / tarea). Nunca mensajes a clientes. |
| `044_platform_agent_policy.sql` | `PlatformAgentPolicy` | Botón de freno de emergencia (solo super admin). |
| `045_agent_improvement.sql` | `ChatAgentVersion`, `ChatAgentFeedback`, `ChatAgentEvalRun` | Versiones de cada agente, 👍/👎 del equipo, resultados de pruebas. |
| `046_chat_agent_inventory_map.sql` | `ChatAgentInventoryItem` | Qué productos puede cotizar cada agente. |
| `047_chat_agent_test_cases.sql` | `ChatAgentTestCase` | Pruebas guardadas del playground. |

Propiedades de seguridad de los cinco (verificadas): `CREATE TABLE IF NOT EXISTS` (se puede repetir sin riesgo), sin llaves foráneas (no bloquean tablas ocupadas), `lock_timeout 3 s` y `statement_timeout 30 s`, **RLS activado** en todas las tablas (la API pública de Supabase no puede leerlas), cada archivo dentro de su propio `BEGIN/COMMIT` (si falla, se deshace completo).

**Si no se aplican:** la app sigue funcionando igual. Solo quedan apagadas las funciones nuevas (el panel dice "se activa con la próxima actualización"). El freno de emergencia por variable de entorno (`SOFT_AGENT_KILL=1`) funciona aunque 044 no esté aplicado.

## 1. Antes de empezar (5 minutos, solo lectura)

1. Confirmá que el código nuevo ya está desplegado **o** que lo vas a desplegar después: el código tolera que las tablas no existan, así que el orden recomendado es **(a) desplegar, (b) aplicar SQL, (c) verificar**. El orden inverso también es seguro.
2. Elegí un momento tranquilo (cualquiera sirve; son tablas vacías, tarda segundos). No hace falta madrugada.
3. Tené a mano `DIRECT_URL` de Supabase (puerto **5432**, no el pooler 6543). Está en `.env.local` o en el panel de Supabase.
4. **No uses la vista previa de Railway para nada de esto**: comparte la base de datos de producción.

## 2. Respaldo fresco (obligatorio antes de tocar la base)

Los respaldos automáticos corren a las 02:00 UTC (completo) y 14:00 UTC (parcial) hacia Cloudflare R2. Para tener uno **ahora**:

```bash
curl -X POST https://www.betsycrm.com/api/cron/backup \
  -H "x-api-key: <BACKUP_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"kind":"full"}'
```

- `BACKUP_API_KEY` es el valor que configuraste en Cloudflare (el handoff del 2026-10-02 dice que se rotó ese día; si no lo tenés, definí uno nuevo con `wrangler secret put BACKUP_API_KEY` y redesplegá antes).
- Cómo saber que salió bien: la respuesta es exitosa, y en **Super admin → Salud** (`/super-admin/salud`) el respaldo completo aparece con "hace 0–1 h". La página de Respaldos también lo lista.
- Si el respaldo falla: **detenete**. No apliques nada hasta que haya uno bueno (el sistema envía un correo a `OPS_ALERT_EMAIL` cuando falla).
- El último simulacro de restauración (2026-10-02) pasó: 92/92 tablas, 102,328 filas.

## 3. Aplicar el SQL

Desde la carpeta del repo (rama ya fusionada a la línea viva). Un solo comando; **PowerShell**:

```powershell
$env:BETSY_V2_APPLY_MIGRATIONS = "1"
$env:BETSY_V2_APPLY_CONFIRM_HOST = "<hostname exacto de DIRECT_URL, ej. db.xxxx.supabase.co>"
$env:BETSY_V2_APPLY_FILES = "043,044,045,046,047"
node --env-file=.env.local scripts/apply-betsy-v2-additive-sql.mjs
```

Qué hace el script (todas son protecciones ya probadas):
- Exige las tres variables de arriba (si falta una, no hace nada).
- Se niega a correr si el host no coincide o si el puerto no es 5432.
- Se niega si algún archivo contiene `DROP TABLE`, `TRUNCATE` o `DROP COLUMN`.
- Aplica los archivos en orden; **se detiene en el primer error**.
- Después de cada archivo comprueba que cada tabla exista **y tenga RLS activado**; si no, falla en rojo.

Salida esperada: una línea `ok 043 in …ms` por archivo y al final `All requested additive migrations applied.` (el texto dice "Feature flags remain off": es cierto, no se enciende nada).

## 4. Verificar (2 minutos)

1. Resumen del propio script: los 5 `ok`.
2. Comprobación manual en el SQL Editor de Supabase (solo lectura):
   ```sql
   select relname, relrowsecurity
   from pg_class
   where relname in ('ChatAutomationRule','ChatAutomationRuleRun','PlatformAgentPolicy','ChatAgentVersion',
                     'ChatAgentFeedback','ChatAgentEvalRun','ChatAgentInventoryItem','ChatAgentTestCase')
   order by 1;
   ```
   Deben salir **8 filas, todas con `relrowsecurity = true`**.
3. En la app (como super admin):
   - `/super-admin/agentes`: el panel "Freno de emergencia" ya no responde 409 al armarlo (probalo armando y reanudando con un motivo; queda en auditoría).
   - `/config/agentes` → un agente → **Avanzado**: aparecen "Productos que puede cotizar" y "Calidad por versión"; en **Probar** aparecen "Escenarios listos", "Mis pruebas" y "Comparar modelos".
   - `/config` → Chats: "Automatizaciones" muestra el formulario (las reglas nacen apagadas).
4. Al día siguiente: confirmá que corrió el respaldo de las 02:00 UTC.

## 5. Después de aplicar: cosas que cambian de comportamiento

- Con **046** aplicado, un agente **nuevo** (incluido el "Ventas" de arranque) que tenga la herramienta de búsqueda de productos necesita **elegir al menos un producto antes de pasar a "En vivo"**. Los agentes que ya están en vivo no se afectan, pero si uno vuelve a "Borrador" y luego a "En vivo", se le pedirá la lista.
- Las **reglas de automatización** y el **freno por panel** requieren 043 y 044 respectivamente; el resto funciona con lo ya existente.
- Nada de esto activa el envío real de mensajes por IA: los agentes siguen en modo **Sugerir**/solo humanos hasta que alguien los apruebe explícitamente.

## 6. Si algo sale mal (retroceso)

- **El script falló a mitad:** cada archivo es atómico. Lo ya aplicado queda; lo que falló no dejó nada. Corregí la causa y volvé a correr (es repetible).
- **Querés dar marcha atrás:** desplegá el código anterior. Las tablas nuevas quedan ignoradas y vacías, sin efecto. **No hace falta borrarlas.**
- Solo si Rafael decide expresamente eliminarlas (nunca desde el script, que rechaza `DROP`): son tablas nuevas sin datos de otras funciones; se pueden borrar a mano en el SQL Editor con una lista explícita. Pedí confirmación antes.
- **Restaurar desde respaldo** es el último recurso y se hace con `scripts/restore-from-backup.ts` hacia una base de prueba (por defecto, local), nunca directo sobre producción.

## 7. Lo que NO debe hacerse

- `prisma db push` / `prisma migrate` contra Supabase (borraría las tablas `lm_*` de logística).
- Aplicar desde la vista previa de Railway, o con el pooler (6543).
- Pegar claves en el chat, en Notion o en el código.

## 8. Variables de entorno relacionadas (referencia)

| Variable | Para qué | Dónde |
|---|---|---|
| `SOFT_AI_OPENAI_API_KEY` | Clave **propia** de los agentes del inbox para GPT-6 Luna (proyecto de OpenAI separado, con presupuesto propio). **No** es `OPENAI_API_KEY`. | Cloudflare (`wrangler secret put`) |
| `SOFT_AGENT_KILL=1` | Freno de emergencia por variable (funciona sin base de datos). | Cloudflare |
| `CHAT_SSE=1` | Actualización en vivo del inbox. Dejar apagado hasta la prueba de carga (INT-25). | Cloudflare |
| `SOFT_AI_OPENAI_REASONING` | Opcional: nivel de razonamiento (none/low/medium/high). | Cloudflare |

### Aclaración sobre qué modelo usa cada cosa

- **Bot interno del equipo (Telegram/WhatsApp, `src/lib/bot/**`)**: usa **Grok** (xAI, modelo `grok-4.6`) para conversar y extraer pedidos. Usa la clave `OPENAI_API_KEY` **solo** para transcribir notas de voz con Whisper. No se toca.
- **Agentes del inbox (clientes finales)**: hoy corren en Grok por defecto; se pueden pasar a **GPT-6 Luna** uno por uno desde "Avanzado" cuando exista `SOFT_AI_OPENAI_API_KEY`.
- Por eso los dos sistemas **no comparten la clave de OpenAI**: el bot interno la usa para voz; los agentes del inbox usan la suya.
