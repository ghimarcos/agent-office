/**
 * Dono dos orquestradores: um por projeto, uma demanda por vez.
 *
 * Duas garantias que o painel depende:
 *
 * 1. **Nenhum projeto atropela o outro.** Só um time trabalha por vez. Demanda
 *    enviada para outro projeto entra na fila; quando o time termina, o painel
 *    pergunta se pode começar a próxima.
 *
 * 2. **Nada se perde ao reiniciar.** Sessão e regras aprovadas vão para disco,
 *    e a conversa é gravada em JSONL. Ao subir de novo, cada projeto volta com
 *    `--resume` e a conversa é reenviada ao navegador.
 */
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { Orquestrador, type EventoChat } from './orquestrador'

const BASE = path.join(os.homedir(), '.claude', 'agent-office')
const ESTADO = path.join(BASE, 'estado.json')
const CONVERSAS = path.join(BASE, 'conversas')
const REGISTRO = path.join(os.homedir(), '.claude', 'projetos.json')
/** Quanto da conversa volta ao navegador numa reconexão. */
const REPLAY_MAX = 300

interface Pendente { chave: string; texto: string }

interface EstadoDisco {
  projetos: Record<string, { sessionId: string; regras: string[] }>
  fila: Pendente[]
  ocupado: string | null
}

export class Gerente {
  private orqs = new Map<string, Orquestrador>()
  /** Chave do projeto cujo time está trabalhando agora. */
  private ocupado: string | null = null
  private fila: Pendente[] = []
  /** Demanda que já foi oferecida ao usuário e espera resposta. */
  private oferecida: Pendente | null = null

  constructor(private emitirGlobal: (e: EventoChat) => void) {}

  // ------------------------------------------------------------- persistência

  private async gravarEstado(): Promise<void> {
    const estado: EstadoDisco = {
      projetos: Object.fromEntries(
        [...this.orqs.entries()]
          .filter(([, o]) => o.projetoAtual)
          .map(([k, o]) => [k, { sessionId: o.sessao, regras: o.regrasLiberadas }]),
      ),
      fila: this.fila,
      ocupado: this.ocupado,
    }
    await fsp.mkdir(BASE, { recursive: true })
    await fsp.writeFile(ESTADO, JSON.stringify(estado, null, 2) + '\n')
  }

  private arquivoConversa(chave: string): string {
    return path.join(CONVERSAS, `${chave}.jsonl`)
  }

  private async gravarEvento(e: EventoChat): Promise<void> {
    try {
      await fsp.mkdir(CONVERSAS, { recursive: true })
      await fsp.appendFile(this.arquivoConversa(e.chave), JSON.stringify(e) + '\n')
    } catch { /* histórico é conforto, não pode derrubar o chat */ }
  }

  /** Conversa gravada de um projeto, para reenviar ao navegador. */
  async historico(chave: string): Promise<EventoChat[]> {
    try {
      const linhas = (await fsp.readFile(this.arquivoConversa(chave), 'utf8')).trim().split('\n')
      return linhas.slice(-REPLAY_MAX).map((l) => JSON.parse(l)).filter(Boolean)
    } catch { return [] }
  }

  /** Projetos que têm conversa gravada — o navegador reabre todos. */
  async projetosComConversa(): Promise<string[]> {
    try {
      return (await fsp.readdir(CONVERSAS)).filter((f) => f.endsWith('.jsonl')).map((f) => f.slice(0, -6))
    } catch { return [] }
  }

  // ------------------------------------------------------------------ retomada

  /** Chamado uma vez quando o servidor sobe. */
  async retomar(): Promise<void> {
    let estado: EstadoDisco
    try { estado = JSON.parse(await fsp.readFile(ESTADO, 'utf8')) } catch { return }

    for (const [chave, salvo] of Object.entries(estado.projetos ?? {})) {
      // Só reata se o transcript daquela sessão ainda existir; senão `--resume` falha.
      if (!this.sessaoExiste(salvo.sessionId)) continue
      const o = this.pegar(chave)
      o.restaurar(salvo.sessionId, salvo.regras ?? [])
      await o.abrirProjeto()
    }

    // A fila volta, mas nada recomeça sozinho: quem decide é você.
    // E nada é oferecido aqui — no boot não há ninguém olhando, e a oferta
    // seria gasta no vazio. A pergunta sai quando um turno terminar de verdade.
    this.fila = estado.fila ?? []
    this.ocupado = null
    this.oferecida = null
    await this.gravarEstado()
  }

  private sessaoExiste(sessionId: string): boolean {
    const root = path.join(os.homedir(), '.claude', 'projects')
    let dirs: string[]
    try { dirs = fs.readdirSync(root) } catch { return false }
    return dirs.some((d) => fs.existsSync(path.join(root, d, `${sessionId}.jsonl`)))
  }

