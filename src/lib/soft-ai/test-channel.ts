/**
 * Probar channel picker. Never invents a "ninguno" label.
 */

export type TestChannelOption = {
  id: string
  platform: string
  attendedByThisAgent: boolean
  label: string
}

export type TestChannelSelection = {
  selectedId: string | null
  mode: 'selected' | 'pick' | 'empty'
  options: TestChannelOption[]
}

function whatsappChannels(channels: TestChannelOption[]): TestChannelOption[] {
  return channels.filter((row) => row.platform.toLowerCase() === 'whatsapp' && row.id.trim())
}

/**
 * Keep a still-valid pick. One WhatsApp binding selects itself.
 * Several bindings open a picker. None means the composer stays hidden.
 */
export function selectWhatsappTestChannel(
  channels: TestChannelOption[],
  currentId: string | null,
): TestChannelSelection {
  const wa = whatsappChannels(channels)
  const options = wa.filter((row) => row.attendedByThisAgent)
  if (options.length === 0) {
    return { selectedId: null, mode: 'empty', options: [] }
  }
  if (currentId && options.some((row) => row.id === currentId)) {
    return { selectedId: currentId, mode: 'selected', options }
  }
  if (options.length === 1) {
    return { selectedId: options[0].id, mode: 'selected', options }
  }
  return { selectedId: null, mode: 'pick', options }
}
