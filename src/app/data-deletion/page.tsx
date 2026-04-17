export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">
          Instrucciones para Eliminación de Datos
        </h1>
        
        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className="text-xl font-semibold mb-3">
              Cómo solicitar la eliminación de tus datos de Betsy CRM
            </h2>
            <p className="mb-4">
              Si has vinculado tu cuenta de Instagram o WhatsApp a Betsy CRM y deseas 
              eliminar tus datos, sigue estos pasos:
            </p>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Opción 1: Desde la aplicación</h3>
            <ol className="list-decimal list-inside space-y-2 ml-4">
              <li>Inicia sesión en tu cuenta de Betsy CRM</li>
              <li>Ve a <strong>Configuración → Cuentas Sociales</strong></li>
              <li>Haz clic en &quot;Desvincular&quot; en la cuenta que deseas eliminar</li>
              <li>Tus datos serán eliminados inmediatamente</li>
            </ol>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Opción 2: Contacto directo</h3>
            <p className="mb-2">
              Si no puedes acceder a tu cuenta, envía un correo a:
            </p>
            <p className="ml-4">
              <strong>Email:</strong>{' '}
              <a 
                href="mailto:support@betsycrm.com" 
                className="text-blue-600 hover:underline"
              >
                support@betsycrm.com
              </a>
            </p>
            <p className="ml-4 mt-2">
              Incluye en tu correo:
            </p>
            <ul className="list-disc list-inside ml-8 space-y-1">
              <li>Tu nombre de usuario o correo electrónico</li>
              <li>La cuenta de Instagram o WhatsApp que vinculaste</li>
              <li>Solicitud explícita de eliminación de datos</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">¿Qué datos eliminamos?</h3>
            <p className="mb-2">
              Cuando solicitas la eliminación, removemos:
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Información de tu cuenta vinculada (ID, tokens de acceso)</li>
              <li>Historial de mensajes enviados y recibidos</li>
              <li>Metadatos asociados a tus conversaciones</li>
            </ul>
          </section>

          <section>
            <h3 className="text-lg font-semibold mb-2">Tiempo de procesamiento</h3>
            <p>
              Las solicitudes de eliminación se procesan de forma inmediata. 
              Si solicitas la eliminación por correo, responderemos en un plazo 
              máximo de <strong>48 horas</strong>.
            </p>
          </section>

          <section className="border-t pt-6 mt-6">
            <p className="text-sm text-gray-600">
              <strong>Nota:</strong> Esta página cumple con los requisitos de las 
              Políticas de la Plataforma de Facebook para aplicaciones que acceden 
              a datos de usuarios de Instagram y WhatsApp.
            </p>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <a 
            href="/"
            className="text-blue-600 hover:underline font-medium"
          >
            ← Volver a Betsy CRM
          </a>
        </div>
      </div>
    </div>
  )
}