  // ------------------------------------------------------------------ projetos

  private pegar(chave: string): Orquestrador {
    let o = this.orqs.get(chave)
    if (!o) {
      o = new Orquestrador(chave, (e) => this.receber(e))
      this.orqs.set(chave, o)
    }
    return o
  }

  /** Todo evento passa por aqui: vai pro disco, pro navegador, e alimenta a fila. */
  private receber(e: EventoChat): void {
    void this.gravarEvento(e)
    this.emitirGlobal(e)
    if (e.kind === 'fim' && this.ocupado === e.chave) {
      this.ocupado = null
      void this.aoTerminar(e.chave)
    }
  }

  async abrir(chave: string): Promise<void> {
    await this.pegar(chave).abrirProjeto()
    await this.gravarEstado()
  }

  // ---------------------------------------------------------------------- fila

  private async nomeDe(chave: string): Promise<string> {
    try {
      const reg = JSON.parse(await fsp.readFile(REGISTRO, 'utf8'))
      return reg[chave]?.nome ?? chave
    } catch { return chave }
  }

  /**
   * Manda a demanda, ou guarda na fila se outro time estiver trabalhando.
   * Continuar a conversa do projeto que já está ocupado passa direto.
   */
  async enviar(chave: string, texto: string): Promise<void> {
    const o = this.pegar(chave)

    if (this.ocupado && this.ocupado !== chave) {
      this.fila.push({ chave, texto })
      await this.gravarEstado()
      this.receber({
        kind: 'enfileirado', chave,
        posicao: this.fila.length,
        ocupadoPor: await this.nomeDe(this.ocupado),
      })
      return
    }

    // Turno novo apaga oferta velha. Sem isso, uma pergunta que você nunca
    // respondeu virava tranca: `aoTerminar` saía cedo para sempre e o card
    // nunca mais aparecia.
    this.oferecida = null
    this.ocupado = chave
    await this.gravarEstado()
    o.enviar(texto)
  }

  /** Time terminou: se houver alguém na fila, pergunta antes de começar. */
  private async aoTerminar(chaveQueTerminou: string): Promise<void> {
    await this.gravarEstado()
    if (!this.fila.length || this.oferecida) return
    await this.oferecerProxima(chaveQueTerminou)
  }

  private async oferecerProxima(ondePerguntar: string): Promise<void> {
    const proxima = this.fila[0]
    if (!proxima) return
    this.oferecida = proxima
    // A pergunta aparece na conversa que acabou de terminar — é onde você está olhando.
    const chaveDaPergunta = this.orqs.has(ondePerguntar) ? ondePerguntar : proxima.chave
    this.receber({
      kind: 'fila_pergunta',
      chave: chaveDaPergunta,
      alvo: proxima.chave,
      alvoNome: await this.nomeDe(proxima.chave),
      resumo: proxima.texto.length > 140 ? proxima.texto.slice(0, 139) + '…' : proxima.texto,
    })
  }

  /** Resposta ao card "começar a próxima?". */
  async responderFila(comecar: boolean): Promise<void> {
    const pendente = this.oferecida
    this.oferecida = null
    if (!pendente) return

    if (!comecar) {
      // Fica na fila; você retoma quando quiser mandando de novo ou abrindo o projeto.
      await this.gravarEstado()
      return
    }

    this.fila = this.fila.filter((f) => f !== pendente)
    const o = this.pegar(pendente.chave)
    if (!o.projetoAtual) await o.abrirProjeto()
    this.ocupado = pendente.chave
    await this.gravarEstado()
    o.enviar(pendente.texto)
  }

  // --------------------------------------------------------------- permissões

  async aprovar(chave: string, id: string, sempre: boolean): Promise<void> {
    await this.pegar(chave).aprovar(id, sempre)
    await this.gravarEstado()
  }

  recusar(chave: string, id: string): void {
    this.pegar(chave).recusar(id)
  }

  /** Projetos já abertos, com o nome de exibição. */
  abertos(): { chave: string; nome: string }[] {
    return [...this.orqs.entries()]
      .filter(([, o]) => o.projetoAtual)
      .map(([chave, o]) => ({ chave, nome: o.projetoAtual }))
  }

  /** Estado da fila, para o navegador desenhar os indicadores. */
  resumoFila(): { ocupado: string | null; fila: { chave: string }[] } {
    return { ocupado: this.ocupado, fila: this.fila.map((f) => ({ chave: f.chave })) }
  }

  parar(): void {
    for (const o of this.orqs.values()) o.parar()
  }
}
