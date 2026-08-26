/**
 * Processo Claude Code de longa duração que atende o chat do painel.
 *
 * Um único processo por projeto, falando stream-json pelos dois lados: recebe
 * turnos do usuário por stdin e devolve pensamento, texto e ferramentas em
 * streaming.
 *
 * Permissões: em modo headless o CLI não pergunta — ele emite
 * `system/permission_denied` e segue. Capturamos esse evento, mostramos o card
 * de aprovação no chat e, quando o usuário aprova, reiniciamos o processo com
 * `--resume` (o contexto sobrevive) somando a regra ao `--allowedTools`.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

/** Todo evento carrega a chave do projeto: um projeto em segundo plano continua
 *  trabalhando e seus eventos precisam ir para a conversa certa. */
type CorpoEvento =
  | { kind: 'inicio'; projeto: string; cwd: string; sessionId: string; retomado: boolean }
  | { kind: 'pensando'; texto: string }
  | { kind: 'texto'; texto: string }
  | { kind: 'ferramenta'; nome: string; detalhe: string }
  | { kind: 'permissao'; id: string; ferramenta: string; alvo: string; regra: string }
  | { kind: 'fim' }
  | { kind: 'erro'; texto: string }

/** Todo evento carrega a chave do projeto de origem. */
export type EventoChat = CorpoEvento & { chave: string }

interface PedidoPermissao {
  id: string
  ferramenta: string
  alvo: string
  regra: string
}

const REGISTRO = path.join(os.homedir(), '.claude', 'projetos.json')

function expandirTil(p: string): string {
  return p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p
}

/** Traduz uma ferramenta negada na regra de allowlist correspondente. */
function regraPara(ferramenta: string, input: any): string {
  if (ferramenta === 'Bash') {
    // `./mvnw -q compile` → `Bash(./mvnw:*)` — libera o binário, não o comando inteiro.
    const cmd = String(input?.command || '').trim()
    const bin = cmd.split(/\s+/)[0]
    return bin ? `Bash(${bin}:*)` : 'Bash'
  }
  return ferramenta
}

/** Descreve o alvo da ação em uma linha legível no card. */
function alvoDe(ferramenta: string, input: any): string {
  if (!input) return ''
  if (ferramenta === 'Bash') return String(input.command || '').slice(0, 200)
  if (input.file_path) return String(input.file_path)
  if (input.pattern) return String(input.pattern)
  return JSON.stringify(input).slice(0, 200)
}

export class Orquestrador {
  private proc: ChildProcess | null = null
  private buf = ''
  private sessionId = randomUUID()
  private primeiroTurno = true
  private cwd = os.homedir()
  private addDirs: string[] = []
  private projeto = ''
  /** Regras já liberadas nesta execução. */
  private permitidas = new Set<string>()
  /** tool_use_id → input, para saber o que foi negado. */
  private inputsPorToolUse = new Map<string, { nome: string; input: any }>()
  private pendentes = new Map<string, PedidoPermissao>()

  constructor(
    readonly chave: string,
    private aoEmitir: (e: EventoChat) => void,
  ) {}

  private emitir(e: CorpoEvento): void {
    this.aoEmitir({ ...e, chave: this.chave })
  }

  get projetoAtual(): string { return this.projeto }
  get sessao(): string { return this.sessionId }

  private configurado = false

  /**
   * Prepara o projeto. Chamar de novo num orquestrador que já existe apenas
   * reanuncia a conversa — o processo e o histórico continuam de pé, para que
   * o trabalho iniciado num projeto siga rodando enquanto você olha outro.
   */
  async abrirProjeto(): Promise<void> {
    if (this.configurado) {
      this.emitir({
        kind: 'inicio', projeto: this.projeto, cwd: this.cwd,
        sessionId: this.sessionId, retomado: true,
      })
      return
    }

    let registro: any = {}
    try { registro = JSON.parse(await fsp.readFile(REGISTRO, 'utf8')) } catch {}
    const proj = registro[this.chave]
    if (!proj?.servicos?.length) {
      this.emitir({ kind: 'erro', texto: `Projeto "${this.chave}" não está em ~/.claude/projetos.json.` })
      return
    }
    const dirs: string[] = proj.servicos
      .filter((s: any) => s.default !== false)
      .map((s: any) => expandirTil(s.dir))

    this.projeto = proj.nome ?? this.chave
    this.cwd = dirs[0]
    this.addDirs = dirs.slice(1)
    this.configurado = true
    this.subir()
    this.emitir({
      kind: 'inicio', projeto: this.projeto, cwd: this.cwd,
      sessionId: this.sessionId, retomado: false,
    })
  }

