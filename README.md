# Agent Office

Escritório 2D em tempo real para o seu time de agentes do Claude Code.

Cada especialista tem uma mesa. Quando o Claude Code delega uma etapa, o bonequino
correspondente acende a tela e mostra o que está fazendo agora — a ferramenta, o
arquivo e há quanto tempo.

O painel é **somente visualização**: você comanda o time pela sua sessão do Claude
Code no terminal, e acompanha aqui. **Clicar num bonequino** abre o que aquele
especialista recebeu, está pensando e está fazendo, ao vivo.

```
┌─ Orquestrador ─┐  ┌─ Arquiteto ─┐
│ ◐ trabalhando  │  │ ● concluído │
│ Delega · dev   │  │ Grep · Nfe  │
└────────────────┘  └─────────────┘
┌─ Dev ──────────┐  ┌─ QA ────────┐
│ ◐ trabalhando  │  │ ○ aguardando│
│ Edit · NfeSer… │  │             │
└────────────────┘  └─────────────┘
```

## Como funciona

### O escritório

Não há integração, webhook nem daemon. O painel lê o que o Claude Code já grava
no disco, em `~/.claude`:

| Fonte | O que entrega |
|---|---|
| `claude agents --json --all` | sessões vivas, projeto, status |
| `projects/<slug>/<sessão>/subagents/*.meta.json` | qual especialista foi acionado e para quê |
| o `.jsonl` irmão de cada subagent | ferramenta em uso, arquivo, timestamp |
| `tasks/<sessão>/*.json` | lista de tarefas da demanda |
| `~/.claude/projetos.json` | pastas e portas de cada projeto — alimenta o seletor do chat e os indicadores do topo |

Clicar num bonequino lê o `.jsonl` daquele subagent por inteiro e mostra, em ordem:
o prompt que o Orquestrador delegou, cada bloco de raciocínio e cada ferramenta
usada. Atualiza a cada 2 s enquanto o painel estiver aberto.

Um plugin do Vite (`src/watcher/claudeWatcher.ts`) consolida tudo a cada 1,5 s e
empurra por WebSocket. A cena é Phaser 3.

## Instalação

```bash
npm install
npm run setup:assets -- /caminho/para/os/sprites   # veja "Sprites" abaixo
npm run dev
```

Abre em `http://localhost:4300`.

## Sprites

**A arte não está neste repositório.** Os sprites vêm do pacote
[Modern Interiors, da LimeZu](https://limezu.itch.io/moderninteriors), cuja licença
permite usar em projeto comercial ou não **mas proíbe redistribuir os arquivos**.

Baixe o pacote e rode `npm run setup:assets -- <pasta>`. O script explica a
estrutura esperada se você rodar sem argumento.

## Os papéis

Os quatro papéis padrão vêm dos subagents definidos em `~/.claude/agents/`:

| Mesa | Subagent | Papel |
|---|---|---|
| Orquestrador | *(a sessão principal)* | recebe a demanda, delega, compila a entrega |
| Arquiteto | `arquiteto` | critica a solução e caça regressão antes do código |
| Dev | `dev` | escreve o código |
| QA | `qa` | testa build, testes e a tela no navegador |

Qualquer outro subagent que aparecer na sessão (`Explore`, `general-purpose`, …)
ganha uma mesa extra automaticamente.

## Privacidade

Este repositório não contém nada sobre a máquina de quem o usa. O registro de
projetos — caminhos, portas, pastas de migration — mora em `~/.claude/projetos.json`,
**fora do repositório**, e o `.gitignore` bloqueia qualquer cópia dele, além de
`.env`, chaves, `settings.local.json` e imagens (uma captura de tela mostra nome de
projeto, branch e caminho sem você perceber).

As regras aprovadas com *Sempre permitir* são gravadas no `.claude/settings.local.json`
**do projeto onde você está trabalhando**, nunca aqui.

## Créditos

- Escritório 2D, `RoomBuilder`, `AgentSprite` e `assetKeys` adaptados de
  [opensquad](https://github.com/renatoasse/opensquad), de Renato Asse (MIT).
  O opensquad orquestra squads de mídia; aqui a camada de dados foi reescrita
  para ler o Claude Code e o time é de programação.
- Arte: [LimeZu](https://limezu.itch.io/moderninteriors) — não redistribuída.

## Licença

MIT. Veja [LICENSE](./LICENSE), incluindo a nota sobre os sprites.
