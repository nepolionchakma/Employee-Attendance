// @ts-nocheck
'use client'

import LocationGate from '@/app/components/LocationGate'

export default function LoginGate({ children }: { children: React.ReactNode }) {
  return <LocationGate>{children}</LocationGate>
}
