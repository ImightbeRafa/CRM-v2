import { POLICY_DATE_ES, POLICY_VERSION, PRIVACY_EMAIL, SUBPROCESSORS } from '@/lib/legal/privacy-content'

export const metadata = { title: 'Política de Privacidad — Betsy CRM' }

const h2 = 'text-xl font-semibold text-gray-900 mb-3'
const h3 = 'text-lg font-medium text-gray-900 mb-2 mt-4'
const ul = 'list-disc pl-6 space-y-2'

export default function PrivacidadPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto bg-white rounded-lg shadow-md p-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Política de Privacidad</h1>
        <p className="text-sm text-gray-500 mb-1">
          Versión {POLICY_VERSION} · Última actualización: {POLICY_DATE_ES}
        </p>
        <p className="text-sm text-gray-500 mb-6">
          <a href="/privacy" className="text-blue-600 hover:underline">Read in English</a>
        </p>

        <div className="space-y-6 text-gray-700">
          <section>
            <h2 className={h2}>1. Introducción y roles</h2>
            <p>
              Bienvenido a Betsy CRM («nosotros»). Nos comprometemos a proteger la información personal y su derecho a la
              privacidad. Esta política explica qué datos recopilamos, cómo los usamos, quién puede tratarlos y qué opciones tiene.
            </p>
            <ul className={`${ul} mt-2`}>
              <li>
                <strong>Datos de cuenta</strong> (las personas que inician sesión en Betsy CRM): Betsy CRM es la{' '}
                <em>responsable</em> de la base de datos.
              </li>
              <li>
                <strong>Datos del negocio</strong> (clientes del negocio, conversaciones, pedidos e inventario): el negocio es el{' '}
                <em>responsable</em> de la base de datos y Betsy CRM es su <em>encargada del tratamiento</em>. Tratamos esos datos
                únicamente según las instrucciones del negocio y nuestro acuerdo de tratamiento de datos.
              </li>
            </ul>
          </section>

          <section id="compromisos">
            <h2 className={h2}>2. Nuestros compromisos</h2>
            <ul className={ul}>
              <li><strong>No vendemos datos personales.</strong></li>
              <li>
                <strong>No usamos datos de clientes para entrenar ni mejorar modelos de inteligencia artificial</strong> —nuestros ni
                de terceros— y no permitimos que nuestros proveedores de IA lo hagan con los datos que les enviamos.
              </li>
              <li>
                <strong>No compartimos datos con terceros para sus propios fines.</strong> Solo los compartimos con los proveedores
                de la sección 6, estrictamente para operar el servicio y bajo obligaciones contractuales de confidencialidad y seguridad.
              </li>
              <li>
                Probamos y evaluamos nuestras funciones de IA con mensajes escritos por nuestro propio equipo o por el propio
                negocio, nunca con conversaciones reales de clientes.
              </li>
              <li>
                Trabajamos conforme a los estándares que nos aplican: la Ley N.º 8968 de Protección de la Persona frente al
                Tratamiento de sus Datos Personales y su Reglamento, los términos de las plataformas WhatsApp Business e Instagram
                de Meta y los principios del Reglamento General de Protección de Datos (GDPR) de la Unión Europea.
              </li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>3. Información que recopilamos</h2>
            <h3 className={h3}>3.1 Información que usted nos da</h3>
            <ul className={ul}>
              <li><strong>Cuenta:</strong> nombre, correo electrónico, usuario y contraseña</li>
              <li><strong>Datos del negocio:</strong> clientes, pedidos, inventario, facturas y otros datos que ingrese</li>
              <li><strong>Perfil:</strong> lo que usted decida agregar</li>
            </ul>
            <h3 className={h3}>3.2 Inicio de sesión con Google</h3>
            <p>
              Si inicia sesión con Google, recibimos su correo, nombre, foto de perfil y el identificador de su cuenta de Google.
              Solo accedemos al perfil básico: <strong>no</strong> accedemos a su Gmail, Drive, Calendario ni a otros servicios de Google.
            </p>
            <h3 className={h3}>3.3 Mensajes de los clientes de un negocio</h3>
            <p>
              Cuando un negocio conecta WhatsApp o Instagram, recibimos y guardamos las conversaciones entre el negocio y sus
              clientes (texto, nombre visible, identificadores de contacto y archivos) para que el negocio pueda gestionarlas. El
              negocio es responsable de informar a sus clientes y de contar con su permiso para escribirles.
            </p>
            <h3 className={h3}>3.4 Información automática</h3>
            <ul className={ul}>
              <li><strong>Uso:</strong> cómo interactúa con la plataforma</li>
              <li><strong>Dispositivo:</strong> navegador, sistema operativo, dirección IP</li>
              <li><strong>Cookies:</strong> para autenticación y manejo de la sesión</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>4. Cómo usamos la información</h2>
            <ul className={ul}>
              <li>Prestar y mantener el servicio y administrar las cuentas</li>
              <li>Procesar y guardar los datos del negocio (pedidos, clientes, inventario, conversaciones)</li>
              <li>Generar respuestas y sugerencias de IA, solo para negocios que lo autorizaron (sección 5)</li>
              <li>Enviar notificaciones del servicio</li>
              <li>Mejorar la confiabilidad y la usabilidad con estadísticas agregadas de uso, nunca con el contenido de los mensajes de clientes</li>
              <li>Garantizar la seguridad, prevenir fraude y abuso y cumplir obligaciones legales</li>
            </ul>
          </section>

          <section id="ia">
            <h2 className={h2}>5. Funciones de inteligencia artificial y su decisión</h2>
            <h3 className={h3}>5.1 Qué hacen</h3>
            <ul className={ul}>
              <li>
                <strong>Agentes de IA en el inbox:</strong> pueden redactar o enviar respuestas a los clientes de un negocio por
                WhatsApp e Instagram, en nombre del negocio. Los agentes nuevos empiezan en un modo en que una persona revisa las
                sugerencias; enviar sin revisión requiere una aprobación expresa del negocio.
              </li>
              <li><strong>Asistente interno y ayudantes del equipo:</strong> herramientas que usa el personal del propio negocio (por ejemplo un asistente por Telegram/WhatsApp y un ayudante para pegar datos de pedidos).</li>
            </ul>
            <h3 className={h3}>5.2 Autorización previa, por negocio</h3>
            <p>
              Los agentes de IA <strong>permanecen apagados hasta que el propietario o un administrador del negocio acepta los
              términos de IA</strong> dentro de Betsy CRM (Config → Agentes). Mientras tanto, los agentes de IA del inbox no funcionan y el ayudante de pegado de clientes de Ventas no usa IA, por lo que
              desde ellos no se envía ningún mensaje de clientes a un proveedor de IA. La aceptación registra quién aceptó, cuándo y qué versión, y{' '}
              <strong>puede revocarse en cualquier momento</strong>: los agentes dejan de responder y de sugerir de inmediato. Si
              cambiamos los términos de IA, el negocio debe aceptar la nueva versión.
            </p>
            <h3 className={h3}>5.3 Qué se envía al proveedor de IA</h3>
            <p>
              Solo lo necesario para redactar la respuesta: el texto del mensaje, el nombre visible del cliente, el contexto reciente
              de la conversación y, cuando corresponde, el estado de un pedido. Antes de enviar, los agentes enmascaran los números de tarjeta, de cuenta/IBAN/SINPE y de cédula que puedan detectar por patrón;
              además pedimos a los clientes no compartirlos, y no es posible garantizar la detección de todos los formatos. Las respuestas se generan con parámetros que piden al proveedor no almacenar la solicitud para
              uso propio.
            </p>
            <h3 className={h3}>5.4 Lo que los proveedores de IA pueden y no pueden hacer</h3>
            <ul className={ul}>
              <li>Tratan los datos únicamente para devolver la respuesta solicitada.</li>
              <li>No pueden entrenar ni mejorar sus modelos con ellos, según los términos que rigen nuestro uso de sus interfaces empresariales.</li>
              <li>Pueden conservar las solicitudes por un plazo limitado (hasta 30 días según sus términos publicados) solo por seguridad y prevención de abusos, salvo que aplique un acuerdo de retención cero.</li>
            </ul>
            <h3 className={h3}>5.5 Supervisión humana y seguridad</h3>
            <p>
              El personal puede revisar, editar o descartar sugerencias y marcar las respuestas como útiles o no. Las situaciones
              sensibles (pagos, reembolsos, solicitudes de hablar con una persona, fotos o notas de voz, y todo lo que el agente no
              pueda resolver con certeza) se pasan a una persona. La IA nunca confirma pagos ni toma decisiones jurídicas o
              financieras sobre las personas.
            </p>
            <h3 className={h3}>5.6 Informar a sus clientes</h3>
            <p>
              Los negocios deben informar a sus clientes que un asistente de inteligencia artificial puede atenderlos y que una
              persona puede intervenir. Redacción sugerida (el negocio puede editarla):
            </p>
            <blockquote className="border-l-4 pl-3 italic my-2">
              Este chat es atendido por un asistente de inteligencia artificial de [NOMBRE DEL NEGOCIO] que puede responderle de forma
              automática, y una persona de nuestro equipo puede intervenir cuando lo solicite. Sus mensajes se procesan con proveedores
              tecnológicos en el extranjero (por ejemplo, Estados Unidos) únicamente para responderle y gestionar su pedido; más
              información y sus derechos en [URL de la política] o en [correo del negocio]. Si prefiere hablar con una persona, escriba
              «agente».
            </blockquote>
            <p>
              El asistente interno del equipo (Telegram/WhatsApp) lo opera Betsy para el personal del negocio y usa un proveedor de IA
              (xAI) para entender mensajes del personal y textos de pedidos; no está cubierto por la autorización previa por negocio y
              se rige por esta política y los Términos.
            </p>
          </section>

          <section id="proveedores">
            <h2 className={h2}>6. Quién puede tratar los datos (proveedores)</h2>
            <p className="mb-3">
              No vendemos información personal. La compartimos únicamente con estos proveedores y solo para operar el servicio.
              Actualizaremos esta lista antes de incorporar un proveedor que trate datos de clientes y avisaremos con antelación a los negocios.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border border-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="p-2 border-b">Proveedor</th>
                    <th className="p-2 border-b">Finalidad</th>
                    <th className="p-2 border-b">Datos</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBPROCESSORS.map((p) => (
                    <tr key={p.name} className="align-top">
                      <td className="p-2 border-b font-medium">{p.name}</td>
                      <td className="p-2 border-b">{p.purposeEs}</td>
                      <td className="p-2 border-b">{p.dataEs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3">Otras comunicaciones: a su propio equipo (los datos que ingresa se comparten con los demás usuarios de su negocio), cuando la ley lo exija o para proteger derechos y seguridad, y en una fusión o venta de activos (con aviso).</p>
          </section>

          <section id="seguridad">
            <h2 className={h2}>7. Seguridad de los datos</h2>
            <ul className={ul}>
              <li>Las contraseñas se almacenan con algoritmos de resumen estándar de la industria; las conexiones usan HTTPS</li>
              <li>Los datos de cada negocio están aislados de los de los demás</li>
              <li>El acceso a la base de datos es restringido y monitoreado; las copias de seguridad se verifican con restauraciones de prueba</li>
              <li>Las acciones administrativas que afectan a los agentes (por ejemplo aprobaciones y frenos de emergencia) quedan auditadas</li>
              <li>Contamos con un interruptor de emergencia que detiene a todos los agentes de IA a la vez</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>8. Sus derechos y opciones</h2>
            <p className="mb-2">Usted tiene derecho a:</p>
            <ul className={ul}>
              <li><strong>Acceso:</strong> obtener una copia de sus datos personales</li>
              <li><strong>Rectificación:</strong> corregir información inexacta</li>
              <li><strong>Supresión:</strong> solicitar la eliminación de su cuenta y datos</li>
              <li><strong>Oposición y revocación del consentimiento</strong>, incluida la autorización de IA, sin efecto retroactivo</li>
              <li><strong>Portabilidad:</strong> recibir sus datos en un formato portable</li>
              <li><strong>Revocar el acceso de Google</strong> en cualquier momento desde su cuenta de Google</li>
            </ul>
            <p className="mt-3">
              Los clientes de un negocio deben dirigirse primero a ese negocio; nosotros le ayudamos a responder. Para ejercer sus
              derechos ante nosotros escriba a{' '}
              <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a>. En Costa Rica
              también puede acudir a la Agencia de Protección de Datos de los Habitantes (PRODHAB).
            </p>
          </section>

          <section id="instagram-facebook">
            <h2 className={h2}>9. Datos de Instagram, Facebook y WhatsApp</h2>
            <h3 className={h3}>9.1 Datos a los que accedemos</h3>
            <ul className={ul}>
              <li><strong>Cuenta de Instagram Business:</strong> identificador, nombre de usuario, información de perfil</li>
              <li><strong>Mensajes de Instagram:</strong> mensajes directos de su cuenta de negocio</li>
              <li><strong>Página de Facebook:</strong> identificador y tokens de acceso (requeridos por la API de Instagram)</li>
              <li><strong>WhatsApp Business:</strong> identificador del número, información de la cuenta y mensajes</li>
            </ul>
            <h3 className={h3}>9.2 Cómo usamos estos datos</h3>
            <ul className={ul}>
              <li>Mostrar y gestionar las conversaciones con clientes dentro de Betsy CRM</li>
              <li>Enviar respuestas en su nombre: su equipo, o un agente de IA solo si su negocio lo autorizó (sección 5)</li>
              <li>Vincular conversaciones con perfiles de clientes y pedidos</li>
              <li>Mostrar estadísticas de sus propias conversaciones</li>
            </ul>
            <h3 className={h3}>9.3 Conservación y eliminación</h3>
            <ul className={ul}>
              <li>Los mensajes se guardan mientras mantenga la conexión</li>
              <li>Puede desconectar en cualquier momento desde Configuración → Cuentas sociales; al desconectar eliminamos los tokens; el historial de mensajes permanece en la cuenta del negocio hasta que el negocio solicite eliminarlo o cierre su cuenta (entonces, dentro de 30 días)</li>
              <li>Puede solicitar la eliminación total escribiendo a <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a></li>
            </ul>
            <h3 className={h3}>9.4 Comunicación de datos</h3>
            <p>
              No vendemos ni compartimos datos de Instagram, Facebook o WhatsApp para fines ajenos, y jamás los usamos para entrenar
              modelos de IA. Son accesibles para usted, su equipo autorizado y los proveedores de la sección 6 (incluidos los de IA,
              solo si su negocio lo autorizó), únicamente para operar el servicio. La única otra excepción es la medición opcional
              de ventas por anuncios (9.5), que el negocio debe activar por sí mismo.
            </p>
            <h3 className={h3}>9.5 Medición de ventas por anuncios (opcional, apagada por defecto)</h3>
            <p>
              Cuando un cliente inicia una conversación de WhatsApp desde un anuncio de Meta, Meta incluye un identificador del clic
              en el mensaje. Betsy lo guarda con esa conversación para que el negocio vea qué anuncio trajo el chat.
            </p>
            <p className="mt-2">
              Si el propietario activa «Ventas por anuncios (Meta)» y acepta el aviso, Betsy informa a la cuenta de Meta del propio
              negocio, en su nombre, solo cuando un pedido de esa conversación se paga: el identificador del clic, el identificador
              de la cuenta de WhatsApp Business, el monto y la moneda. Betsy nunca envía nombres, teléfonos, correos ni contenido de
              mensajes para este fin. El negocio es responsable de estos datos y de informar a sus clientes; Betsy actúa como su
              encargada. Los identificadores se eliminan a los 90 días y el negocio puede desactivar la función cuando quiera.
            </p>
          </section>

          <section>
            <h2 className={h2}>10. Divulgación de Google OAuth</h2>
            <p>
              Usamos los datos de Google únicamente para autenticar su identidad y obtener su perfil básico (nombre, correo, foto).
              No accedemos a Gmail, Drive, Calendario ni a otros servicios. Puede revocar el acceso en{' '}
              <a href="https://myaccount.google.com/permissions" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">la página de permisos de su cuenta de Google</a>.
            </p>
          </section>

          <section id="conservacion">
            <h2 className={h2}>11. Plazos de conservación</h2>
            <ul className={ul}>
              <li><strong>Cuenta y datos del negocio:</strong> mientras la cuenta esté activa; al eliminarla borramos los datos personales en 30 días, salvo lo que la ley nos obligue a conservar</li>
              <li><strong>Mensajes de conversaciones:</strong> se conservan mientras la cuenta esté activa; se eliminan dentro de 30 días tras la solicitud de eliminación o el cierre de la cuenta del negocio</li>
              <li><strong>Texto de respuestas de IA y su traza técnica guardados para revisión:</strong> 90 días y luego se eliminan (se conservan conteos y costos para estadísticas)</li>
              <li><strong>Identificadores de clic de anuncios:</strong> 90 días</li>
              <li><strong>Copias de seguridad:</strong> se eliminan dentro de 90 días</li>
              <li><strong>Proveedores de IA:</strong> hasta 30 días para prevención de abusos, según sus términos, salvo retención cero</li>
            </ul>
          </section>

          <section>
            <h2 className={h2}>12. Transferencias internacionales</h2>
            <p>
              Nuestros proveedores (incluidos los de IA) pueden tratar datos fuera de Costa Rica, incluso en Estados Unidos. Exigimos
              medidas contractuales de confidencialidad y seguridad comparables a las que exigen la Ley 8968 y su Reglamento, e
              informamos a los negocios de estas transferencias para que puedan informar a sus clientes.
            </p>
          </section>

          <section>
            <h2 className={h2}>13. Privacidad de menores</h2>
            <p>Nuestro servicio no está dirigido a menores de 13 años y no recopilamos a sabiendas su información. Si cree que un menor nos dio datos personales, escríbanos de inmediato.</p>
          </section>

          <section>
            <h2 className={h2}>14. Cambios a esta política</h2>
            <p>
              Podemos actualizar esta política. Le avisaremos de los cambios importantes por correo o en la plataforma, y los cambios a
              los términos de IA exigen que cada negocio acepte la nueva versión para que sus agentes sigan funcionando. La versión y
              la fecha al inicio identifican el texto vigente.
            </p>
          </section>

          <section>
            <h2 className={h2}>15. Contacto</h2>
            <ul className="list-none space-y-2">
              <li><strong>Correo:</strong> <a href={`mailto:${PRIVACY_EMAIL}`} className="text-blue-600 hover:underline">{PRIVACY_EMAIL}</a></li>
              <li><strong>Sitio web:</strong> <a href="https://www.betsycrm.com" className="text-blue-600 hover:underline">www.betsycrm.com</a></li>
            </ul>
          </section>

          <section id="gdpr" className="border-t pt-6 mt-8">
            <h2 className={h2}>GDPR (usuarios de la UE)</h2>
            <p>Si usted se encuentra en el Espacio Económico Europeo, también tiene estos derechos bajo el GDPR:</p>
            <ul className={`${ul} mt-2`}>
              <li><strong>Base legal:</strong> ejecución del contrato e intereses legítimos; consentimiento donde lo pedimos (por ejemplo la autorización de IA)</li>
              <li><strong>Roles:</strong> Betsy CRM es responsable de los datos de cuenta y encargada de los datos de clientes de un negocio</li>
              <li><strong>Derecho a presentar una queja</strong> ante su autoridad local de protección de datos</li>
              <li><strong>Portabilidad</strong> en un formato estructurado y legible por máquina</li>
            </ul>
          </section>
        </div>

        <div className="mt-8 pt-6 border-t">
          <a href="/dashboard" className="text-blue-600 hover:underline">← Volver al inicio</a>
        </div>
      </div>
      <footer className="mt-8 text-center text-gray-500 text-sm">
        © {new Date().getFullYear()} Rafael Garcia Montoya. Todos los derechos reservados.
      </footer>
    </div>
  )
}
