'use client'
import { SessionProvider as Provider } from "next-auth/react"

type Props = {
  children: React.ReactNode
}

export default function SessionProvider({ children }: Props) {
  return (
    <Provider refetchOnWindowFocus={false} refetchInterval={0}>
      {children}
    </Provider>
  )
}
