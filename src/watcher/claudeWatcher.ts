/**
 * Plugin Vite que lê o estado do time direto das fontes locais do Claude Code
 * e empurra snapshots pelo WebSocket.
 *
 * Três fontes, todas em ~/.claude:
 *   1. `claude agents --json --all`                          → sessões vivas
 *   2. projects/<slug>/<sessionId>/subagents/*.meta.json      → papel de cada especialista
 *      + o .jsonl irmão                                      → o que ele está fazendo agora
 *   3. tasks/<sessionId>/*.json                               → lista de tarefas da demanda
 */
import type { Plugin, ViteDevServer } from 'vite'
import { WebSocketServer, WebSocket } from 'ws'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import readline from 'node:readline'
import type { OfficeAgent, OfficeState, OfficeTask, OfficeService, AgentStatus, EntradaTranscript } from '../types/state'
import { type EventoChat } from './orquestrador'
import { Gerente } from './gerente'

const CLAUDE_HOME = path.join(os.homedir(), '.claude')
const POLL_MS = 1500
/** Transcript tocado há menos que isso = especialista trabalhando agora. */
const ACTIVE_MS = 25_000
/** Só lemos o fim do transcript — eles passam de 800KB. */
const TAIL_BYTES = 64 * 1024

/** Papéis fixos do time, na ordem em que sentam no escritório. */
const ROLES: { role: string; name: string; gender: 'male' | 'female' }[] = [
  { role: 'orquestrador', name: 'Orquestrador', gender: 'male' },
  { role: 'arquiteto', name: 'Arquiteto', gender: 'female' },
  { role: 'dev', name: 'Dev', gender: 'male' },
  { role: 'qa', name: 'QA', gender: 'female' },
]

// ---------------------------------------------------------------- utilidades

function sh(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : stdout)
    })
  })
}

/** Lê só o fim do arquivo e devolve as linhas JSON completas. */
async function tailJsonl(file: string): Promise<any[]> {
  let fd: fsp.FileHandle | undefined
  try {
    const stat = await fsp.stat(file)
    fd = await fsp.open(file, 'r')
    const start = Math.max(0, stat.size - TAIL_BYTES)
    const len = stat.size - start
    const buf = Buffer.alloc(len)
    await fd.read(buf, 0, len, start)
    let text = buf.toString('utf8')
    // Se cortamos no meio de uma linha, descarta o pedaço inicial quebrado.
    if (start > 0) text = text.slice(text.indexOf('\n') + 1)
    return text
      .split('\n')
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch {
    return []
  } finally {
    await fd?.close().catch(() => {})
  }
}

/** Resume o que a ferramenta está fazendo, em uma linha legível. */
function describeTool(name: string, input: any): { tool: string; detail: string } {
  const base = (p?: string) => (p ? path.basename(p) : '')
  if (name === 'Read' || name === 'Edit' || name === 'Write') {
    return { tool: name, detail: base(input?.file_path) }
  }
  if (name === 'Bash') {
    const d = input?.description || String(input?.command || '').slice(0, 32)
    return { tool: 'Bash', detail: d }
  }
  if (name === 'Grep' || name === 'Glob') {
    return { tool: name, detail: String(input?.pattern || '').slice(0, 32) }
  }
  if (name === 'Agent') {
    return { tool: 'Delega', detail: String(input?.subagent_type || '') }
  }
  if (name.startsWith('mcp__claude-in-chrome__')) {
    return { tool: 'Chrome', detail: name.replace('mcp__claude-in-chrome__', '') }
  }
  return { tool: name, detail: '' }
}

/** Última chamada de ferramenta encontrada no transcript. */
function lastToolUse(lines: any[]): { tool: string; detail: string; at: string } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const j = lines[i]
    if (j?.type !== 'assistant') continue
    const content = j.message?.content
    if (!Array.isArray(content)) continue
    for (let k = content.length - 1; k >= 0; k--) {
      const c = content[k]
      if (c?.type === 'tool_use') {
        const { tool, detail } = describeTool(c.name, c.input)
        return { tool, detail, at: j.timestamp }
      }
    }
  }
  return null
}

