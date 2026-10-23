import { permanentRedirect } from 'next/navigation'

/** The v2 landing preview became /home (Rafael, 2026-10-23). Old preview links keep working. */
export default function HomePreview() {
  permanentRedirect('/home')
}
