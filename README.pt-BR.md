<p align="center">
  <a href="https://droneclean.app/pt-br/"><img src="https://droneclean.app/media/studio-demo.webp" alt="Claude Code, à direita, editando seis clipes de drone no DroneClean Studio por meio do servidor MCP, mostrado 47 vezes mais rápido" width="100%"></a>
</p>

<h1 align="center">DroneClean Studio</h1>

<p align="center">
  <a href="README.md">English</a> &nbsp;·&nbsp;
  <a href="README.it.md">Italiano</a> &nbsp;·&nbsp;
  <a href="README.es.md">Español</a> &nbsp;·&nbsp;
  <a href="README.fr.md">Français</a> &nbsp;·&nbsp;
  <a href="README.de.md">Deutsch</a> &nbsp;·&nbsp;
  <strong>Português (Brasil)</strong> &nbsp;·&nbsp;
  <a href="README.tr.md">Türkçe</a> &nbsp;·&nbsp;
  <a href="README.ja.md">日本語</a> &nbsp;·&nbsp;
  <a href="README.ko.md">한국어</a> &nbsp;·&nbsp;
  <a href="README.zh.md">简体中文</a>
</p>

<p align="center">
  <strong>Um editor de vídeo gratuito e local-first para pilotos de FPV e de drones.</strong><br>
  Estabilização pelo giroscópio, cor D-Log M, rampas de velocidade suaves com câmera lenta por fluxo óptico e um servidor MCP para agentes de IA.
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest"><img alt="Última versão" src="https://img.shields.io/github/v/release/matteodante/droneclean-studio?label=release"></a>
  <a href="LICENSE"><img alt="Licença: GPL-3.0-or-later" src="https://img.shields.io/badge/licence-GPL--3.0--or--later-blue"></a>
  <img alt="macOS (Apple silicon), Windows e a web" src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20web-lightgrey">
</p>

<p align="center">
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-arm64.dmg"><strong>Baixar para Mac</strong></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/matteodante/droneclean-studio/releases/latest/download/DroneClean-Studio-x64.exe"><strong>Baixar para Windows</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/pt-br/studio/"><strong>Abrir no navegador</strong></a>
  &nbsp;·&nbsp;
  <a href="https://droneclean.app/pt-br/">droneclean.app</a>
</p>

O vídeo acima mostra o Claude Code editando seis clipes do DJI Avata 2 por meio do servidor MCP do editor, sem ninguém
encostar no mouse. Ele lê as batidas da música, escolhe alguns segundos de cada clipe e corta no ritmo, estabiliza tudo
com os dados do giroscópio, converte a cor D-Log M, dá a cada plano uma rampa de velocidade com câmera lenta por fluxo
óptico e desfoque de movimento, e olha os quadros para deixar de fora pessoas e carros. Os 19 minutos que levou são
mostrados 47 vezes mais rápido. Cada alteração que ele faz é um passo comum do editor, que você pode desfazer ou
continuar editando à mão.

## Antes e depois

<p align="center">
  <img src="https://droneclean.app/media/reel-before-after.webp" alt="O mesmo reel de drone lado a lado: à esquerda como foi filmado, sem contraste e tremido; à direita estabilizado, com correção de cor e rampas de velocidade no DroneClean Studio" width="488">
</p>

Os primeiros 24 segundos de um reel editado no DroneClean Studio com clipes do mesmo voo. À esquerda, os cortes como
foram filmados: cor D-Log M sem contraste, a trepidação do drone, velocidade real. À direita, a edição final:
estabilizada com os dados do giroscópio, com o D-Log M convertido e corrigido, com rampas de velocidade, câmera lenta
por fluxo óptico e desfoque de movimento.

## Recursos

