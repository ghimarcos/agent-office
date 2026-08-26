import { create } from 'zustand'
import type { OfficeState, WsMessage } from '@/types/state'

interface Store {
  sessions: OfficeState[]
  selectedId: string | null
  connected: boolean
  select: (id: string) => void
  connect: () => void
}

export const useOfficeStore = create<Store>((set, get) => ({
  sessions: [],
  selectedId: null,
  connected: false,

  select: (id) => set({ selectedId: id }),

  connect: () => {
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`
    let ws: WebSocket
    let retry: ReturnType<typeof setTimeout>

    const open = () => {
      ws = new WebSocket(url)

      ws.onopen = () => set({ connected: true })

      ws.onmessage = (ev) => {
        let msg: WsMessage
        try { msg = JSON.parse(ev.data) } catch { return }
        if (msg.type !== 'SNAPSHOT') return

        const { selectedId } = get()
        // Mantém a sessão escolhida se ela ainda existir; senão pega a primeira ocupada.
        const ainda = msg.sessions.some((s) => s.sessionId === selectedId)
        const proxima = msg.sessions.find((s) => s.status === 'running') ?? msg.sessions[0]
        set({
          sessions: msg.sessions,
          selectedId: ainda ? selectedId : (proxima?.sessionId ?? null),
        })
      }

      ws.onclose = () => {
        set({ connected: false })
        retry = setTimeout(open, 2000)
      }

      ws.onerror = () => ws.close()
    }

    open()
    return () => { clearTimeout(retry); ws?.close() }
  },
}))

export function sessaoAtual(): OfficeState | null {
  const { sessions, selectedId } = useOfficeStore.getState()
  return sessions.find((s) => s.sessionId === selectedId) ?? null
}
