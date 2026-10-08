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

/** Channels an agent can answer (and be tested / activated on): WhatsApp and Instagram (F1). */
function whatsappChannels(channels: TestChannelOption[]): TestChannelOption[] {
  return channels.filter((row) => {
    const platform = row.platform.toLowerCase()
    return (platform === 'whatsapp' || platform === 'instagram') && row.id.trim()
  })
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
