import Link from 'next/link'
import { describeDeletionStatus, isConfirmationCode } from '@/lib/meta-data-deletion/core'
import { readDeletionStatus } from '@/lib/meta-data-deletion/store'

export const dynamic = 'force-dynamic'

const dateFmt = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/Costa_Rica' })

const toneClass = {
  ok: 'border-green-200 bg-green-50 text-green-900',
  wait: 'border-amber-200 bg-amber-50 text-amber-900',
  warn: 'border-red-200 bg-red-50 text-red-900',
} as const

export default async function DataDeletionPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const { code } = await searchParams
  // Status link returned to Meta by the data-deletion callback.
  const confirmationCode = isConfirmationCode(code) ? code : null
  const request = confirmationCode ? await readDeletionStatus(confirmationCode).catch(() => null) : null
  const status = describeDeletionStatus(request?.status ?? null)

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Eliminación de datos</h1>
        <p className="text-gray-500 mb-6">Data deletion · English below</p>

        <div className="space-y-6 text-gray-700">
          {confirmationCode && (
            <section className={`rounded-md border p-4 ${toneClass[status.tone]}`}>
              <h2 className="text-lg font-semibold mb-1">{status.title}</h2>
              <p>
                Código de confirmación / Confirmation code: <strong>{confirmationCode}</strong>
              </p>
              {request && (
                <p className="text-sm mt-1">
                  Recibida / Received: {dateFmt.format(new Date(request.createdAt))}
                  {request.completedAt ? ` · Completada / Completed: ${dateFmt.format(new Date(request.completedAt))}` : ''}
                </p>
              )}
              <p className="text-sm mt-2">{status.body}</p>
            </section>
          )}

          <section>
            <h2 className="text-xl font-semibold mb-3">Desconectar o eliminar: no es lo mismo</h2>
            <ul className="list-disc ml-6 space-y-2">
              <li>
                <strong>Desconectar</strong> (en Betsy: Configuración › Cuentas conectadas → Desvincular, o quitando Betsy en
                la configuración de Facebook o Instagram): borramos los tokens de acceso de inmediato y dejamos de recibir y
                enviar mensajes. El historial de conversaciones se queda en el espacio del negocio.
              </li>
              <li>
                <strong>Eliminar</strong>: borramos las conversaciones, mensajes, archivos (fotos, audios, videos,
                documentos), referencias de anuncios y registros de IA recibidos por las cuentas de Instagram o WhatsApp que
                conectaste, y desconectamos esas cuentas. Los pedidos y clientes que el equipo del negocio creó siguen siendo
                del negocio. Las copias de seguridad se renuevan en 14 días.
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Opción 1: desde Facebook o Instagram</h3>
            <ol className="list-decimal ml-6 space-y-2">
              <li>
                Abrí la configuración de Facebook (Configuración y privacidad → Configuración → Integraciones comerciales) o
                de Instagram (Configuración → Apps y sitios web).
              </li>
              <li>Buscá <strong>Betsy CRM</strong>, tocá <strong>Eliminar</strong> y marcá la opción para pedir que se borren tus datos.</li>
              <li>Meta nos avisa, borramos los datos y te da un código de confirmación con un enlace a esta página para ver el estado.</li>
            </ol>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Opción 2: por correo</h3>
            <p>
              Escribí a{' '}
              <a href="mailto:support@betsycrm.com" className="text-blue-600 hover:underline">
                support@betsycrm.com
              </a>{' '}
              con tu usuario o correo de Betsy, la cuenta de Instagram o WhatsApp conectada y la solicitud de eliminación.
              Respondemos en 10 días hábiles.
            </p>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Borrar toda una cuenta de Betsy</h3>
            <p>
              La persona dueña de la cuenta puede pedirlo a support@betsycrm.com desde el correo de la cuenta. Lo hacemos a
              mano dentro de 30 días (usuarios, clientes, pedidos, conversaciones, archivos y registros) y lo confirmamos por
              correo; las copias de seguridad se renuevan en 14 días más.
            </p>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Si sos cliente de un negocio que usa Betsy</h3>
            <p>
              Escribile primero al negocio, que es responsable de tus datos. También podés escribirnos a support@betsycrm.com
              y le ayudamos a atender tu solicitud.
            </p>
          </section>

          <section className="border-t pt-6" lang="en">
            <h2 className="text-xl font-semibold mb-3">English</h2>
            <ul className="list-disc ml-6 space-y-2">
              <li>
                <strong>Disconnect</strong> (in Betsy: Configuración › Cuentas conectadas → Desvincular, or by removing Betsy in your
                Facebook or Instagram settings): access tokens are deleted immediately and messages stop. Conversation history
                stays in the business&apos;s workspace.
              </li>
              <li>
                <strong>Delete</strong>: in Facebook (Settings &amp; privacy → Settings → Business integrations) or Instagram
                (Settings → Apps and websites), remove <strong>Betsy CRM</strong> and choose to delete your data. Meta notifies
                us; we delete the conversations, messages, files, ad referrals and AI records received through the Instagram or
                WhatsApp accounts you connected, disconnect them, and give you a confirmation code linking to this page. Backups
                roll over within 14 days.
              </li>
              <li>
                <strong>By email</strong>: write to support@betsycrm.com. We answer within 10 business days. A whole Betsy
                account is erased by hand within 30 days on the owner&apos;s request.
              </li>
            </ul>
            <p className="mt-3 text-sm">
              Full details:{' '}
              <Link href="/privacy#instagram-facebook" className="text-blue-600 hover:underline">
                Privacy Policy §8
              </Link>
              .
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <Link href="/" className="text-blue-600 hover:underline font-medium">
            ← Volver a Betsy CRM
          </Link>
        </div>
      </div>
    </div>
  )
}
