/**
 * Self-hosted display fonts. Railway / Railpack builds must not call
 * fonts.googleapis.com via next/font/google (flaky null CSS parse).
 */

import localFont from 'next/font/local'

export const jakarta = localFont({
  src: [
    { path: './fonts/PlusJakartaSans-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/PlusJakartaSans-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/PlusJakartaSans-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/PlusJakartaSans-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-display',
  display: 'swap',
})

export const spaceGrotesk = localFont({
  src: [{ path: './fonts/SpaceGrotesk-700.woff2', weight: '700', style: 'normal' }],
  variable: '--font-logo',
  display: 'swap',
})

export const inter = localFont({
  src: [
    { path: './fonts/Inter-400.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Inter-500.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Inter-600.woff2', weight: '600', style: 'normal' },
    { path: './fonts/Inter-700.woff2', weight: '700', style: 'normal' },
  ],
  display: 'swap',
})
