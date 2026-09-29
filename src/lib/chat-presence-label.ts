/** Client-safe presence helpers (no store, no server imports). */
export type PresenceState = 'viewing' | 'typing'

/** "Ana está respondiendo…" / "Ana y Luis están viendo este chat". Empty when nobody else. */
export function presenceLabel(people: Array<{ name: string; state: PresenceState }>): string {
  if (!people.length) return ''
  const typing = people.filter((p) => p.state === 'typing')
  const names = (list: typeof people) =>
    list.length === 1 ? list[0].name : list.length === 2 ? `${list[0].name} y ${list[1].name}` : `${list[0].name} y ${list.length - 1} más`
  if (typing.length) return `${names(typing)} ${typing.length === 1 ? 'está' : 'están'} respondiendo…`
  return `${names(people)} ${people.length === 1 ? 'también está viendo' : 'también están viendo'} este chat`
}
