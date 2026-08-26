import { create } from 'zustand'
import type { OfficeState, EntradaTranscript } from '@/types/state'

interface Store {
  sessions: OfficeState[]
  selectedId: string | null
  connected: boolean
  transcript: { agentId: string; nome: string; entradas: EntradaTranscript[] } | null
  carregandoTranscript: boolean

  select: (id: string) => void
  connect: () => void
  abrirTranscript: (agentId: string, nome: string, silencioso?: boolean) => void
  fecharTranscript: () => void
}

let ws: WebSocket | null = null
/**
 * A conexão vive fora do ciclo do React. Em StrictMode o efeito monta, limpa e
 * monta de novo; fechar o socket na limpeza disparava o `onclose`, que agendava
 * uma reconexão — e aí sobravam dois sockets entregando cada mensagem duas vezes.
 */
let conexaoIniciada = false

const enviarWs = (msg: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

export const useOfficeStore = create<Store>((set, get) => ({
  sessions: [],
  selectedId: null,
  connected: false,
  transcript: null,
  carregandoTranscript: false,

  select: (id) => set({ selectedId: id }),

  connect: () => {
    if (conexaoIniciada) return
    conexaoIniciada = true
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

    const open = () => {
      ws = new WebSocket(url)
      ws.onopen = () => set({ connected: true })

      ws.onmessage = (ev) => {
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }

        if (msg.type === 'SNAPSHOT') {
          const { selectedId } = get()
          const ainda = msg.sessions.some((s: OfficeState) => s.sessionId === selectedId)
          // Sem escolha sua, o painel segue quem está trabalhando agora.
          const proxima = msg.sessions.find((s: OfficeState) => s.status === 'running') ?? msg.sessions[0]
          set({ sessions: msg.sessions, selectedId: ainda ? selectedId : (proxima?.sessionId ?? null) })
          return
        }

        if (msg.type === 'TRANSCRIPT') {
          const atual = get().transcript
          if (!atual || atual.agentId !== msg.agentId) return
          set({ transcript: { ...atual, entradas: msg.entradas ?? [] }, carregandoTranscript: false })
        }
      }

      ws.onclose = () => { set({ connected: false }); setTimeout(open, 2000) }
      ws.onerror = () => ws?.close()
    }

    open()
    // Sem cleanup de propósito: o socket acompanha a página, não o componente.
  },

  abrirTranscript: (agentId, nome, silencioso = false) => {
    // O refresh periódico é silencioso: esvaziar a lista para recarregar
    // desmontava os itens e jogava o scroll de volta pro topo.
    if (!silencioso || get().transcript?.agentId !== agentId) {
      set({ transcript: { agentId, nome, entradas: [] }, carregandoTranscript: true })
    }
    enviarWs({ type: 'TRANSCRIPT', agentId })
  },

  fecharTranscript: () => set({ transcript: null }),
}))
