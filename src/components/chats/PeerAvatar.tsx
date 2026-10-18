'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Customer photo in the inbox (Instagram): our own `/api/chat/conversations/<id>/avatar` route only. Without a
 * photo, or when it fails to load, the existing initials badge (`children`) is shown instead.
 */
export function PeerAvatar({ src, className, children }: { src?: string | null; className: string; children: ReactNode }) {
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  // Only same-origin paths: never a third-party link from data.
  const safe = typeof src === 'string' && src.startsWith('/api/chat/conversations/') ? src : null
  useEffect(() => {
    setFailed(false)
    const img = imgRef.current
    if (img && img.complete && img.naturalWidth === 0) setFailed(true)
  }, [safe])

  if (safe && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        ref={imgRef}
        src={safe}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${className} object-cover`}
      />
    )
  }
  return <div className={className}>{children}</div>
}
