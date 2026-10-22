/**
 * Static product illustrations for the landing (plain HTML/CSS, no images, no client JS).
 * They mirror the real screens (Chats bandeja, pedido stages, agent hand-off) with made-up example data.
 */

const WA = 'bg-[#25d366]';
const IG = 'bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]';

function ChannelDot({ channel }: { channel: 'wa' | 'ig' }) {
  return (
    <span
      aria-hidden
      className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${channel === 'wa' ? WA : IG}`}
    />
  );
}

const CHATS: Array<{ initials: string; name: string; text: string; time: string; channel: 'wa' | 'ig'; tag: string; tagClass: string; active?: boolean }> = [
  { initials: 'DR', name: 'Daniela R.', text: '¿Tienen la talla M en negro?', time: '2 min', channel: 'ig', tag: 'IA', tagClass: 'bg-[#eef0ff] text-[#4b55d6]', active: true },
  { initials: 'CM', name: 'Carlos M.', text: 'Listo, ya hice el SINPE 🙌', time: '6 min', channel: 'wa', tag: 'Revisar pago', tagClass: 'bg-[#fdecef] text-[#c0344d]' },
  { initials: 'AV', name: 'Andrea V.', text: '¿Hacen envíos a Liberia?', time: '14 min', channel: 'wa', tag: 'Persona', tagClass: 'bg-[#f3eefe] text-[#6d3fd1]' },
  { initials: 'JS', name: 'José S.', text: 'Gracias, me llegó perfecto', time: '1 h', channel: 'ig', tag: 'Pedido', tagClass: 'bg-[#fff3e6] text-[#b4610f]' },
];

export function InboxMock() {
  return (
    <figure className="overflow-hidden rounded-[22px] border border-[#14131a]/10 bg-white shadow-[0_30px_80px_-30px_rgba(20,19,26,0.35)]">
      <div className="flex items-center gap-1.5 border-b border-[#14131a]/[0.07] px-4 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#14131a]/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#14131a]/10" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#14131a]/10" />
        <span className="ml-3 text-[12px] font-medium text-[#14131a]/65">Chats · Bandeja unificada</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="border-[#14131a]/[0.07] sm:border-r">
          <div className="flex flex-wrap gap-1.5 px-4 pb-2 pt-3">
            {[
              ['Bandeja', 'bg-[#14131a] text-white'],
              ['Persona', 'bg-[#f3eefe] text-[#6d3fd1]'],
              ['Revisar pago', 'bg-[#fdecef] text-[#c0344d]'],
              ['Pedido', 'bg-[#fff3e6] text-[#b4610f]'],
              ['IA', 'bg-[#eef0ff] text-[#4b55d6]'],
            ].map(([label, cls]) => (
              <span key={label} className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${cls}`}>
                {label}
              </span>
            ))}
          </div>
          <ul>
            {CHATS.map((c) => (
              <li
                key={c.name}
                className={`flex items-start gap-3 px-4 py-3 ${c.active ? 'bg-[#f6f4ef]' : ''}`}
              >
                <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e9e6dd] text-[12px] font-semibold text-[#14131a]/70">
                  {c.initials}
                  <ChannelDot channel={c.channel} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-semibold text-[#14131a]">{c.name}</span>
                    <span className="shrink-0 text-[11px] text-[#14131a]/65">{c.time}</span>
                  </span>
                  <span className="block truncate text-[12px] text-[#14131a]/65">{c.text}</span>
                  <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.tagClass}`}>{c.tag}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="hidden flex-col bg-[#fbfaf7] sm:flex">
          <div className="border-b border-[#14131a]/[0.07] px-4 py-3">
            <p className="text-[13px] font-semibold text-[#14131a]">Daniela R.</p>
            <p className="text-[11px] text-[#14131a]/65">Instagram · Agente de ventas</p>
          </div>
          <div className="flex flex-1 flex-col gap-2 px-4 py-4">
            <p className="max-w-[80%] self-start rounded-2xl rounded-bl-md border border-[#14131a]/[0.07] bg-white px-3 py-2 text-[12px] text-[#14131a]">
              ¿Tienen la talla M en negro?
            </p>
            <p className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-[#eef0ff] px-3 py-2 text-[12px] text-[#14131a]">
              ¡Hola Daniela! Sí, la M en negro está disponible 😊
            </p>
            <p className="max-w-[80%] self-end rounded-2xl rounded-br-md bg-[#eef0ff] px-3 py-2 text-[12px] text-[#14131a]">
              ¿Te la enviamos por Correos o preferís mensajería?
            </p>
          </div>
          <div className="mx-4 mb-4 flex items-center justify-between rounded-full border border-[#14131a]/10 bg-white px-3 py-1.5 text-[11px]">
            <span className="flex items-center gap-1.5 font-medium text-[#14131a]/70">
              <span className="h-1.5 w-1.5 rounded-full bg-[#22a06b]" /> IA activa
            </span>
            <span className="font-semibold text-[#4b55d6]">Tomar control</span>
          </div>
        </div>
      </div>
      <figcaption className="sr-only">Ejemplo de la bandeja de chats de Betsy con conversaciones de WhatsApp e Instagram.</figcaption>
    </figure>
  );
}

const STAGES: Array<{ name: string; items: Array<{ id: string; who: string; how: string }> }> = [
  { name: 'Venta', items: [{ id: '#2041', who: 'Andrea V.', how: 'SINPE · pendiente' }] },
  { name: 'Producción', items: [{ id: '#2038', who: 'Carlos M.', how: 'Empacando' }, { id: '#2036', who: 'Luis P.', how: 'Personalizado' }] },
  { name: 'Envío', items: [{ id: '#2033', who: 'José S.', how: 'Correos de CR' }, { id: '#2031', who: 'María F.', how: 'Contra entrega' }] },
];

export function PipelineMock() {
  return (
    <figure className="rounded-[22px] border border-[#14131a]/10 bg-white p-4 shadow-[0_30px_80px_-30px_rgba(20,19,26,0.3)] sm:p-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STAGES.map((stage) => (
          <div key={stage.name} className="rounded-2xl bg-[#f6f4ef] p-3">
            <p className="mb-2 flex items-center justify-between text-[12px] font-semibold text-[#14131a]">
              {stage.name}
              <span className="rounded-full bg-white px-2 text-[11px] font-medium text-[#14131a]/65">{stage.items.length}</span>
            </p>
            <ul className="space-y-2">
              {stage.items.map((it) => (
                <li key={it.id} className="rounded-xl border border-[#14131a]/[0.07] bg-white px-3 py-2">
                  <span className="flex items-baseline justify-between text-[12px]">
                    <span className="font-semibold text-[#14131a]">{it.who}</span>
                    <span className="text-[11px] text-[#14131a]/65">{it.id}</span>
                  </span>
                  <span className="text-[11px] text-[#14131a]/65">{it.how}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <figcaption className="sr-only">Ejemplo de pedidos avanzando de venta a producción y envío.</figcaption>
    </figure>
  );
}
