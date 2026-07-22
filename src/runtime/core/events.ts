import type { RuntimeEvent, RuntimeEventType } from './types'

type EventListener = (event: RuntimeEvent) => void

function id(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}

export class RuntimeEventBus {
  private sequence = 0
  private readonly listeners = new Set<EventListener>()
  private readonly history: RuntimeEvent[] = []

  emit(type: RuntimeEventType, payload: Record<string, unknown> = {}, context: Pick<RuntimeEvent, 'processId' | 'invocationId'> = {}): RuntimeEvent {
    const event: RuntimeEvent = {
      id: id('evt'),
      sequence: this.sequence++,
      timestamp: new Date().toISOString(),
      type,
      ...context,
      payload,
    }
    this.history.push(event)
    for (const listener of this.listeners) listener(event)
    return event
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  since(sequence = -1): RuntimeEvent[] {
    return this.history.filter((event) => event.sequence > sequence)
  }
}