/** Terminou = a última fala do agente foi texto, sem chamar mais ferramenta. */
function endedWithText(lines: any[]): boolean {
  for (let i = lines.length - 1; i >= 0; i--) {
    const j = lines[i]
    if (j?.type !== 'assistant') continue
    const content = j.message?.content
    if (!Array.isArray(content)) continue
    const hasTool = content.some((c: any) => c?.type === 'tool_use')
    const hasText = content.some((c: any) => c?.type === 'text' && c.text?.trim())
    return !hasTool && hasText
  }
  return false
}

// ------------------------------------------------------------------- leitura

/** Acha o diretório de projeto que contém o transcript desta sessão. */
async function findProjectDir(sessionId: string): Promise<string | null> {
  const root = path.join(CLAUDE_HOME, 'projects')
  let entries: string[]
  try { entries = await fsp.readdir(root) } catch { return null }
  for (const e of entries) {
    const dir = path.join(root, e)
    if (fs.existsSync(path.join(dir, `${sessionId}.jsonl`))) return dir
  }
  return null
}

async function readTasks(sessionId: string): Promise<OfficeTask[]> {
  const dir = path.join(CLAUDE_HOME, 'tasks', sessionId)
  let files: string[]
  try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.json')) } catch { return [] }
  const tasks: OfficeTask[] = []
  for (const f of files.sort((a, b) => parseInt(a) - parseInt(b))) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(dir, f), 'utf8'))
      tasks.push({ id: j.id, subject: j.subject, status: j.status })
    } catch { /* arquivo em escrita — ignora nesta volta */ }
  }
  return tasks
}

/** Lê os subagents desta sessão: papel, o que faz agora, há quanto tempo. */
async function readSubagents(projDir: string, sessionId: string): Promise<Map<string, OfficeAgent>> {
  const out = new Map<string, OfficeAgent>()
  const dir = path.join(projDir, sessionId, 'subagents')
  let files: string[]
  try { files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.meta.json')) } catch { return out }

  for (const metaFile of files) {
    let meta: any
    try { meta = JSON.parse(await fsp.readFile(path.join(dir, metaFile), 'utf8')) } catch { continue }

    const role = String(meta.agentType || '').toLowerCase()
    const jsonl = path.join(dir, metaFile.replace('.meta.json', '.jsonl'))

    let mtime = 0
    try { mtime = (await fsp.stat(jsonl)).mtimeMs } catch { continue }

    const lines = await tailJsonl(jsonl)
    const last = lastToolUse(lines)
    const fresh = Date.now() - mtime < ACTIVE_MS

    let status: AgentStatus = 'idle'
    if (fresh) status = 'working'
    else if (endedWithText(lines)) status = 'done'

    const prev = out.get(role)
    // Mesmo papel disparado mais de uma vez na demanda: fica o mais recente.
    if (prev && (prev.since ?? '') > new Date(mtime).toISOString()) continue

    out.set(role, {
      id: role,
      role,
      name: role,
      status,
      desk: { col: 1, row: 1 },
      tool: last?.tool,
      detail: last?.detail,
      since: last?.at ?? new Date(mtime).toISOString(),
      description: meta.description,
      agentId: metaFile.replace('agent-', '').replace('.meta.json', ''),
    })
  }
  return out
}


// ------------------------------------------------------------------ serviços

const REGISTRO = path.join(CLAUDE_HOME, 'projetos.json')

function expandirTil(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

/** Porta escutando em localhost? */
function portaNoAr(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' })
    const fim = (ok: boolean) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(600)
    sock.once('connect', () => fim(true))
    sock.once('error', () => fim(false))
    sock.once('timeout', () => fim(false))
  })
}

