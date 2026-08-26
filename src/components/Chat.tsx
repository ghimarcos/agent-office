import { useEffect, useRef, useState } from 'react'
import { useOfficeStore, type Bloco } from '@/store/useOfficeStore'

/** Blocos de pensamento vêm fechados — abre no clique. */
function BlocoPensando({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className={`bloco pensando ${aberto ? 'aberto' : ''}`} onClick={() => setAberto(!aberto)}>
      <span className="rotulo">{aberto ? '▾' : '▸'} pensando</span>
      {aberto && <div className="corpo-pensamento">{texto}</div>}
    </div>
  )
}

function CardPermissao({ bloco }: { bloco: Bloco }) {
  const responder = useOfficeStore((s) => s.responderPermissao)
  const p = bloco.permissao!
  const decidida = bloco.resolvida

  return (
    <div className={`permissao ${decidida ?? ''}`}>
      <div className="cabeca">
        {decidida === 'recusada' ? 'Recusado' : decidida ? 'Aprovado' : 'Preciso da sua aprovação'}
      </div>
      <div className="ferramenta">{p.ferramenta}</div>
      <pre className="alvo">{p.alvo}</pre>
      <div className="regra">libera a regra <code>{p.regra}</code></div>
      {!decidida && (
        <div className="botoes">
          <button className="ok" onClick={() => responder(bloco.id, p.id, 'aprovar')}>Aprovar uma vez</button>
          <button className="sempre" onClick={() => responder(bloco.id, p.id, 'aprovar_sempre')}>Sempre permitir</button>
          <button className="nao" onClick={() => responder(bloco.id, p.id, 'recusar')}>Recusar</button>
        </div>
      )}
      {decidida === 'sempre' && <div className="nota">Regra gravada no settings.local.json do projeto.</div>}
    </div>
  )
}

/** "O time terminou aqui. Começo a demanda que está esperando no outro projeto?" */
function CardFila({ bloco }: { bloco: Bloco }) {
  const responder = useOfficeStore((s) => s.responderFila)
  const escolherProjeto = useOfficeStore((s) => s.escolherProjeto)
  const f = bloco.fila!
  const decidida = bloco.resolvida

  return (
    <div className={`fila-card ${decidida ?? ''}`}>
      <div className="cabeca">
        {decidida === 'comecou' ? `Começando em ${f.alvoNome}`
          : decidida === 'adiada' ? 'Guardado na fila'
          : 'Time livre — tem demanda esperando'}
      </div>
      <div className="alvo-projeto">{f.alvoNome}</div>
      <div className="resumo">{f.resumo}</div>
      {!decidida && (
        <div className="botoes">
          <button className="ok" onClick={() => { responder(bloco.id, true); escolherProjeto(f.alvo) }}>
            Começar agora
          </button>
          <button className="nao" onClick={() => responder(bloco.id, false)}>Depois</button>
        </div>
      )}
    </div>
  )
}

export function Chat() {
  const {
    projetos, chaveAtiva, blocosPorProjeto, pensandoPorProjeto,
    ocupadoPor, fila, anexoRecebido, nomePorProjeto,
    connected, enviar, escolherProjeto, enviarAnexo, limparAnexo,
  } = useOfficeStore()
  const [texto, setTexto] = useState('')
  const [arrastando, setArrastando] = useState(false)
  const fim = useRef<HTMLDivElement>(null)

  // Cada projeto tem a sua conversa; trocar de aba só troca o que está à vista.
  const blocos = chaveAtiva ? blocosPorProjeto[chaveAtiva] ?? [] : []
  const pensando = chaveAtiva ? pensandoPorProjeto[chaveAtiva] ?? false : false

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }) }, [blocos.length, pensando])

  // Arquivo solto vira caminho colado na mensagem — é assim que qualquer
  // sessão do Claude Code consegue abri-lo depois.
  useEffect(() => {
    if (!anexoRecebido) return
    setTexto((t) => (t ? t.trimEnd() + '\n' : '') + `[anexo: ${anexoRecebido.caminho}]\n`)
    limparAnexo()
  }, [anexoRecebido, limparAnexo])

  const soltar = (e: React.DragEvent) => {
    e.preventDefault()
    setArrastando(false)
    for (const f of Array.from(e.dataTransfer.files)) enviarAnexo(f)
  }

  const submeter = () => {
    const t = texto.trim()
    if (!t || !connected || !chaveAtiva) return
    enviar(t)
    setTexto('')
  }

  return (
    <section className="chat">
      <div className="chat-topo">
        <select
          value={chaveAtiva ?? ''}
          onChange={(e) => e.target.value && escolherProjeto(e.target.value)}
        >
          <option value="">Escolha o projeto…</option>
          {projetos.map((p) => {
            // Ponto ao lado do nome: esse projeto tem conversa viva em segundo plano.
            const vivo = (blocosPorProjeto[p.chave]?.length ?? 0) > 0
            const trabalhando = ocupadoPor === p.chave
            const naFila = fila.filter((k) => k === p.chave).length
            return (
              <option key={p.chave} value={p.chave}>
                {trabalhando ? '◐ ' : vivo ? '● ' : ''}{p.nome}
                {naFila ? ` (${naFila} na fila)` : ''}
              </option>
            )
          })}
        </select>
      </div>

      {ocupadoPor && ocupadoPor !== chaveAtiva && (
        <div className="faixa-ocupado">
          Time trabalhando em <b>{nomePorProjeto[ocupadoPor] ?? ocupadoPor}</b>. O que você mandar aqui entra na fila.
        </div>
      )}

      <div className="chat-fluxo">
        {!blocos.length && (
          <p className="vazio">
            Escolha um projeto acima e mande a demanda. Eu delego para o Arquiteto, Dev e QA
            e vou te contando em que pé estamos.
          </p>
        )}

        {blocos.map((b) => {
          if (b.tipo === 'permissao') return <CardPermissao key={b.id} bloco={b} />
          if (b.tipo === 'fila') return <CardFila key={b.id} bloco={b} />
          if (b.tipo === 'pensando') return <BlocoPensando key={b.id} texto={b.texto} />
          if (b.tipo === 'ferramenta') {
            return (
              <div className="bloco ferramenta" key={b.id}>
                <span className="rotulo">{b.texto}</span>
                {b.detalhe && <span className="detalhe">{b.detalhe}</span>}
              </div>
            )
          }
          return (
            <div className={`bloco fala ${b.autor}`} key={b.id}>
              {b.texto}
            </div>
          )
        })}

        {pensando && <div className="bloco fala claude digitando"><i /><i /><i /></div>}
        <div ref={fim} />
      </div>

      <div
        className={`chat-entrada ${arrastando ? 'arrastando' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true) }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
      >
        <textarea
          value={texto}
          placeholder={!connected ? 'Sem conexão' : !chaveAtiva ? 'Escolha um projeto primeiro' : 'Manda a demanda…'}
          disabled={!connected || !chaveAtiva}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submeter() }
          }}
        />
        <button onClick={submeter} disabled={!connected || !chaveAtiva || !texto.trim()}>Enviar</button>
        {arrastando && <div className="solte-aqui">Solte para anexar</div>}
      </div>
    </section>
  )
}
