#!/usr/bin/env node
/**
 * Instala os sprites do escritório em public/assets/.
 *
 * A arte NÃO é versionada: ela vem do pacote Modern Interiors da LimeZu,
 * cuja licença permite usar em projeto comercial ou não, mas proíbe
 * redistribuir os arquivos. Cada pessoa instala a sua cópia.
 *
 *   node scripts/setup-assets.mjs <pasta-com-os-assets>
 *
 * A pasta de origem precisa ter as subpastas avatars/, desks/ e furniture/.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const destino = path.join(raiz, 'public', 'assets')
const esperadas = ['avatars', 'desks', 'furniture']
const origem = process.argv[2]

function instrucoes() {
  console.log(`
Os sprites não vêm no repositório — são arte de terceiro.

  1. Baixe o pacote Modern Interiors (LimeZu):
       https://limezu.itch.io/moderninteriors

  2. Monte uma pasta com estas subpastas:
       avatars/     Male1..4 e Female1..6 nas poses _talk, _blink, _wave
       desks/       desktop_set_{black,white}_{down,up}[_coding]
       furniture/   mobília da sala (desk_wood, coffee_mug, plantas, tapetes…)

  3. Rode:
       npm run setup:assets -- /caminho/para/a/pasta

Já tem um clone do opensquad? Ele traz o mesmo conjunto:
    npm run setup:assets -- ../opensquad/dashboard/public/assets
`)
}

if (!origem) {
  instrucoes()
  process.exit(1)
}

const abs = path.resolve(origem)
const faltando = esperadas.filter((d) => !fs.existsSync(path.join(abs, d)))
if (faltando.length) {
  console.error(`Faltam subpastas em ${abs}: ${faltando.join(', ')}\n`)
  instrucoes()
  process.exit(1)
}

fs.mkdirSync(destino, { recursive: true })
let total = 0
for (const sub of esperadas) {
  fs.cpSync(path.join(abs, sub), path.join(destino, sub), { recursive: true })
  total += fs.readdirSync(path.join(destino, sub)).length
}

console.log(`${total} sprites instalados em public/assets/`)
console.log('Créditos da arte: LimeZu — https://limezu.itch.io/moderninteriors')
