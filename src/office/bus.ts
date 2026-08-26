// Canal entre o React e a cena Phaser.
// Não usa os eventos do Phaser de propósito: `scene.events` só existe depois que o
// SceneManager sobe a cena, e o primeiro snapshot costuma chegar antes disso.
import type { OfficeAgent } from '@/types/state'

type Ouvinte = (agents: OfficeAgent[] | null) => void
type OuvinteClique = (agent: OfficeAgent) => void

let ultimo: OfficeAgent[] | null = null
const ouvintes = new Set<Ouvinte>()
let aoClicarAgente: OuvinteClique | null = null

export const bus = {
  publicar(agents: OfficeAgent[] | null) {
    ultimo = agents
    for (const o of ouvintes) o(agents)
  },
  /** Um bonequino foi clicado na cena. */
  clicar(agent: OfficeAgent) { aoClicarAgente?.(agent) },
  aoClicar(fn: OuvinteClique) { aoClicarAgente = fn },

  /** Assina e já recebe o último estado conhecido, se houver. */
  assinar(o: Ouvinte): () => void {
    ouvintes.add(o)
    if (ultimo) o(ultimo)
    return () => { ouvintes.delete(o) }
  },
}
