// Adaptado de opensquad (MIT) — https://github.com/renatoasse/opensquad
// Mudanças: renderiza o time de programação (orquestrador/arquiteto/dev/qa),
// atualiza sprites no lugar de recriar a cena a cada snapshot, e o avatar
// de cada papel é estável entre atualizações.
import Phaser from 'phaser'
import {
  CHARACTER_NAMES, MALE_CHARACTERS, FEMALE_CHARACTERS, avatarKeys, avatarPath,
  DESK_PATHS, FURNITURE_PATHS, type CharacterName,
} from './assetKeys'
import { CELL_W, CELL_H, MARGIN, WALL_H } from './palette'
import { RoomBuilder } from './RoomBuilder'
import { AgentSprite } from './AgentSprite'
import type { OfficeAgent } from '@/types/state'
import { bus } from './bus'

/** Escritório vazio — o que aparece antes de qualquer demanda. */
const TIME_PARADO: OfficeAgent[] = [
  { id: 'orquestrador', role: 'orquestrador', name: 'Orquestrador', status: 'idle', gender: 'male', desk: { col: 1, row: 1 } },
  { id: 'arquiteto', role: 'arquiteto', name: 'Arquiteto', status: 'idle', gender: 'female', desk: { col: 2, row: 1 } },
  { id: 'dev', role: 'dev', name: 'Dev', status: 'idle', gender: 'male', desk: { col: 1, row: 2 } },
  { id: 'qa', role: 'qa', name: 'QA', status: 'idle', gender: 'female', desk: { col: 2, row: 2 } },
]

/** Avatar fixo por papel — o mesmo bonequino sempre no mesmo cargo. */
function assignCharacters(agents: OfficeAgent[]): Map<string, CharacterName> {
  const map = new Map<string, CharacterName>()
  let m = 0, f = 0
  for (const a of agents) {
    if (a.gender === 'male') map.set(a.id, MALE_CHARACTERS[m++ % MALE_CHARACTERS.length])
    else map.set(a.id, FEMALE_CHARACTERS[f++ % FEMALE_CHARACTERS.length])
  }
  return map
}

export class OfficeScene extends Phaser.Scene {
  private sprites = new Map<string, AgentSprite>()
  private roomBuilder!: RoomBuilder
  /** Assinatura do elenco atual — só reconstrói a sala quando ela muda. */
  private layoutKey = ''
  private desassinar?: () => void

  constructor() { super({ key: 'OfficeScene' }) }

  preload(): void {
    for (const [key, p] of Object.entries(DESK_PATHS)) this.load.image(key, p)
    for (const [key, p] of Object.entries(FURNITURE_PATHS)) this.load.image(key, p)
    for (const name of CHARACTER_NAMES) {
      const k = avatarKeys(name)
      this.load.image(k.blink, avatarPath(name, 'blink'))
      this.load.image(k.talk, avatarPath(name, 'talk'))
      this.load.image(k.wave1, avatarPath(name, 'wave1'))
      this.load.image(k.wave2, avatarPath(name, 'wave2'))
    }
    this.load.on('loaderror', (file: Phaser.Loader.File) => {
      console.error(
        `[agent-office] asset faltando: ${file.url}\n` +
        'Rode `npm run setup:assets` — os sprites não são versionados.',
      )
    })
  }

  create(): void {
    Object.values(this.textures.list).forEach((tex) => {
      if (tex.key !== '__DEFAULT' && tex.key !== '__MISSING') {
        tex.setFilter(Phaser.Textures.FilterMode.NEAREST)
      }
    })
    this.roomBuilder = new RoomBuilder(this)
    this.render(TIME_PARADO)
    this.desassinar = bus.assinar((agents) => {
      this.render(agents?.length ? agents : TIME_PARADO)
    })
    this.events.once('shutdown', () => this.desassinar?.())
    // Redesenha o tempo decorrido mesmo sem snapshot novo.
    this.time.addEvent({ delay: 1000, loop: true, callback: () => this.refreshTimers() })
  }

  private refreshTimers(): void {
    for (const [id, sprite] of this.sprites) {
      const a = this.current.find((x) => x.id === id)
      if (a) sprite.update(a)
    }
  }

  private current: OfficeAgent[] = []

  private render(agents: OfficeAgent[]): void {
    this.current = agents
    const key = agents.map((a) => a.id).join('|')

    // Mesmo elenco: só atualiza os sprites, sem piscar a tela.
    if (key === this.layoutKey && this.sprites.size) {
      for (const a of agents) this.sprites.get(a.id)?.update(a)
      return
    }
    this.layoutKey = key

    let maxCol = 0, maxRow = 0
    for (const a of agents) {
      maxCol = Math.max(maxCol, a.desk.col)
      maxRow = Math.max(maxRow, a.desk.row)
    }

    const cellW = CELL_W + 64
    const cellH = CELL_H + 90
    const roomW = Math.max(maxCol * cellW + MARGIN * 2, 580)
    const roomH = maxRow * cellH + MARGIN * 2 + WALL_H + CELL_H + 48

    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()
    this.children.removeAll(true)

    this.roomBuilder.build(roomW, roomH)

    const chars = assignCharacters(agents)
    agents.forEach((a, i) => {
      const x = (a.desk.col - 1) * cellW + MARGIN + cellW / 2
      const y = (a.desk.row - 1) * cellH + MARGIN + WALL_H + cellH / 2
      this.sprites.set(a.id, new AgentSprite(this, x, y, chars.get(a.id)!, i % 2 === 0 ? 'black' : 'white', a))
    })

    const cam = this.cameras.main
    cam.setZoom(Math.min(cam.width / (roomW + 32), cam.height / (roomH + 32), 2))
    cam.centerOn(roomW / 2, roomH / 2)
  }
}