/** Acha o projeto do registro que contém este cwd e confere as portas dele. */
async function lerServicos(cwd: string): Promise<OfficeService[]> {
  let registro: any
  try { registro = JSON.parse(await fsp.readFile(REGISTRO, 'utf8')) } catch { return [] }

  for (const [chave, proj] of Object.entries<any>(registro)) {
    if (chave.startsWith('_') || !Array.isArray(proj?.servicos)) continue
    const pertence = proj.servicos.some((sv: any) => expandirTil(sv.dir) === cwd)
    if (!pertence) continue
    return Promise.all(
      proj.servicos
        .filter((sv: any) => typeof sv.porta === 'number')
        .map(async (sv: any) => ({ label: sv.label, port: sv.porta, up: await portaNoAr(sv.porta) })),
    )
  }
  return []
}

// ------------------------------------------------------------------ snapshot

async function buildSnapshot(): Promise<OfficeState[]> {
  const raw = await sh('claude', ['agents', '--json', '--all'])
  let sessions: any[] = []
  try { sessions = JSON.parse(raw || '[]') } catch { sessions = [] }

  const live = sessions.filter((s) => s.kind === 'interactive' || s.state !== 'done')
  const states: OfficeState[] = []

  for (const s of live) {
    const projDir = await findProjectDir(s.sessionId)
    const mainFile = projDir ? path.join(projDir, `${s.sessionId}.jsonl`) : null

    let branch: string | null = null
    let mainTool: { tool: string; detail: string; at: string } | null = null
    let mainFresh = false
    if (mainFile) {
      const lines = await tailJsonl(mainFile)
      const b = lines.findLast((l: any) => l.gitBranch)?.gitBranch
      branch = b && b !== 'HEAD' ? b : null
      mainTool = lastToolUse(lines)
      try { mainFresh = Date.now() - (await fsp.stat(mainFile)).mtimeMs < ACTIVE_MS } catch {}
    }

    const subs = projDir ? await readSubagents(projDir, s.sessionId) : new Map<string, OfficeAgent>()
    const busy = s.status === 'busy' || s.state === 'running'

    const agents: OfficeAgent[] = ROLES.map((r, i) => {
      const desk = { col: (i % 2) + 1, row: Math.floor(i / 2) + 1 }
      if (r.role === 'orquestrador') {
        return {
          id: r.role, role: r.role, name: r.name, gender: r.gender, desk,
          status: (busy && mainFresh ? 'working' : busy ? 'checkpoint' : 'idle') as AgentStatus,
          tool: mainTool?.tool, detail: mainTool?.detail, since: mainTool?.at,
        }
      }
      const found = subs.get(r.role)
      return found
        ? { ...found, name: r.name, gender: r.gender, desk }
        : { id: r.role, role: r.role, name: r.name, gender: r.gender, desk, status: 'idle' as AgentStatus }
    })

    // Especialistas fora do time padrão (Explore, general-purpose...) entram depois.
    let extra = ROLES.length
    for (const [role, a] of subs) {
      if (ROLES.some((r) => r.role === role)) continue
      agents.push({
        ...a,
        name: role.charAt(0).toUpperCase() + role.slice(1),
        gender: extra % 2 === 0 ? 'male' : 'female',
        desk: { col: (extra % 2) + 1, row: Math.floor(extra / 2) + 1 },
      })
      extra++
    }

    states.push({
      sessionId: s.sessionId,
      project: path.basename(s.cwd || ''),
      cwd: s.cwd || '',
      branch,
      status: busy ? 'running' : 'idle',
      agents,
      tasks: await readTasks(s.sessionId),
      services: await lerServicos(s.cwd || ''),
      updatedAt: new Date().toISOString(),
    })
  }
  return states
}


// ---------------------------------------------------------------- transcript

/**
 * Lê o transcript inteiro guardando apenas as linhas do próprio agente.
 *
 * O `tailJsonl` não serve aqui: ele pega os últimos 64KB, e um único
 * `tool_result` de um arquivo Java grande ocupa essa janela sozinho — a lista
 * encolhia para duas ou três entradas conforme o especialista lia arquivos.
 * O resultado é memorizado por mtime, porque o painel repete a leitura a cada 2s.
 */
const cacheTranscript = new Map<string, { mtime: number; linhas: any[] }>()

