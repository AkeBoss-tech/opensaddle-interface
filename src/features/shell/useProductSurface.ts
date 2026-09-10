import {useEffect, useState} from 'react'
import type { ServiceBundle } from '../../services'
import { usesConnectedProductSurface } from '../../services'

// Retain only a layout decision, never service clients or execution authority.
export function useProductSurface(services: ServiceBundle | null, connectionKey: string): boolean {
  const available = usesConnectedProductSurface(services)
  const negotiated = services?.controlPlane.connected === true
  const [established, setEstablished] = useState<string | null>(null)
  useEffect(() => {
    setEstablished(previous => available ? connectionKey : negotiated ? null : previous === connectionKey ? previous : null)
  }, [available, negotiated, connectionKey])
  return available || (!negotiated && established === connectionKey)
}