- **Estabilização pelo giroscópio.** Os arquivos da DJI e da GoPro trazem o movimento da câmera; o Studio os estabiliza
  com o motor do [Gyroflow](https://github.com/gyroflow/gyroflow) compilado para WebAssembly, sem etapa de análise. Um
  clipe 4:3 em um projeto 9:16 preenche o quadro vertical sozinho, e um enquadramento animável por keyframes mantém o
  assunto à vista.
- **Cor para imagens de drone.** De DJI D-Log M e D-Log para Rec.709, looks criativos a partir de arquivos `.cube`,
  rodas de cor, curvas, qualificadores secundários, power windows e um gradiente de céu para céus lavados.
- **Velocidade.** Curvas de velocidade com trechos suavizados e uma "rampa suave + zoom" com um clique. O desfoque de
  movimento acompanha o movimento de cada pixel ao longo do fluxo óptico, e a câmera lenta cria quadros novos a partir
  dele em vez de repetir os existentes. Marcadores de batida a partir da música.
- **Keyframes** em todas as propriedades e parâmetros de efeito, com suavização bezier e de mola.
- **Exportação.** Predefinições para YouTube 4K e Instagram Reels, e masters de 10 bits (ProRes 422 HQ, HEVC Main 10) no
  app para desktop.
- **Agentes de IA.** Um servidor MCP local: o Claude, ou outro cliente MCP, pode montar, corrigir a cor e exportar um
  projeto pelo mesmo SDK que o editor usa, e cada alteração é um passo que pode ser desfeito.
- **Remoção da sombra do drone**, o único efeito pago, pelo serviço em nuvem do DroneClean.
- **Local-first.** Projetos e mídia ficam em uma pasta que você escolhe; as imagens só saem do seu computador quando
  você envia um trecho para limpar a sombra.

<p align="center">
  <img src=".github/assets/studio.webp" alt="O editor DroneClean Studio com um clipe de praia na linha do tempo e a sombra de um drone marcada na imagem" width="820">
</p>

## Instalação

**Mac (Apple silicon):** baixe a imagem de disco da [última versão](../../releases/latest) e arraste o
DroneClean Studio para Aplicativos. Esta versão ainda não é assinada pela Apple, então o macOS a bloqueia na primeira
vez: abra-a uma vez, depois vá em Ajustes do Sistema › Privacidade e Segurança e clique em **Abrir Mesmo Assim**.

**Windows 10 e 11 (x64):** baixe o `DroneClean-Studio-x64.exe` da [última versão](../../releases/latest) e execute-o;
ele é instalado para o seu usuário, sem pedir privilégios de administrador. Ainda não é assinado, então o SmartScreen o
bloqueia na primeira vez: escolha **Mais informações › Executar assim mesmo**. Ele traz o seu próprio FFmpeg com
codificadores NVIDIA, Intel e AMD.

**Navegador:** [droneclean.app/studio](https://droneclean.app/pt-br/studio/) executa o mesmo editor no Chrome ou no Edge
em um computador (precisa da File System Access API).

## Use com um agente de IA

O acesso de agentes vem ativado por padrão no app para desktop (só o seu usuário consegue acessá-lo; **Configurações ›
Acesso de agentes › Permitir agentes de IA** o desativa), e esse painel mostra o comando exato. Para o Claude Code em
um Mac:

```sh
claude mcp add droneclean -- "/Applications/DroneClean Studio.app/Contents/Resources/mcp/droneclean-mcp"
```

No Windows, o comando aponta para
`%LOCALAPPDATA%\Programs\DroneClean Studio\resources\mcp\droneclean-mcp.cmd` (o painel mostra com o caminho do seu
usuário).

O servidor tem quatro ferramentas: `search` (a referência do SDK, o guia do usuário e o mapa de recursos), `run` (um
script sobre o SDK do editor), `frame` (um quadro renderizado ou uma folha de contatos) e `export`. Depois, peça uma
edição com as suas próprias palavras, como no vídeo acima: "faça uma edição suave de drone com os seis clipes do
projeto aberto, cortando no ritmo da música".

## Compilar a partir do código-fonte

macOS em Apple silicon, Node 24, Rust com o target `wasm32-unknown-unknown`, `wasm-bindgen-cli` 0.2.130 e
`wasm-opt` (Binaryen).

```sh
cd studio && npm ci && cd desktop && npm ci
npm run package        # o editor, o wasm do Gyroflow e o FFmpeg, depois o app em dist/mac-arm64
```

Em `studio/`, `npm run check:quick` executa as verificações rápidas e `npm run verify` o conjunto completo (precisa do
Google Chrome e do FFmpeg).

## Estrutura do repositório

| Caminho | O que é |
| --- | --- |
| `studio/` | O editor, um fork do [FreeCut](https://github.com/walterlow/freecut) (MIT). O código próprio do DroneClean está em `studio/src/studio/`. |
| `studio/desktop/` | O app Electron, o seu build do FFmpeg e o script de lançamento. |
| `studio/mcp/` | O inicializador MCP que um agente executa. |
| `studio/web/` | O servidor estático do editor web. |
| `gyroflow/` | Um fork do [Gyroflow](https://github.com/gyroflow/gyroflow) (GPL-3.0); `gyroflow/wasm/` compila o motor dele para o editor. |

Este repositório é publicado pelo processo de lançamento: cada versão é um único commit, com a tag `v0.1.9` para
esta.

## Contribuição e segurança

Relatos de bugs e ideias são bem-vindos: [abra uma issue](../../issues/new/choose). O [CONTRIBUTING.md](CONTRIBUTING.md)
explica como as mudanças chegam a uma versão. Informe uma vulnerabilidade em particular, como o
[SECURITY.md](SECURITY.md) descreve, nunca em uma issue pública.

## Licença e créditos

GPL-3.0-or-later (veja [LICENSE](LICENSE)). O DroneClean Studio inclui o FreeCut (MIT) e o Gyroflow (GPL-3.0); o app
para desktop inclui o FFmpeg (LGPL-2.1), compilado a partir do código-fonte oficial por
`studio/desktop/scripts/build-ffmpeg.sh`. A captura de tela mostra o vídeo 39579103 do Pexels sob a
[Licença do Pexels](https://www.pexels.com/license/). A demonstração e o antes e depois mostram as imagens do DJI
Avata 2 do próprio autor; elas são servidas pelo droneclean.app e não fazem parte deste repositório nem da sua
licença.