async function lerLinhasDoAgente(arquivo: string): Promise<any[]> {
  let mtime = 0
  try { mtime = (await fsp.stat(arquivo)).mtimeMs } catch { return [] }

  const cache = cacheTranscript.get(arquivo)
  if (cache?.mtime === mtime) return cache.linhas

  const linhas: any[] = []
  const rl = readline.createInterface({
    input: fs.createReadStream(arquivo, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  })
  let i = 0
  for await (const l of rl) {
    const idx = i++
    if (!l) continue
    // Só interessam a primeira linha (o prompt delegado) e as falas do agente.
    // O teste de substring evita gastar JSON.parse nos tool_result gigantes.
    if (idx !== 0 && !l.includes('"type":"assistant"')) continue
    let j: any
    try { j = JSON.parse(l) } catch { continue }
    if (idx === 0 || j.type === 'assistant') linhas.push(j)
  }

  cacheTranscript.set(arquivo, { mtime, linhas })
  return linhas
}



/** Transcript completo de um especialista, para o painel que abre no clique. */
async function lerTranscript(agentId: string): Promise<EntradaTranscript[]> {
  const root = path.join(CLAUDE_HOME, 'projects')
  let alvo: string | null = null
  let dirs: string[]
  try { dirs = await fsp.readdir(root) } catch { return [] }

  busca: for (const d of dirs) {
    const projDir = path.join(root, d)
    let sessoes: string[]
    try { sessoes = await fsp.readdir(projDir) } catch { continue }
    for (const sid of sessoes) {
      const f = path.join(projDir, sid, 'subagents', `agent-${agentId}.jsonl`)
      if (fs.existsSync(f)) { alvo = f; break busca }
    }
  }
  if (!alvo) return []

  const linhas = await lerLinhasDoAgente(alvo)
  const saida: EntradaTranscript[] = []

  // A primeira linha do arquivo é o prompt que o orquestrador delegou.
  const primeira = linhas[0]
  if (primeira?.type === 'user') {
    const c = primeira.message?.content
    const txt = typeof c === 'string' ? c : Array.isArray(c) ? c.map((x: any) => x.text ?? '').join('') : ''
    if (txt) saida.push({ tipo: 'prompt', texto: txt, at: primeira.timestamp })
  }

  for (const j of linhas) {
    if (j.type !== 'assistant') continue
    for (const c of j.message?.content ?? []) {
      if (c.type === 'thinking' && c.thinking) {
        saida.push({ tipo: 'pensando', texto: c.thinking, at: j.timestamp })
      } else if (c.type === 'text' && c.text?.trim()) {
        saida.push({ tipo: 'texto', texto: c.text, at: j.timestamp })
      } else if (c.type === 'tool_use') {
        const { tool, detail } = describeTool(c.name, c.input)
        saida.push({
          tipo: 'ferramenta',
          texto: tool,
          detalhe: detail || JSON.stringify(c.input ?? {}).slice(0, 300),
          at: j.timestamp,
        })
      }
    }
  }
  return saida.slice(-400)
}

// -------------------------------------------------------------- plugin Vite

export function claudeWatcher(): Plugin {
  let wss: WebSocketServer | undefined
  let timer: NodeJS.Timeout | undefined
  let lastJson = ''

  return {
    name: 'claude-watcher',
    configureServer(server: ViteDevServer) {
      wss = new WebSocketServer({ noServer: true })

      server.httpServer?.on('upgrade', (req, socket, head) => {
        if (!req.url?.startsWith('/ws')) return
        wss!.handleUpgrade(req, socket as any, head, (ws) => wss!.emit('connection', ws, req))
      })

      const broadcast = (payload: string) => {
        for (const c of wss!.clients) {
          if (c.readyState === WebSocket.OPEN) c.send(payload)
        }
      }

      // Um orquestrador por projeto, mas uma demanda por vez: o gerente
      // enfileira o que chega para outro projeto e só começa com o seu aval.
      const gerente = new Gerente((evento: EventoChat) => {
        broadcast(JSON.stringify({ type: 'CHAT', evento }))
      })

      // Reata as conversas de antes do último desligamento.
      gerente.retomar().then(
        () => broadcast(JSON.stringify({ type: 'FILA', ...gerente.resumoFila() })),
        (e) => server.config.logger.warn(`[agent-office] falha ao retomar: ${e}`),
      )

      wss.on('connection', async (ws) => {
        if (lastJson) ws.send(lastJson)
        // Reconexão ou página recarregada: devolve a conversa gravada de cada projeto.
        for (const chave of await gerente.projetosComConversa()) {
          const eventos = await gerente.historico(chave)
          if (eventos.length) ws.send(JSON.stringify({ type: 'HISTORICO', chave, eventos }))
        }
        ws.send(JSON.stringify({ type: 'FILA', ...gerente.resumoFila() }))

        ws.on('message', async (raw) => {
          let msg: any
          try { msg = JSON.parse(String(raw)) } catch { return }

          try {
            switch (msg.type) {
              case 'CHAT_ENVIAR':
                if (typeof msg.texto === 'string' && msg.texto.trim()) {
                  await gerente.enviar(String(msg.chave), msg.texto)
                  broadcast(JSON.stringify({ type: 'FILA', ...gerente.resumoFila() }))
                }
                break
              case 'CHAT_PROJETO':
                await gerente.abrir(String(msg.chave))
                break
              case 'FILA_RESPOSTA':
                await gerente.responderFila(msg.comecar === true)
                broadcast(JSON.stringify({ type: 'FILA', ...gerente.resumoFila() }))
                break
              case 'PERMISSAO':
                if (msg.acao === 'recusar') gerente.recusar(String(msg.chave), String(msg.id))
                else await gerente.aprovar(String(msg.chave), String(msg.id), msg.acao === 'aprovar_sempre')
                break
              case 'TRANSCRIPT': {
                const entradas = await lerTranscript(String(msg.agentId))
                ws.send(JSON.stringify({ type: 'TRANSCRIPT', agentId: msg.agentId, entradas }))
                break
              }
              case 'ANEXO': {
                // Arquivo solto no chat vira arquivo em disco, e o caminho entra
                // na mensagem — assim qualquer sessão do Claude Code consegue abrir.
                const dados = Buffer.from(String(msg.dados ?? ''), 'base64')
                if (dados.length > 20 * 1024 * 1024) {
                  ws.send(JSON.stringify({ type: 'ANEXO_ERRO', texto: 'Arquivo acima de 20 MB.' }))
                  break
                }
                const dir = path.join(CLAUDE_HOME, 'agent-office', 'anexos')
                await fsp.mkdir(dir, { recursive: true })
                const limpo = String(msg.nome ?? 'arquivo').replace(/[^\w.\-]/g, '_').slice(-80)
                const destino = path.join(dir, `${Date.now()}-${limpo}`)
                await fsp.writeFile(destino, dados)
                ws.send(JSON.stringify({ type: 'ANEXO_OK', caminho: destino, nome: limpo }))
                break
              }
              case 'PROJETOS': {
                let reg: any = {}
                try { reg = JSON.parse(await fsp.readFile(REGISTRO, 'utf8')) } catch {}
                const lista = Object.entries<any>(reg)
                  .filter(([k, v]) => !k.startsWith('_') && v?.servicos)
                  .map(([k, v]) => ({ chave: k, nome: v.nome ?? k }))
                ws.send(JSON.stringify({ type: 'PROJETOS', lista }))
                break
              }
            }
          } catch (e) {
            ws.send(JSON.stringify({ type: 'CHAT', evento: { kind: 'erro', texto: String(e) } }))
          }
        })
      })

      const tick = async () => {
        try {
          const sessions = await buildSnapshot()
          const json = JSON.stringify({ type: 'SNAPSHOT', sessions })
          if (json !== lastJson) { lastJson = json; broadcast(json) }
        } catch (e) {
          server.config.logger.warn(`[agent-office] falha ao ler estado: ${e}`)
        }
      }

      tick()
      timer = setInterval(tick, POLL_MS)
      server.httpServer?.on('close', () => {
        clearInterval(timer)
        gerente.parar()
        wss?.close()
      })
    },
  }
}
