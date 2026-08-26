import { create } from 'zustand'
import type { OfficeState, EntradaTranscript } from '@/types/state'

export interface Bloco {
  id: string
  autor: 'voce' | 'claude' | 'sistema'
  tipo: 'texto' | 'pensando' | 'ferramenta' | 'erro' | 'permissao'
  texto: string
  detalhe?: string
  permissao?: { id: string; ferramenta: string; alvo: string; regra: string }
  resolvida?: string
}

interface Projeto { chave: string; nome: string }

interface Store {
  sessions: OfficeState[]
  selectedId: string | null
  connected: boolean
  projetos: Projeto[]

  /** Conversa, estado e sessão são guardados POR projeto: trocar de projeto no
   *  painel não pode apagar o que o time estava fazendo no anterior. */
  chaveAtiva: string | null
  blocosPorProjeto: Record<string, Bloco[]>
  pensandoPorProjeto: Record<string, boolean>
  sessaoPorProjeto: Record<string, string>
  nomePorProjeto: Record<string, string>

  escolhaManual: boolean
  transcript: { agentId: string; nome: string; entradas: EntradaTranscript[] } | null
  carregandoTranscript: boolean

  select: (id: string) => void
  connect: () => void
  enviar: (texto: string) => void
  escolherProjeto: (chave: string) => void
  responderPermissao: (blocoId: string, id: string, acao: 'aprovar' | 'aprovar_sempre' | 'recusar') => void
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
let seq = 0
const novoId = () => `b${++seq}`

const enviarWs = (msg: unknown) => {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

/** Anexa um bloco à conversa do projeto dono do evento. */
const anexar = (mapa: Record<string, Bloco[]>, chave: string, bloco: Bloco) => ({
  ...mapa,
  [chave]: [...(mapa[chave] ?? []), bloco],
})

export const useOfficeStore = create<Store>((set, get) => ({
  sessions: [],
  selectedId: null,
  connected: false,
  projetos: [],
  chaveAtiva: null,
  blocosPorProjeto: {},
  pensandoPorProjeto: {},
  sessaoPorProjeto: {},
  nomePorProjeto: {},
  escolhaManual: false,
  transcript: null,
  carregandoTranscript: false,

  select: (id) => set({ selectedId: id, escolhaManual: true }),

  connect: () => {
    if (conexaoIniciada) return
    conexaoIniciada = true
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`

    const open = () => {
      ws = new WebSocket(url)

      ws.onopen = () => {
        set({ connected: true })
        enviarWs({ type: 'PROJETOS' })
      }

      ws.onmessage = (ev) => {
        let msg: any
        try { msg = JSON.parse(ev.data) } catch { return }

        if (msg.type === 'SNAPSHOT') {
          const { selectedId, chaveAtiva, sessaoPorProjeto, escolhaManual } = get()
          const doChat = chaveAtiva ? sessaoPorProjeto[chaveAtiva] : null
          // A sessão do chat manda — a não ser que você tenha escolhido uma aba
          // na mão, senão a escolha era desfeita a cada atualização.
          const seguir = !escolhaManual && doChat
            && msg.sessions.some((s: OfficeState) => s.sessionId === doChat) ? doChat : null
          const ainda = msg.sessions.some((s: OfficeState) => s.sessionId === selectedId)
          const proxima = msg.sessions.find((s: OfficeState) => s.status === 'running') ?? msg.sessions[0]
          set({
            sessions: msg.sessions,
            selectedId: seguir ?? (ainda ? selectedId : (proxima?.sessionId ?? null)),
          })
          return
        }

        if (msg.type === 'PROJETOS') { set({ projetos: msg.lista ?? [] }); return }

        if (msg.type === 'TRANSCRIPT') {
          const atual = get().transcript
          if (!atual || atual.agentId !== msg.agentId) return
          set({ transcript: { ...atual, entradas: msg.entradas ?? [] }, carregandoTranscript: false })
          return
        }

        if (msg.type !== 'CHAT') return
        const e = msg.evento
        const chave: string = e.chave
        if (!chave) return

        if (e.kind === 'inicio') {
          set((st) => ({
            nomePorProjeto: { ...st.nomePorProjeto, [chave]: e.projeto },
            sessaoPorProjeto: e.sessionId
              ? { ...st.sessaoPorProjeto, [chave]: e.sessionId }
              : st.sessaoPorProjeto,
            escolhaManual: false,
            pensandoPorProjeto: { ...st.pensandoPorProjeto, [chave]: false },
            // Retomada não repete o aviso de abertura.
            blocosPorProjeto: e.retomado && st.blocosPorProjeto[chave]?.length
              ? st.blocosPorProjeto
              : anexar(st.blocosPorProjeto, chave, {
                  id: novoId(), autor: 'sistema', tipo: 'texto',
                  texto: `Orquestrador aberto em ${e.projeto}.`,
                }),
          }))
          return
        }

        if (e.kind === 'fim') {
          set((st) => ({ pensandoPorProjeto: { ...st.pensandoPorProjeto, [chave]: false } }))
          return
        }

        const bloco: Bloco =
          e.kind === 'permissao'
            ? { id: novoId(), autor: 'claude', tipo: 'permissao', texto: e.ferramenta, detalhe: e.alvo,
                permissao: { id: e.id, ferramenta: e.ferramenta, alvo: e.alvo, regra: e.regra } }
            : e.kind === 'ferramenta'
              ? { id: novoId(), autor: 'claude', tipo: 'ferramenta', texto: e.nome, detalhe: e.detalhe }
              : e.kind === 'pensando'
                ? { id: novoId(), autor: 'claude', tipo: 'pensando', texto: e.texto }
                : e.kind === 'erro'
                  ? { id: novoId(), autor: 'sistema', tipo: 'erro', texto: e.texto }
                  : { id: novoId(), autor: 'claude', tipo: 'texto', texto: e.texto }

        set((st) => ({ blocosPorProjeto: anexar(st.blocosPorProjeto, chave, bloco) }))
      }

      ws.onclose = () => { set({ connected: false }); setTimeout(open, 2000) }
      ws.onerror = () => ws?.close()
    }

    open()
    // Sem cleanup de propósito: o socket acompanha a página, não o componente.
  },

  enviar: (texto) => {
    const chave = get().chaveAtiva
    if (!chave) return
    set((st) => ({
      pensandoPorProjeto: { ...st.pensandoPorProjeto, [chave]: true },
      blocosPorProjeto: anexar(st.blocosPorProjeto, chave, {
        id: novoId(), autor: 'voce', tipo: 'texto', texto,
      }),
    }))
    enviarWs({ type: 'CHAT_ENVIAR', chave, texto })
  },

  /** Só troca a conversa visível. O projeto anterior segue trabalhando. */
  escolherProjeto: (chave) => {
    set({ chaveAtiva: chave, escolhaManual: false })
    enviarWs({ type: 'CHAT_PROJETO', chave })
  },

  responderPermissao: (blocoId, id, acao) => {
    const chave = get().chaveAtiva
    if (!chave) return
    set((st) => ({
      pensandoPorProjeto: { ...st.pensandoPorProjeto, [chave]: acao !== 'recusar' },
      blocosPorProjeto: {
        ...st.blocosPorProjeto,
        [chave]: (st.blocosPorProjeto[chave] ?? []).map((b) =>
          b.id === blocoId
            ? { ...b, resolvida: acao === 'recusar' ? 'recusada' : acao === 'aprovar_sempre' ? 'sempre' : 'aprovada' }
            : b),
      },
    }))
    enviarWs({ type: 'PERMISSAO', chave, id, acao })
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
