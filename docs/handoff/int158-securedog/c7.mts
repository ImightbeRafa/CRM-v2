import { run } from './runner.mts'
run({
  'N benign lines vs new branches (false positives?)': [
    'Ya te envié los datos de pago arriba 👆', 'Ya te mandé la info del combo', 'Ya te mandé el link del producto', 'Ya le mandé tu consulta al equipo',
    'Si tu pago está aprobado por el banco, el equipo te avisa.', 'Te confirmo el precio: ₡22 800 con envío.', 'Te confirmo que hacemos envíos a todo el país.',
    'Registré tu consulta, el equipo te escribe.', 'Cuando el equipo verifique el comprobante te aviso.',
  ],
})
