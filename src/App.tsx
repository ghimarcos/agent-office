import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { OfficeScene } from './office/OfficeScene'
import { bus } from './office/bus'
import { useOfficeStore } from './store/useOfficeStore'
import type { AgentStatus } from './types/state'

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
  const jogo = useRef<Phaser.Game | null>(null)

  const { sessions, selectedId, connected, select, connect } = useOfficeStore()
  const atual = sessions.find((s) => s.sessionId === selectedId) ?? null

  useEffect(() => connect(), [connect])

  // Phaser sobe uma vez só.
  useEffect(() => {
    if (!palco.current || jogo.current) return
    jogo.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: palco.current,
      backgroundColor: '#120e18',
      pixelArt: true,
      audio: { noAudio: true },
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: [new OfficeScene()],
    })
    return () => { jogo.current?.destroy(true); jogo.current = null }
  }, [])

  // Cada snapshot vai pro bus; a cena consome quando estiver de pé.
  useEffect(() => {
    bus.publicar(atual?.agents ?? null)
  }, [atual])

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
          {!connected && (
            <div className="aviso">
              <div>Sem conexão com o watcher.</div>
              <div>Confira se o <code>npm run dev</code> está rodando.</div>
            </div>
          )}
        </div>

        <aside className="lateral">
          <h2>Time</h2>
          {atual?.agents.map((a) => (
            <div className="papel" key={a.id}>
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

          {atual?.agents.some((a) => a.description) && (
            <>
              <h2>Delegações</h2>
              {atual.agents.filter((a) => a.description).map((a) => (
                <div className="tarefa" key={`d-${a.id}`}>
                  <span className="marca">→</span>
                  <span className="texto"><b>{a.name}</b> · {a.description}</span>
                </div>
              ))}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}
