/** Curated emoji set for the chat composer: [emoji, Spanish search keywords]. */
export type EmojiEntry = readonly [string, string]

export type EmojiCategory = { id: string; label: string; icon: string; emojis: readonly EmojiEntry[] }

export const EMOJI_CATEGORIES: readonly EmojiCategory[] = [
  {
    id: 'caras',
    label: 'Caras',
    icon: '😊',
    emojis: [
      ['😀', 'feliz sonrisa'], ['😃', 'feliz'], ['😄', 'risa feliz'], ['😁', 'sonrisa dientes'], ['😆', 'risa'],
      ['😅', 'nervios sudor risa'], ['🤣', 'carcajada'], ['😂', 'llorar risa jaja'], ['🙂', 'sonrisa leve'], ['😉', 'guiño'],
      ['😊', 'sonrojado feliz'], ['😇', 'angel'], ['🥰', 'amor corazones'], ['😍', 'enamorado'], ['🤩', 'estrellas wow'],
      ['😘', 'beso'], ['😗', 'beso'], ['☺️', 'sonrisa'], ['😚', 'beso'], ['😋', 'rico delicioso'],
      ['😛', 'lengua'], ['😜', 'guiño lengua'], ['🤪', 'loco'], ['😝', 'lengua'], ['🤑', 'dinero plata'],
      ['🤗', 'abrazo'], ['🤭', 'ups'], ['🤫', 'silencio'], ['🤔', 'pensar duda'], ['🤐', 'callado'],
      ['🤨', 'sospecha ceja'], ['😐', 'neutral'], ['😑', 'sin expresion'], ['😶', 'sin boca'], ['😏', 'picaro'],
      ['😒', 'aburrido'], ['🙄', 'ojos'], ['😬', 'mueca'], ['😌', 'aliviado'], ['😔', 'triste pensativo'],
      ['😪', 'sueño'], ['🤤', 'baba'], ['😴', 'dormir'], ['😷', 'mascarilla enfermo'], ['🤒', 'fiebre'],
      ['🥵', 'calor'], ['🥶', 'frio'], ['🥴', 'mareado'], ['😵', 'mareo'], ['🤯', 'explota mente'],
      ['🤠', 'vaquero'], ['🥳', 'fiesta celebrar'], ['😎', 'lentes cool'], ['🤓', 'nerd'], ['🧐', 'monoculo'],
      ['😕', 'confundido'], ['😟', 'preocupado'], ['🙁', 'triste'], ['☹️', 'triste'], ['😮', 'sorpresa'],
      ['😯', 'sorpresa'], ['😲', 'asombro'], ['😳', 'sonrojado'], ['🥺', 'por favor ojitos'], ['😦', 'preocupado'],
      ['😧', 'angustia'], ['😨', 'miedo'], ['😰', 'ansiedad'], ['😥', 'alivio triste'], ['😢', 'llorar'],
      ['😭', 'llorar mucho'], ['😱', 'grito miedo'], ['😖', 'frustrado'], ['😣', 'perseverar'], ['😞', 'decepcion'],
      ['😓', 'sudor'], ['😩', 'cansado'], ['😫', 'agotado'], ['🥱', 'bostezo'], ['😤', 'enojo'],
      ['😡', 'enojado'], ['😠', 'enojo'], ['🤬', 'insulto'], ['😈', 'diablo'], ['💀', 'calavera muerto'],
      ['💩', 'popo'], ['🤡', 'payaso'], ['👻', 'fantasma'], ['🙈', 'mono no ver'], ['🙏', 'gracias por favor rezar'],
    ],
  },
  {
    id: 'gestos',
    label: 'Gestos',
    icon: '👍',
    emojis: [
      ['👍', 'bien ok si like'], ['👎', 'mal no'], ['👌', 'ok perfecto'], ['🤌', 'italiano'], ['✌️', 'paz victoria'],
      ['🤞', 'suerte dedos'], ['🤟', 'te quiero'], ['🤘', 'rock'], ['🤙', 'llamame'], ['👈', 'izquierda'],
      ['👉', 'derecha'], ['👆', 'arriba'], ['👇', 'abajo'], ['☝️', 'uno arriba'], ['✋', 'mano alto'],
      ['🤚', 'mano'], ['🖐️', 'mano cinco'], ['👋', 'hola adios saludo'], ['🤝', 'trato acuerdo'], ['👏', 'aplausos'],
      ['🙌', 'celebrar manos'], ['👐', 'manos abiertas'], ['🤲', 'palmas'], ['💪', 'fuerza musculo'], ['✍️', 'escribir'],
      ['🫶', 'corazon manos'], ['🤷', 'no se'], ['🤦', 'facepalm'], ['🙋', 'levantar mano'], ['🙆', 'ok'],
      ['🙅', 'no'], ['💁', 'informacion'], ['🧏', 'sordo'], ['👀', 'ojos mirar'], ['🫡', 'saludo'],
    ],
  },
  {
    id: 'corazones',
    label: 'Corazones',
    icon: '❤️',
    emojis: [
      ['❤️', 'corazon amor rojo'], ['🧡', 'corazon naranja'], ['💛', 'corazon amarillo'], ['💚', 'corazon verde'],
      ['💙', 'corazon azul'], ['💜', 'corazon morado'], ['🖤', 'corazon negro'], ['🤍', 'corazon blanco'],
      ['🤎', 'corazon cafe'], ['💔', 'corazon roto'], ['❣️', 'corazon'], ['💕', 'corazones'], ['💞', 'corazones'],
      ['💓', 'latido'], ['💗', 'corazon creciente'], ['💖', 'corazon brillo'], ['💘', 'flechazo'], ['💝', 'regalo corazon'],
      ['💋', 'beso labios'], ['😻', 'gato enamorado'], ['🌹', 'rosa'], ['💐', 'ramo flores'], ['✨', 'brillo magia'],
      ['⭐', 'estrella'], ['🌟', 'estrella brillante'], ['💫', 'mareo estrella'], ['🔥', 'fuego top'], ['💯', 'cien perfecto'],
    ],
  },
  {
    id: 'ventas',
    label: 'Ventas',
    icon: '📦',
    emojis: [
      ['📦', 'paquete envio pedido'], ['🚚', 'camion envio entrega'], ['🛵', 'moto mensajero delivery'], ['📮', 'correo buzon'],
      ['✉️', 'sobre correo'], ['📬', 'buzon'], ['🏷️', 'etiqueta precio'], ['💰', 'dinero bolsa'], ['💵', 'billete'],
      ['💳', 'tarjeta pago'], ['🧾', 'recibo factura comprobante'], ['🏦', 'banco sinpe'], ['📲', 'celular sinpe'],
      ['📱', 'celular telefono'], ['☎️', 'telefono'], ['🛍️', 'bolsas compras'], ['🛒', 'carrito compra'], ['🎁', 'regalo'],
      ['🎉', 'fiesta celebrar'], ['🎊', 'confeti'], ['🎀', 'lazo'], ['📍', 'ubicacion direccion pin'], ['🗺️', 'mapa'],
      ['🏠', 'casa domicilio'], ['🏢', 'oficina'], ['⏰', 'reloj hora'], ['📅', 'calendario fecha'], ['🗓️', 'agenda'],
      ['⌛', 'espera'], ['⏳', 'esperando'], ['📝', 'nota'], ['📋', 'lista'], ['📌', 'fijar'], ['📎', 'clip adjunto'],
      ['📸', 'foto camara'], ['📷', 'camara'], ['🖼️', 'imagen'], ['🔗', 'enlace link'], ['📣', 'anuncio'],
      ['🆕', 'nuevo'], ['🆓', 'gratis'], ['🔝', 'top'], ['💎', 'diamante premium'], ['👕', 'camisa'], ['👗', 'vestido'],
      ['👟', 'tenis zapato'], ['👜', 'bolso'], ['🧴', 'crema'], ['💄', 'labial'], ['🛏️', 'cama'], ['😴', 'dormir'],
    ],
  },
  {
    id: 'simbolos',
    label: 'Símbolos',
    icon: '✅',
    emojis: [
      ['✅', 'listo check confirmado'], ['☑️', 'check'], ['✔️', 'check'], ['❌', 'no error'], ['❎', 'no'],
      ['⚠️', 'alerta cuidado'], ['❗', 'importante'], ['❓', 'pregunta'], ['‼️', 'importante'], ['⁉️', 'que'],
      ['🔴', 'rojo'], ['🟠', 'naranja'], ['🟡', 'amarillo'], ['🟢', 'verde'], ['🔵', 'azul'], ['🟣', 'morado'],
      ['⚫', 'negro'], ['⚪', 'blanco'], ['➡️', 'flecha derecha'], ['⬅️', 'flecha izquierda'], ['⬆️', 'arriba'],
      ['⬇️', 'abajo'], ['🔄', 'repetir'], ['🔁', 'repetir'], ['➕', 'mas'], ['➖', 'menos'], ['✖️', 'por'],
      ['💲', 'dolar precio'], ['©️', 'copyright'], ['🔒', 'seguro candado'], ['🔑', 'llave'], ['💡', 'idea'],
      ['🔔', 'campana aviso'], ['📢', 'altavoz'], ['🆗', 'ok'], ['🆘', 'ayuda sos'], ['ℹ️', 'informacion'],
      ['1️⃣', 'uno'], ['2️⃣', 'dos'], ['3️⃣', 'tres'], ['4️⃣', 'cuatro'], ['5️⃣', 'cinco'],
    ],
  },
  {
    id: 'naturaleza',
    label: 'Naturaleza y comida',
    icon: '🌿',
    emojis: [
      ['🌞', 'sol'], ['🌙', 'luna noche'], ['🌈', 'arcoiris'], ['☀️', 'sol'], ['🌧️', 'lluvia'], ['⛈️', 'tormenta'],
      ['🌊', 'ola mar'], ['🌴', 'palmera playa'], ['🌵', 'cactus'], ['🌸', 'flor'], ['🌻', 'girasol'], ['🌿', 'hoja planta'],
      ['🍀', 'trebol suerte'], ['🐶', 'perro'], ['🐱', 'gato'], ['🦋', 'mariposa'], ['🐝', 'abeja'], ['🦥', 'perezoso'],
      ['☕', 'cafe'], ['🍵', 'te'], ['🍰', 'pastel'], ['🎂', 'cumpleaños'], ['🍕', 'pizza'], ['🍔', 'hamburguesa'],
      ['🌮', 'taco'], ['🍓', 'fresa'], ['🍉', 'sandia'], ['🍌', 'banano'], ['🥑', 'aguacate'], ['🍺', 'cerveza'],
      ['🍷', 'vino'], ['🥂', 'brindis'], ['🇨🇷', 'costa rica bandera'], ['⚽', 'futbol'], ['🏆', 'trofeo ganador'],
    ],
  },
]

export const EMOJI_RECENT_KEY = 'betsy.chat.emojiRecent.v1'
export const EMOJI_RECENT_MAX = 24

export function searchEmojis(query: string, limit = 64): EmojiEntry[] {
  const q = query
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  if (!q) return []
  const out: EmojiEntry[] = []
  const seen = new Set<string>()
  for (const cat of EMOJI_CATEGORIES) {
    for (const entry of cat.emojis) {
      if (seen.has(entry[0])) continue
      if (entry[1].split(' ').some((w) => w.startsWith(q)) || entry[1].includes(q)) {
        out.push(entry)
        seen.add(entry[0])
        if (out.length >= limit) return out
      }
    }
  }
  return out
}

export function pushRecentEmoji(list: string[], emoji: string): string[] {
  return [emoji, ...list.filter((e) => e !== emoji)].slice(0, EMOJI_RECENT_MAX)
}
