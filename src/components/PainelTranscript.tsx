import { useEffect } from 'react'
import { useOfficeStore } from '@/store/useOfficeStore'

const ROTULO: Record<string, string> = {
  prompt: 'o que foi pedido a ele',
  pensando: 'pensando',
  texto: 'resposta',
  ferramenta: 'ferramenta',
  resultado: 'resultado',
}

export function PainelTranscript() {
  const { transcript, carregandoTranscript, fecharTranscript, abrirTranscript } = useOfficeStore()

  // Enquanto o painel estiver aberto, recarrega para acompanhar ao vivo.
  useEffect(() => {
    if (!transcript) return
    const t = setInterval(() => abrirTranscript(transcript.agentId, transcript.nome), 2000)
    return () => clearInterval(t)
  }, [transcript?.agentId, abrirTranscript])

  if (!transcript) return null

  return (
    <aside className="lateral transcript">
      <div className="transcript-topo">
        <h2>{transcript.nome}</h2>
        <button className="fechar" onClick={fecharTranscript}>✕</button>
      </div>

      {carregandoTranscript && !transcript.entradas.length && <p className="vazio">Lendo o transcript…</p>}
      {!carregandoTranscript && !transcript.entradas.length && (
        <p className="vazio">Nada registrado ainda para este especialista.</p>
      )}

      {transcript.entradas.map((e, i) => (
        <div className={`entrada ${e.tipo}`} key={i}>
          <span className="rotulo">{ROTULO[e.tipo] ?? e.tipo}</span>
          <div className="texto">{e.texto}</div>
          {e.detalhe && <pre className="detalhe">{e.detalhe}</pre>}
        </div>
      ))}
    </aside>
  )
}
