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

export function Chat() {
  const { blocos, pensando, projetos, projetoAtivo, connected, enviar, escolherProjeto } = useOfficeStore()
  const [texto, setTexto] = useState('')
  const fim = useRef<HTMLDivElement>(null)

  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }) }, [blocos.length, pensando])

  const submeter = () => {
    const t = texto.trim()
    if (!t || !connected) return
    enviar(t)
    setTexto('')
  }

  return (
    <section className="chat">
      <div className="chat-topo">
        <select
          value={projetoAtivo ? projetos.find((p) => p.nome === projetoAtivo)?.chave ?? '' : ''}
          onChange={(e) => e.target.value && escolherProjeto(e.target.value)}
        >
          <option value="">Escolha o projeto…</option>
          {projetos.map((p) => <option key={p.chave} value={p.chave}>{p.nome}</option>)}
        </select>
      </div>

      <div className="chat-fluxo">
        {!blocos.length && (
          <p className="vazio">
            Escolha um projeto acima e mande a demanda. Eu delego para o Arquiteto, Dev e QA
            e vou te contando em que pé estamos.
          </p>
        )}

        {blocos.map((b) => {
          if (b.tipo === 'permissao') return <CardPermissao key={b.id} bloco={b} />
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

      <div className="chat-entrada">
        <textarea
          value={texto}
          placeholder={connected ? 'Manda a demanda…' : 'Sem conexão'}
          disabled={!connected}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submeter() }
          }}
        />
        <button onClick={submeter} disabled={!connected || !texto.trim()}>Enviar</button>
      </div>
    </section>
  )
}