  private argumentos(): string[] {
    const args = [
      '-p', '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      // `manual` é o único modo em que o CLI emite `system/permission_denied`.
      // Sem ele a negação chega só como texto e não há como montar o card.
      '--permission-mode', 'manual',
    ]
    // Primeira subida cria a sessão; as seguintes retomam preservando o contexto.
    if (this.primeiroTurno) args.push('--session-id', this.sessionId)
    else args.push('--resume', this.sessionId)
    for (const d of this.addDirs) args.push('--add-dir', d)
    if (this.permitidas.size) args.push('--allowedTools', [...this.permitidas].join(' '))
    return args
  }

  private subir(): void {
    if (this.proc) return
    this.proc = spawn('claude', this.argumentos(), {
      cwd: this.cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    })
    this.primeiroTurno = false
    this.buf = ''

    this.proc.stdout?.on('data', (d) => this.consumir(String(d)))
    this.proc.stderr?.on('data', (d) => {
      const t = String(d).trim()
      if (t) this.emitir({ kind: 'erro', texto: t.slice(0, 400) })
    })
    this.proc.on('close', () => { this.proc = null })
  }

  private consumir(chunk: string): void {
    this.buf += chunk
    const linhas = this.buf.split('\n')
    this.buf = linhas.pop() ?? ''
    for (const l of linhas) {
      if (!l.trim()) continue
      let j: any
      try { j = JSON.parse(l) } catch { continue }
      this.tratar(j)
    }
  }

  private tratar(j: any): void {
    if (j.type === 'assistant') {
      for (const c of j.message?.content ?? []) {
        if (c.type === 'thinking' && c.thinking) {
          this.emitir({ kind: 'pensando', texto: c.thinking })
        } else if (c.type === 'text' && c.text) {
          this.emitir({ kind: 'texto', texto: c.text })
        } else if (c.type === 'tool_use') {
          this.inputsPorToolUse.set(c.id, { nome: c.name, input: c.input })
          this.emitir({ kind: 'ferramenta', nome: c.name, detalhe: alvoDe(c.name, c.input).slice(0, 120) })
        }
      }
      return
    }

    if (j.type === 'system' && j.subtype === 'permission_denied') {
      const registrado = this.inputsPorToolUse.get(j.tool_use_id)
      const ferramenta = j.tool_name ?? registrado?.nome ?? 'ferramenta'
      const input = registrado?.input
      const pedido: PedidoPermissao = {
        id: j.tool_use_id ?? randomUUID(),
        ferramenta,
        alvo: alvoDe(ferramenta, input) || String(j.message ?? '').slice(0, 200),
        regra: regraPara(ferramenta, input),
      }
      this.pendentes.set(pedido.id, pedido)
      this.emitir({ kind: 'permissao', ...pedido })
      return
    }

    if (j.type === 'result') {
      this.emitir({ kind: 'fim' })
    }
  }

  /** Manda um turno do usuário. Sobe o processo se ele tiver caído. */
  enviar(texto: string): void {
    if (!this.proc) this.subir()
    const msg = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: texto }] } }
    this.proc?.stdin?.write(JSON.stringify(msg) + '\n')
  }

  /**
   * Libera a regra e retoma. `sempre` grava no settings.local.json do projeto;
   * caso contrário vale só enquanto este processo viver.
   */
  async aprovar(id: string, sempre: boolean): Promise<void> {
    const pedido = this.pendentes.get(id)
    if (!pedido) return
    this.pendentes.delete(id)
    this.permitidas.add(pedido.regra)
    if (sempre) await this.persistirRegra(pedido.regra)

    // O allowlist entra por argumento, então o processo precisa renascer.
    // `--resume` traz a conversa inteira de volta.
    this.parar()
    this.subir()
    this.enviar(`Aprovado: ${pedido.regra}. Pode refazer a ação e continuar de onde parou.`)
  }

  recusar(id: string): void {
    const pedido = this.pendentes.get(id)
    if (!pedido) return
    this.pendentes.delete(id)
    this.enviar(`Recusado: não use ${pedido.ferramenta} nessa ação. Siga por outro caminho ou me explique por que precisa.`)
  }

  private async persistirRegra(regra: string): Promise<void> {
    const arq = path.join(this.cwd, '.claude', 'settings.local.json')
    let cfg: any = {}
    try { cfg = JSON.parse(await fsp.readFile(arq, 'utf8')) } catch {}
    cfg.permissions ??= {}
    cfg.permissions.allow ??= []
    if (!cfg.permissions.allow.includes(regra)) cfg.permissions.allow.push(regra)
    await fsp.mkdir(path.dirname(arq), { recursive: true })
    await fsp.writeFile(arq, JSON.stringify(cfg, null, 2) + '\n')
  }

  parar(): void {
    this.proc?.stdin?.end()
    this.proc?.kill()
    this.proc = null
  }
}
