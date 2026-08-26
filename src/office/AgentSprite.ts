// Adaptado de opensquad (MIT) — https://github.com/renatoasse/opensquad
// Mudanças: rótulos em português, linha de detalhe ao vivo (ferramenta · arquivo · tempo),
// e a mesa só mostra a tela "coding" quando o especialista está de fato trabalhando.
import Phaser from 'phaser'
import { avatarKeys, DESK_KEYS, FURNITURE_KEYS, type CharacterName } from './assetKeys'
import { COLORS } from './palette'
import type { OfficeAgent, AgentStatus } from '@/types/state'

const AVATAR_SCALE = 0.8

const STATUS_COLORS: Record<AgentStatus, number> = {
  idle: COLORS.statusIdle,
  working: COLORS.statusWorking,
  done: COLORS.statusDone,
  checkpoint: COLORS.statusCheckpoint,
  delivering: COLORS.statusWorking,
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'aguardando',
  working: 'trabalhando',
  done: 'concluído',
  checkpoint: 'pensando',
  delivering: 'entregando',
}

/** "Edit · NfeService.java · 1m12s" */
function detailLine(agent: OfficeAgent): string {
  if (agent.status === 'idle') return ''
  const parts: string[] = []
  if (agent.tool) parts.push(agent.tool)
  if (agent.detail) parts.push(agent.detail.length > 16 ? agent.detail.slice(0, 15) + '…' : agent.detail)
  if (agent.since) {
    const secs = Math.max(0, Math.round((Date.now() - new Date(agent.since).getTime()) / 1000))
    parts.push(secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m${String(secs % 60).padStart(2, '0')}s`)
  }
  return parts.join(' · ')
}

export class AgentSprite {
  private scene: Phaser.Scene
  private deskTable: Phaser.GameObjects.Image
  private desk: Phaser.GameObjects.Image
  private coffeeMug: Phaser.GameObjects.Image
  private avatar: Phaser.GameObjects.Image
  private nameText: Phaser.GameObjects.Text
  private badgeBg: Phaser.GameObjects.Graphics
  private statusDot: Phaser.GameObjects.Graphics
  private statusText: Phaser.GameObjects.Text
  private detailText: Phaser.GameObjects.Text
  private animTimer?: Phaser.Time.TimerEvent
  private agent: OfficeAgent
  private characterName: CharacterName
  private deskVariant: 'black' | 'white'
  private avatarDisplayH = 0
  private labelX: number
  private labelY: number

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    characterName: CharacterName,
    deskVariant: 'black' | 'white',
    agent: OfficeAgent,
  ) {
    this.scene = scene
    this.agent = agent
    this.characterName = characterName
    this.deskVariant = deskVariant
    this.labelX = x
    this.labelY = y - 150

    this.avatar = scene.add.image(x, y - 70, avatarKeys(characterName).talk)
      .setOrigin(0.5, 0.5).setScale(AVATAR_SCALE).setDepth(y)
    this.avatarDisplayH = this.avatar.displayHeight

    this.deskTable = scene.add.image(x, y, FURNITURE_KEYS.deskWood)
      .setOrigin(0.5, 0.5).setScale(1.3).setDepth(y + 1)

    this.desk = scene.add.image(x, y - 30, this.getDeskKey(agent.status))
      .setOrigin(0.5, 0.5).setScale(1.3).setDepth(y + 2)

    this.coffeeMug = scene.add.image(x + 42, y + 8, FURNITURE_KEYS.coffeeMug)
      .setOrigin(0.5, 1).setScale(1.4).setDepth(y + 3)

    const font = '"Segoe UI", "Helvetica Neue", Arial, sans-serif'

    this.badgeBg = scene.add.graphics()

    this.nameText = scene.add.text(x, this.labelY + 5, agent.name, {
      fontFamily: font, fontSize: '16px', fontStyle: 'bold',
      color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4, resolution: 2,
    }).setOrigin(0.5, 0).setDepth(901)

    this.statusText = scene.add.text(x, this.labelY + 24, STATUS_LABELS[agent.status], {
      fontFamily: font, fontSize: '13px', fontStyle: 'bold',
      color: this.hex(agent.status), align: 'center', stroke: '#000000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 0).setDepth(901)

    this.detailText = scene.add.text(x, this.labelY + 42, detailLine(agent), {
      fontFamily: font, fontSize: '11px',
      color: '#c9bede', align: 'center', stroke: '#000000', strokeThickness: 3, resolution: 2,
    }).setOrigin(0.5, 0).setDepth(901)

    this.statusDot = scene.add.graphics()
    this.redrawLabel()
    this.startAnimation(agent.status)
  }

  private hex(status: AgentStatus): string {
    return '#' + (STATUS_COLORS[status] ?? COLORS.statusIdle).toString(16).padStart(6, '0')
  }

  /** Tela acesa só quando está trabalhando de verdade. */
  private getDeskKey(status: AgentStatus): string {
    const working = status === 'working' || status === 'delivering'
    if (this.deskVariant === 'black') return working ? DESK_KEYS.blackCoding : DESK_KEYS.blackIdle
    return working ? DESK_KEYS.whiteCoding : DESK_KEYS.whiteIdle
  }

  private redrawLabel(): void {
    const x = this.labelX
    const y = this.labelY
    const hasDetail = this.detailText.text.length > 0
    const w = Math.max(this.nameText.width, this.statusText.width + 18, this.detailText.width) + 22
    const h = hasDetail ? 62 : 44

    this.badgeBg.clear()
    this.badgeBg.fillStyle(0x1a1225, 0.95)
    this.badgeBg.fillRoundedRect(x - w / 2, y, w, h, 5)
    this.badgeBg.lineStyle(1, 0x6a5a80, 0.4)
    this.badgeBg.strokeRoundedRect(x - w / 2, y, w, h, 4)
    this.badgeBg.setDepth(900)

    this.statusDot.clear()
    const textW = Math.max(this.statusText.width, 24)
    this.statusDot.fillStyle(STATUS_COLORS[this.agent.status] ?? COLORS.statusIdle, 1)
    this.statusDot.fillCircle(x - textW / 2 - 5, this.statusText.y + this.statusText.height / 2, 3)
    this.statusDot.setDepth(901)
  }

  private setAvatarFrame(key: string): void {
    this.avatar.setTexture(key)
    this.avatar.setScale(this.avatarDisplayH / this.avatar.height)
  }

  /** Trabalhando pisca rápido; parado quase não se mexe. */
  private startAnimation(status: AgentStatus): void {
    const keys = avatarKeys(this.characterName)
    const working = status === 'working' || status === 'delivering'
    let frame = 0
    this.animTimer = this.scene.time.addEvent({
      delay: working ? 420 : 1800,
      loop: true,
      callback: () => {
        frame = (frame + 1) % 2
        this.setAvatarFrame(frame === 0 ? keys.talk : keys.blink)
      },
    })
  }

  /** Chamado a cada snapshot — atualiza status e a linha de detalhe. */
  update(agent: OfficeAgent): void {
    const statusChanged = this.agent.status !== agent.status
    this.agent = agent

    if (statusChanged) {
      this.desk.setTexture(this.getDeskKey(agent.status))
      this.statusText.setText(STATUS_LABELS[agent.status])
      this.statusText.setColor(this.hex(agent.status))
      this.animTimer?.destroy()
      this.startAnimation(agent.status)
    }

    const line = detailLine(agent)
    if (line !== this.detailText.text) this.detailText.setText(line)
    this.redrawLabel()
  }

  destroy(): void {
    this.animTimer?.destroy()
    this.deskTable.destroy()
    this.desk.destroy()
    this.coffeeMug.destroy()
    this.avatar.destroy()
    this.nameText.destroy()
    this.badgeBg.destroy()
    this.statusDot.destroy()
    this.statusText.destroy()
    this.detailText.destroy()
  }
}
