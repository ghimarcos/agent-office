// Estado do escritório — derivado das fontes locais do Claude Code.

export type AgentStatus = 'idle' | 'working' | 'done' | 'checkpoint' | 'delivering'

/** Um especialista do time, com o que ele está fazendo agora. */
export interface OfficeAgent {
  id: string
  /** 'orquestrador' | 'arquiteto' | 'dev' | 'qa' | qualquer outro agentType */
  role: string
  name: string
  status: AgentStatus
  gender?: 'male' | 'female'
  desk: { col: number; row: number }
  /** Ferramenta em uso agora: Edit, Bash, Read... */
  tool?: string
  /** Alvo da ferramenta: nome do arquivo, descrição do comando... */
  detail?: string
  /** ISO da última atividade — a UI calcula o tempo decorrido a partir daqui. */
  since?: string
  /** O que foi delegado a este especialista. */
  description?: string
  /** Id do arquivo de transcript do subagent — usado ao clicar no bonequino. */
  agentId?: string
}

export interface OfficeTask {
  id: string
  subject: string
  status: string
}

export interface OfficeService {
  label: string
  port: number
  up: boolean
}

export interface OfficeState {
  sessionId: string
  /** Nome curto do projeto — basename do cwd. */
  project: string
  cwd: string
  branch: string | null
  status: 'idle' | 'running'
  agents: OfficeAgent[]
  tasks: OfficeTask[]
  /** Serviços do projeto e se a porta está no ar. */
  services: OfficeService[]
  updatedAt: string
}

export type WsMessage = { type: 'SNAPSHOT'; sessions: OfficeState[] }

/** Uma entrada do transcript de um especialista, para o painel de inspeção. */
export interface EntradaTranscript {
  tipo: 'prompt' | 'pensando' | 'texto' | 'ferramenta' | 'resultado'
  texto: string
  detalhe?: string
  at?: string
}
