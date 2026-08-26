import { useEffect, useRef, useState } from 'react'
import Phaser from 'phaser'
import { OfficeScene } from './office/OfficeScene'
import { bus } from './office/bus'
import { useOfficeStore } from './store/useOfficeStore'
import { PainelTranscript } from './components/PainelTranscript'
import type { AgentStatus } from './types/state'

/**
 * O jogo Phaser vive fora do React de propósito.
 *
 * Em StrictMode o efeito roda duas vezes; como `game.destroy()` do Phaser é
 * adiado para o próximo frame, o destroy do primeiro jogo chegava depois da
 * criação do segundo e levava o canvas junto — tela preta.
 *
 * E fica no `window`, não no escopo do módulo: o HMR troca o módulo e zeraria
 * uma variável de módulo, nascendo um segundo jogo por cima do primeiro.
 */
declare global {
  interface Window { __agentOfficeGame?: Phaser.Game }
}

/** Em desenvolvimento, derruba o jogo antes do módulo ser trocado. */
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    window.__agentOfficeGame?.destroy(true)
    window.__agentOfficeGame = undefined
  })
}

const COR_ESTADO: Record<AgentStatus, string> = {
  idle: 'var(--off)',
  working: 'var(--busy)',
  done: 'var(--ok)',
  checkpoint: 'var(--warn)',
  delivering: 'var(--busy)',
}

const ROTULO_ESTADO: Record<AgentStatus, string> = {
  idle: 'aguardando',
  working: 'trabalhando',
  done: 'concluído',
  checkpoint: 'pensando',
  delivering: 'entregando',
}

export default function App() {
  const palco = useRef<HTMLDivElement>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [carga, setCarga] = useState<{ pronto: boolean; progresso: number }>({ pronto: false, progresso: 0 })

  const {
    sessions, selectedId, connected, transcript,
    connect, select, abrirTranscript,
  } = useOfficeStore()
  const atual = sessions.find((s) => s.sessionId === selectedId) ?? null

  useEffect(() => { connect() }, [connect])

  // Phaser sobe uma vez só, e fica de pé enquanto a página viver.
  //
  // Só sobe depois que a div tem tamanho de verdade. Se subir enquanto o
  // layout ainda está em 0x0, o WebGL cria um framebuffer inválido
  // ("Incomplete Attachment") e o renderer nunca se recupera — tela preta.
  useEffect(() => {
    if (window.__agentOfficeGame) return
    let cancelado = false

    const tentar = () => {
      if (cancelado || window.__agentOfficeGame) return
      const div = palco.current
      if (!div || div.offsetWidth < 2 || div.offsetHeight < 2) {
        requestAnimationFrame(tentar)
        return
      }
      window.__agentOfficeGame = new Phaser.Game({
        type: Phaser.AUTO,
        parent: div,
        backgroundColor: '#120e18',
        pixelArt: true,
        audio: { noAudio: true },
        // setTimeout continua andando em aba de fundo; o rAF é congelado.
        fps: { forceSetTimeOut: true },
        scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
        scene: [new OfficeScene()],
      })
    }

    requestAnimationFrame(tentar)
    return () => { cancelado = true }
  }, [])

  useEffect(() => { bus.aoCarregar((pronto, progresso) => setCarga({ pronto, progresso })) }, [])

  // Clique no bonequino abre o transcript daquele especialista.
  useEffect(() => {
    bus.aoClicar((agent) => {
      if (!agent.agentId) {
        setAviso(`${agent.name} ainda não foi acionado nesta demanda.`)
        setTimeout(() => setAviso(null), 3200)
        return
      }
      abrirTranscript(agent.agentId, agent.name)
    })
  }, [abrirTranscript])

  // Cada snapshot vai pro bus; a cena consome quando estiver de pé.
  useEffect(() => { bus.publicar(atual?.agents ?? null) }, [atual])

  return (
    <div className="app">
      <header className="topo">
        <h1>{atual ? atual.project : 'Agent Office'}</h1>
        {atual?.branch && <span className="branch">branch {atual.branch}</span>}
        <span className="espaco" />
        <div className="servicos">
          {atual?.services.map((sv) => (
            <span className="servico" key={sv.port}>
              <i className={`ponto ${sv.up ? 'up' : ''}`} />
              {sv.label} :{sv.port}
            </span>
          ))}
        </div>
        <span className="conexao">
          <i className={`ponto ${connected ? 'up' : ''}`} />
          {connected ? 'ao vivo' : 'reconectando…'}
        </span>
      </header>

      {sessions.length > 1 && (
        <nav className="abas">
          {sessions.map((s) => (
            <button
              key={s.sessionId}
              className={`aba ${s.sessionId === selectedId ? 'ativa' : ''}`}
              onClick={() => select(s.sessionId)}
            >
              <i className="ponto" style={{ background: s.status === 'running' ? 'var(--busy)' : 'var(--off)' }} />
              {s.project}
            </button>
          ))}
        </nav>
      )}

      <div className="corpo">
        <div className="palco" ref={palco}>
          {aviso && <div className="toast">{aviso}</div>}
          {!carga.pronto && connected && (
            <div className="carregando">
              <div className="barra"><i style={{ width: `${Math.round(carga.progresso * 100)}%` }} /></div>
              <span>montando o escritório… {Math.round(carga.progresso * 100)}%</span>
              {document.hidden && <small>o navegador pausa a animação em aba de fundo</small>}
            </div>
          )}
          {!connected && (
            <div className="aviso">
              <div>Sem conexão com o watcher.</div>
              <div>Confira se o <code>npm run dev</code> está rodando.</div>
            </div>
          )}
        </div>

        {transcript ? (
          <PainelTranscript />
        ) : (
          <aside className="lateral">
            <h2>Time</h2>
            {atual?.agents.map((a) => (
              <div
                className={`papel ${a.role !== 'orquestrador' && a.agentId ? 'clicavel' : ''}`}
                key={a.id}
                onClick={() => a.role !== 'orquestrador' && a.agentId && abrirTranscript(a.agentId, a.name)}
              >
                <span className="nome">{a.name}</span>
                <span className="estado" style={{ color: COR_ESTADO[a.status] }}>
                  {ROTULO_ESTADO[a.status]}
                </span>
                {a.detail && <span className="oque">{a.tool} · {a.detail}</span>}
              </div>
            )) ?? <p className="vazio">Nenhuma sessão ativa.</p>}

            <h2>Tarefas da demanda</h2>
            {atual?.tasks.length
              ? atual.tasks.map((t) => (
                  <div className={`tarefa ${t.status}`} key={t.id}>
                    <span className="marca">
                      {t.status === 'completed' ? '✓' : t.status === 'in_progress' ? '◐' : '○'}
                    </span>
                    <span className="texto">{t.subject}</span>
                  </div>
                ))
              : <p className="vazio">Nenhuma tarefa registrada nesta sessão.</p>}

            <p className="dica">Clique num bonequino para ver o que ele está pensando e fazendo.</p>
          </aside>
        )}
      </div>
    </div>
  )
}
