'use client'

import { useEffect, useRef, useState } from 'react'
import { avatarInitials } from '@/lib/aurora-avatar'

type AuroraAvatarProps = {
  name: string
  /** Already validated http(s) URL (see `useAuroraViewer`); `null` renders the initials badge. */
  image?: string | null
  /** Size + text size, e.g. `h-8 w-8 text-[11px]`. */
  className?: string
}

/**
 * The signed-in user's avatar. Shows the provider photo (Google) when there is one and it loads;
 * otherwise (no photo or a load error) the gradient initials badge, so a broken image is never shown.
 * The photo is decorative: the name is always rendered next to it.
 */
export function AuroraAvatar({ name, image = null, className = 'h-8 w-8 text-[11px]' }: AuroraAvatarProps) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  useEffect(() => {
    setFailed(false)
    // A server-rendered <img> can fail before hydration, so React's onError never fires: check it once mounted.
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [image])

  if (image && !failed) {
    return (
      // Plain <img>: provider photos come from arbitrary hosts and must not go through the image optimizer.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={image}
        alt=""
        referrerPolicy="no-referrer"
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    )
  }
  return (
    <span
      aria-hidden
      className={`flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#5B6CFF] to-[#A855F7] font-bold text-white ${className}`}
    >
      {avatarInitials(name)}
    </span>
  )
}
