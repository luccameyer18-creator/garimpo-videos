# garimpo-videos

A fábrica de vídeos do **[Garimpo](https://garimpo-topaz.vercel.app)** — o garimpador de músicas
que quase ninguém ouviu, com DJ automático que dá aula e uma CDJ grátis no navegador.

Cada dia planejado (`dias/<id>.json`) vira um vídeo vertical pro TikTok em **português, espanhol
e inglês**, gravado na **tela real do app** (não é animação feita à parte):

1. **Mixagem** (`mixar-rampa.mjs`): as faixas do dia em ordem de BPM, cada uma entrando no seu
   pré-drop por cima do drop da anterior, com troca de graves e o andamento subindo devagar
   (rampa de BPM), sem corte antes do drop.
2. **Gravação da CDJ** (`gravar-app.mjs`): o Garimpo de verdade tocando a mixagem, **quadro a
   quadro com relógio virtual** (performance.now, rAF, timers, animações e o relógio do áudio),
   então o resultado é liso em qualquer máquina, com ou sem placa de vídeo. A língua da CDJ
   acompanha a do vídeo (o app tem pt, en e es).
3. **Montagem** (`gerar-hf.mjs`): [HyperFrames](https://github.com/heygen-com/hyperframes) com
   uma câmera que passeia pela CDJ, flash no drop, os ambientes do app em tela cheia, TRACK ID de
   cada faixa e o BPM ao vivo.
4. **Entrega**: `comprimir.mjs` (< 10 MB) e uma release `dia-<id>` com os três vídeos.

Tudo roda no GitHub Actions (`.github/workflows/video.yml` → "video do dia").

## Músicas

Só faixas com licença **CC BY** ou **CC BY-SA** do [Jamendo](https://www.jamendo.com) (nada de
NC/ND), sempre com crédito — título, artista e licença aparecem no vídeo e na legenda.

## Fontes

Archivo Black, Inter, Saira Semi Condensed e JetBrains Mono — todas SIL Open Font License
(licenças em `hf-molde/assets/fonts/`).
