import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useOfficeStore } from '@/store/useOfficeStore'
import type { EntradaTranscript } from '@/types/state'

const ROTULO: Record<string, string> = {
  pensando: 'pensando',
  texto: 'resposta',
  ferramenta: 'ferramenta',
  resultado: 'resultado',
}

/** O briefing fica preso no topo — é contexto, não atividade. */
function Briefing({ texto }: { texto: string }) {
  const [aberto, setAberto] = useState(false)
  return (
    <div className={`briefing ${aberto ? 'aberto' : ''}`}>
      <button className="briefing-cabeca" onClick={() => setAberto(!aberto)}>
        {aberto ? '▾' : '▸'} o que foi pedido a ele
      </button>
      {aberto && <div className="briefing-corpo">{texto}</div>}
    </div>
  )
}

export function PainelTranscript() {
  const { transcript, carregandoTranscript, fecharTranscript, abrirTranscript } = useOfficeStore()
  const fluxo = useRef<HTMLDivElement>(null)
  const alturaAnterior = useRef(0)

  const agentId = transcript?.agentId
  const nome = transcript?.nome

  // Recarrega em silêncio para acompanhar ao vivo, sem derrubar a lista.
  useEffect(() => {
    if (!agentId || !nome) return
    const t = setInterval(() => abrirTranscript(agentId, nome, true), 2000)
    return () => clearInterval(t)
  }, [agentId, nome, abrirTranscript])

  // Itens novos entram por cima. Sem isso, cada chegada empurrava o conteúdo
  // pra baixo e a linha que você estava lendo fugia da tela.
  useLayoutEffect(() => {
    const el = fluxo.current
    if (!el) return
    const delta = el.scrollHeight - alturaAnterior.current
    if (alturaAnterior.current && delta > 0 && el.scrollTop > 0) el.scrollTop += delta
    alturaAnterior.current = el.scrollHeight
  }, [transcript?.entradas.length])

  // Troca de especialista recomeça a medição.
  useEffect(() => { alturaAnterior.current = 0 }, [agentId])

  if (!transcript) return null

  const prompt = transcript.entradas.find((e) => e.tipo === 'prompt')
  // Cronológico vira mais-recente-primeiro; a chave sai do índice original
  // para não trocar de identidade quando a lista cresce.
  const atividade = transcript.entradas
    .map((e, i) => ({ e, i }))
    .filter(({ e }) => e.tipo !== 'prompt')
    .reverse()

  const vazio = !carregandoTranscript && !atividade.length

  return (
    <aside className="lateral transcript">
      <div className="transcript-topo">
        <h2>{transcript.nome}</h2>
        <button className="fechar" onClick={fecharTranscript}>✕</button>
      </div>

      {prompt && <Briefing texto={prompt.texto} />}

      <div className="transcript-fluxo" ref={fluxo}>
        {carregandoTranscript && !atividade.length && <p className="vazio">Lendo o transcript…</p>}
        {vazio && <p className="vazio">Nada registrado ainda para este especialista.</p>}

        {atividade.map(({ e, i }, pos) => (
          <Entrada key={i} entrada={e} agora={pos === 0} />
        ))}
      </div>
    </aside>
  )
}

function Entrada({ entrada, agora }: { entrada: EntradaTranscript; agora: boolean }) {
  return (
    <div className={`entrada ${entrada.tipo} ${agora ? 'agora' : ''}`}>
      <span className="rotulo">
        {agora && <i className="pulso" />}
        {ROTULO[entrada.tipo] ?? entrada.tipo}
      </span>
      <div className="texto">{entrada.texto}</div>
      {entrada.detalhe && <pre className="detalhe">{entrada.detalhe}</pre>}
    </div>
  )
}
