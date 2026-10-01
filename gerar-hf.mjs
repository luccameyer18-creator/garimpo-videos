// Monta o vídeo "N drops no Garimpo" no HyperFrames a partir do dia (dias/<id>.json), da régua
// da mixagem (saida/<id>/mix.json — BPM fixo ou rampa de BPM) e da gravação REAL do app
// (gravar-app.mjs → saida/<id>/app-cdj-<idioma>.mp4, 1600×900 CSS a 2,4×).
//
// A gravação é uma tomada contínua; aqui vira vídeo em pé com uma câmera que nunca para:
// CDJ inteira → onda do deck A → empurra tremendo até o drop → flash + RGB → o ambiente do app
// (pista aberta / viagem) em tela cheia com pulso no bumbo → na passagem: mixer → deck que entra
// → close no mixer com "✂️ corta o grave" preso no botão real → … → pergunta "qual foi o melhor?"
// ainda no ambiente, e a CDJ inteira volta com a marca. O selo do canto mostra o BPM AO VIVO
// (sobe junto com a rampa). Textos em pt, es ou en (IDIOMA).
//
// Tudo que se mexe é função pura do tempo (motor com setter, seguro no seek do HyperFrames).
// Uso: [IDIOMA=es] node gerar-hf.mjs dias/<id>.json [pasta do projeto]
//      → projeto (padrão ../hyperframes/garimpo-<id>-<idioma>) com index.html e assets
import { readFileSync, writeFileSync, copyFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const IDIOMA = process.env.IDIOMA || 'pt';
const PROJ = process.argv[3] || join(AQUI, 'projetos', `garimpo-${cfg.id}-${IDIOMA}`);
const MOLDE = join(AQUI, 'hf-molde');
const saida = join(AQUI, 'saida', cfg.id);
const RECT = JSON.parse(readFileSync(join(AQUI, 'app', 'rects-1600.json'), 'utf8'));
// a versão leve (3200×1800, fastdecode) quando existe: a 4K cheia (~600 MB com a viagem Full HD)
// estourava o tempo da extração de quadros do render ("VIDEO_EXTRACTION_FAILED; ffmpeg_timeout")
const VIDEO = [`app-cdj-${IDIOMA}-leve`, `app-cdj-${IDIOMA}`, 'app-cdj'].find((v) => existsSync(join(saida, v + '.mp4')));
if (existsSync(join(saida, VIDEO + '.json'))) {
  const grav = JSON.parse(readFileSync(join(saida, VIDEO + '.json'), 'utf8'));
  if (grav.tela !== '1600x900@2.4') console.warn('atenção: gravação em', grav.tela, '(a câmera supõe 1600×900 CSS)');
}

// ───────────── régua (segundos) ─────────────
const NF = cfg.faixas.length;
const DROPS = cfg.drops, FIMC = cfg.fimComp;
const RG = (() => {
  const mj = JSON.parse(readFileSync(join(saida, 'mix.json'), 'utf8'));
  if (mj.rampa) return mj;
  const BPM = cfg.bpmSet || 124, T = 60 / BPM, NB = FIMC * 4;
  return {
    batidas: Array.from({ length: NB + 1 }, (_, b) => b * T), tempos: new Array(NB).fill(BPM), fim_s: NB * T,
    faixas: cfg.faixas.map((f, i) => ({ entrada_s: (DROPS[i] - 4) * 4 * T, drop_s: DROPS[i] * 4 * T,
      grave_sai_s: i < NF - 1 ? (DROPS[i + 1] - 1) * 4 * T : null })),
  };
})();
const BAT = RG.batidas;
const tBar = (k) => { const b = 4 * k, i = Math.max(0, Math.min(BAT.length - 2, Math.floor(b))); return BAT[i] + (BAT[i + 1] - BAT[i]) * (b - i); };
const DUR = RG.fim_s;
const D = RG.faixas.map((f) => f.drop_s);
const E = RG.faixas.map((f) => f.entrada_s);
const G = RG.faixas.map((f) => f.grave_sai_s);
const FIM_AMB = D.map((_, i) => (i < NF - 1 ? E[i + 1] : tBar(FIMC - 2)));   // a CDJ volta
const Q = tBar(DROPS[NF - 1] + 4);                                       // entra a pergunta
const segIni = (i) => tBar(DROPS[i] - 2);                                // "segura" 2 compassos antes
const AMB = cfg.ambientes || cfg.faixas.map((_, i) => (i % 2 ? 'viagem' : 'pista'));
const f3 = (n) => +(+n).toFixed(3);
const bpmMin = Math.round(Math.min(...cfg.faixas.map((f) => f.bpm))), bpmMax = Math.round(Math.max(...cfg.faixas.map((f) => f.bpm)));
const rampa = bpmMax - bpmMin >= 3;

// ───────────── textos por língua ─────────────
const nums = (n, e) => Array.from({ length: n }, (_, i) => i + 1).join(', ').replace(/, (\d+)$/, ` ${e} $1`);
const GEN = (cfg.genero || 'techno').toUpperCase();
const TXT = {
  pt: {
    g1: `${NF} drops de`, g3: 'que quase ninguém ouviu',
    pilula: rampa ? `${bpmMin} → ${bpmMax} BPM no Garimpo 👆` : 'mixando no Garimpo 👆',
    selo: `⚡ ${cfg.genero || 'techno'} · ${NF} drops`,
    novo: '✨ NOVO: viagem Full HD ao vivo', pista: '🎉 modo pista',
    mix: ['mixando a 2…', 'agora a 3…', 'vem a 4…', 'a 5 sobe o BPM… 🔺', 'vem a 6…'],
    segura: (n) => [`segura o ${n}…`], pesada: ['segura que essa', 'é a mais pesada 🔥'],
    corte: (n) => `✂️ corta o grave da ${n}`,
    fim: ['qual foi o melhor?', `${nums(NF, 'ou')} 👇`], desc: 'CDJ grátis no navegador', link: '📌 link no comentário',
  },
  es: {
    g1: `${NF} drops de`, g3: 'que casi nadie escuchó',
    pilula: rampa ? `${bpmMin} → ${bpmMax} BPM en Garimpo 👆` : 'mezclando en Garimpo 👆',
    selo: `⚡ ${cfg.genero || 'techno'} · ${NF} drops`,
    novo: '✨ NUEVO: visuales Full HD en vivo', pista: '🎉 modo pista',
    mix: ['mezclando el 2…', 'ahora el 3…', 'viene el 4…', 'el 5 sube el BPM… 🔺', 'viene el 6…'],
    segura: (n) => [`aguanta el ${n}…`], pesada: ['aguanta que este', 'es el más pesado 🔥'],
    corte: (n) => `✂️ corta el bajo del ${n}`,
    fim: ['¿cuál fue el mejor?', `${nums(NF, 'o')} 👇`], desc: 'CDJ gratis en el navegador', link: '📌 link en los comentarios',
  },
  en: {
    g1: `${NF} drops of`, g3: 'almost nobody has heard',
    pilula: rampa ? `${bpmMin} → ${bpmMax} BPM on Garimpo 👆` : 'mixed on Garimpo 👆',
    selo: `⚡ ${cfg.genero || 'techno'} · ${NF} drops`,
    novo: '✨ NEW: live Full HD visuals', pista: '🎉 club mode',
    mix: ['mixing in #2…', 'now #3…', 'here comes #4…', '#5 pushes the BPM… 🔺', 'here comes #6…'],
    segura: (n) => [`wait for drop ${n}…`], pesada: ['wait for it,', "this one's the heaviest 🔥"],
    corte: (n) => `✂️ cutting the bass of #${n}`,
    fim: ['which one was the best?', `${nums(NF, 'or')} 👇`], desc: 'free DJ app in your browser', link: '📌 link in the comments',
  },
}[IDIOMA];
if (!TXT) throw new Error('IDIOMA sem textos: ' + IDIOMA);
const H = cfg.hf?.[IDIOMA] || {};                                        // o dia pode sobrescrever qualquer texto
Object.assign(TXT, H);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ───────────── projeto e assets ─────────────
mkdirSync(join(PROJ, 'assets', 'fonts'), { recursive: true });
for (const a of ['package.json', 'hyperframes.json', 'CLAUDE.md', 'AGENTS.md']) if (!existsSync(join(PROJ, a)) && existsSync(join(MOLDE, a))) copyFileSync(join(MOLDE, a), join(PROJ, a));
if (!existsSync(join(PROJ, 'meta.json'))) writeFileSync(join(PROJ, 'meta.json'), JSON.stringify({ id: `garimpo-${cfg.id}-${IDIOMA}`, name: `garimpo-${cfg.id}-${IDIOMA}`, createdAt: new Date().toISOString() }, null, 2));
for (const fo of readdirSync(join(MOLDE, 'assets', 'fonts'))) if (!existsSync(join(PROJ, 'assets', 'fonts', fo))) copyFileSync(join(MOLDE, 'assets', 'fonts', fo), join(PROJ, 'assets', 'fonts', fo));
const SEM_ASSETS = !!process.env.SEM_ASSETS;                            // só reescreve o index.html
const copiar = (de, para) => { const p = join(PROJ, para); if (!SEM_ASSETS && (!existsSync(p) || statSync(p).mtimeMs < statSync(de).mtimeMs)) copyFileSync(de, p); };
copiar(join(saida, VIDEO + '.mp4'), 'assets/app-cdj.mp4');
copiar(join(saida, 'mix-final.wav'), 'assets/mix.wav');
const fundo = join(PROJ, 'assets', 'app-cdj-fundo.mp4');
if (!SEM_ASSETS && (!existsSync(fundo) || statSync(fundo).mtimeMs < statSync(join(saida, VIDEO + '.mp4')).mtimeMs)) {
  // o preenchimento atrás da CDJ deitada: pequeno, já borrado e escuro (nada de blur na hora do render)
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', join(saida, VIDEO + '.mp4'), '-vf', 'scale=640:360,boxblur=16:2,eq=brightness=-0.16:saturation=1.35,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '24', '-an', '-movflags', '+faststart', fundo]);
  if (r.status !== 0) throw new Error('ffmpeg fundo: ' + r.stderr);
}

// ───────────── câmera (pontos do app 1600×900; zoom 1 = altura inteira) ─────────────
const K = 1920 / 900, OV = 1080 / (1600 * K);
const X_A = 324, X_B = 1276, X_MIX = 820, Y_MIX = 650;
const CAM = [];
const ponto = (t, x, y, z, e) => CAM.push({ t: f3(t), x, y, z: +z.toFixed(4), ...(e ? { e } : {}) });
ponto(0, 800, 450, OV);
ponto(tBar(1), 800, 450, OV * 1.1, 'l');
ponto(tBar(1.9), X_A, 430, 1.0, 'io');                                  // desliza pra onda do deck A
ponto(D[0] - 0.26, X_A, 360, 1.5, 'in');
ponto(D[0], X_A, 350, 1.6, 'l');
for (let i = 0; i < NF; i++) {
  const pista = AMB[i] === 'pista';
  const fimAmb = i < NF - 1 ? FIM_AMB[i] : FIM_AMB[i];
  ponto(D[i], 800, 450, pista ? 0.78 : 1.0);                             // corte: o ambiente em tela cheia
  if (i < NF - 1) {
    ponto(fimAmb - 0.05, pista ? (i % 2 ? 700 : 900) : 800, 450, pista ? 0.95 : 1.14, 'l');
    const e = E[i + 1], d = D[i + 1], g = G[i];
    const XL = (i + 1) % 2 === 0 ? X_A : X_B;                              // o deck que entra
    ponto(e, 800, 440, 1.3);                                              // a CDJ volta: chega no mixer
    ponto(e + 0.25 * (g - e), 800, 440, 1.0, 'o');
    ponto(e + 0.6 * (g - e), XL, 420, 1.05, 'io');                        // o deck que entra
    ponto(g - 0.1, X_MIX, Y_MIX, 1.55, 'io');                             // close no mixer na troca de graves
    ponto(d - 0.26, X_MIX + 10, Y_MIX, 1.9, 'in');
    ponto(d, X_MIX + 10, Y_MIX - 2, 1.98, 'l');
  } else {
    ponto(Q, pista ? 700 : 800, 450, pista ? 0.95 : 1.14, 'l');
    ponto(fimAmb - 0.05, pista ? 760 : 800, 450, pista ? 0.9 : 1.06, 'io');
    ponto(fimAmb, 800, 450, 0.62);                                        // a CDJ inteira de volta
    ponto(fimAmb + 1.0, 800, 450, OV, 'o');
    ponto(DUR, 800, 450, OV * 1.07, 'l');
  }
}

// ───────────── peças ─────────────
const centro = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const KILL = { A: centro(RECT['kill-A-grave']), B: centro(RECT['kill-B-grave']) };
const clip = (id, ini, fim, corpo, cls = '', trilha = 10, extra = '') =>
  `<div id="${id}" class="clip ${cls}" data-start="${f3(ini)}" data-duration="${f3(fim - ini)}" data-track-index="${trilha}"${extra}>${corpo}</div>`;
const rgb = D.map((d, i) => ['r', 'c'].map((c) =>
  `<video id="rgb-${c}${i + 1}" class="clip rgb rgb-${c}" src="assets/app-cdj.mp4" data-start="${f3(d - 0.02)}" data-duration="${c === 'r' ? 0.42 : 0.4}" data-media-start="${f3(d - 0.02)}" data-track-index="2" muted playsinline></video>`).join('\n          ')).join('\n          ');
const tid = (i, ini, fim) => {
  const f = cfg.faixas[i];
  return clip(`tid${i + 1}`, ini, fim, `<div class="tid-in">
        <div class="tid-modo${AMB[i] === 'viagem' ? ' novo' : ''}">${esc(AMB[i] === 'viagem' ? TXT.novo : TXT.pista)}</div>
        <div class="tid-card">
          <div class="tid-rot">TRACK ID · ${i + 1}/${NF}${rampa ? ` · ${Math.round(f.bpm)} BPM` : ''}</div>
          <div class="tid-tit">${esc(f.titulo)}</div>
          <div class="tid-art">${esc(f.artista)}</div>
          <div class="tid-lic">${esc(f.licenca)}</div>
        </div>
      </div>`, 'tid', 12);
};
// o pulso do bumbo vai no BLOCO (.seg-pulso): pulsando linha a linha, as linhas se encostavam
const segura = (id, ini, fim, linhas) => clip(id, ini, fim,
  `<div class="seg-tremor"><div class="seg-cresce"><div class="seg-pulso"><div class="seg-in">${linhas.map((l) => `<div class="seg-l">${esc(l)}</div>`).join('')}</div></div></div></div>`, 'seg' + (linhas.length > 1 ? ' menor' : ''), 11);
// rótulo preso num controle: a âncora é um ponto (1 px), o resto sai dela de propósito
const corte = (id, ini, fim, [ax, ay], texto, lado) => clip(id, ini, fim,
  `<div class="ancora" data-ax="${ax}" data-ay="${ay}"><div class="anel" data-layout-allow-overflow></div>
        <svg class="fio" width="1" height="1" viewBox="0 0 1 1" overflow="visible" data-layout-allow-overflow><line x1="0" y1="0" x2="${lado === 'dir' ? 70 : -70}" y2="-96" /></svg>
        <div class="rot-in rot-${lado}" data-layout-allow-overflow>${esc(texto)}</div></div>`, 'corte', 13);

const clips = [];
clips.push(clip('gancho', 0, tBar(2) + 0.05, `<div class="g-in sombra">
        <div class="g1">${esc(TXT.g1)}</div>
        <div class="g2">${esc(GEN)} ⚡</div>
        <div class="g3">${esc(TXT.g3)}</div>
      </div>`, '', 10));
clips.push(clip('rod-gancho', 0.45, tBar(2) + 0.05, `<div class="rg-in"><span class="pilula sombra">${esc(TXT.pilula)}</span></div>`, '', 10));
clips.push(clip('selo', tBar(1.95), Q, `<div class="selo-in sombra">${esc(TXT.selo)} · <b id="selo-bpm">${bpmMin}</b> BPM</div>`, '', 14));
// com muitos drops, menos texto (Jev 30/09: carga de texto 0,09 com tudo em todos): o 'segura'
// no 1º, no 2º e no último; a passagem no 2º e no último; o TRACK ID em todos (é a trend)
const comSegura = (i) => NF <= 3 || i <= 1 || i === NF - 1;
const comPassa = (i) => i >= 1 && (NF <= 3 || i === 1 || i === NF - 1);
for (let i = 0; i < NF; i++) {
  if (comSegura(i)) clips.push(segura(`segura${i + 1}`, segIni(i), D[i] + 0.14, i === NF - 1 && NF > 1 ? TXT.pesada : TXT.segura(i + 1)));
  clips.push(tid(i, D[i] + 0.3, i < NF - 1 ? FIM_AMB[i] - 0.2 : Q - 0.2));
  if (comPassa(i)) clips.push(clip(`mix${i + 1}`, E[i] + 0.3, segIni(i) - 0.1, `<div class="passa-in">${esc(TXT.mix[i - 1] || TXT.mix[TXT.mix.length - 1])}</div>`, 'passa', 9));
}
const cortes = [];
for (let k = 0; k < Math.min(NF <= 3 ? 2 : 1, NF - 1); k++) {             // ensina a troca de graves (1 vez com muitos drops)
  const L = k % 2 === 0 ? 'A' : 'B';
  cortes.push(corte(`corte${k + 1}`, G[k], D[k + 1] - 0.12, KILL[L], TXT.corte(k + 1), L === 'A' ? 'dir' : 'esq'));
}
clips.push(clip('fim', Q, DUR, `<div class="fim-topo sombra"><div class="f1">${esc(TXT.fim[0])}</div><div class="f2">${esc(TXT.fim[1])}</div></div>
        <div class="fim-base sombra"><div class="marca">GARIM<b>PO</b></div><div class="desc">${esc(TXT.desc)}</div><div class="url">garimpo-topaz.vercel.app</div><div class="link">${esc(TXT.link)}</div></div>`, '', 17));

const html = `<!doctype html>
<html lang="${IDIOMA === 'pt' ? 'pt-BR' : IDIOMA}" data-resolution="portrait">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1080, height=1920" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      @font-face { font-family: "GTitulo"; src: url("assets/fonts/ArchivoBlack-Regular.ttf") format("truetype"); font-weight: 900; }
      @font-face { font-family: "GCorpo"; src: url("assets/fonts/Inter-VF.ttf") format("truetype"); font-weight: 100 900; }
      @font-face { font-family: "GRotulo"; src: url("assets/fonts/SairaSemiCondensed-Medium.ttf") format("truetype"); }
      @font-face { font-family: "GMono"; src: url("assets/fonts/JetBrainsMono-VF.ttf") format("truetype"); font-weight: 100 800; }
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 1080px; height: 1920px; overflow: hidden; background: #06040d; }
      body { font-family: "GCorpo", sans-serif; color: #f2eefc; }
      #root { position: relative; width: 100%; height: 100%; overflow: hidden;
        --neon: #ff4ecd; --acc: #4cc9f0; --ok: #2ee6a8; --cue: #ffb347; --mut: #b9aed6; }
      #base { position: absolute; inset: 0; background: #06040d; }
      /* a CDJ deitada ocupa 3413×1920 no "tamanho 1" (altura inteira); a câmera move #cam */
      #fundo, #tremor { position: absolute; inset: 0; }
      #v-fundo { position: absolute; left: -1166.67px; top: 0; width: 3413.33px; height: 1920px; object-fit: fill; }
      #tremor { transform-origin: 540px 960px; }
      #cam { position: absolute; left: 0; top: 0; width: 3413.33px; height: 1920px; transform-origin: 0 0; }
      #v-cdj, .rgb { position: absolute; left: 0; top: 0; width: 100%; height: 100%; object-fit: fill; }
      .rgb { mix-blend-mode: screen; opacity: 0; }
      .rgb-r { left: -12px; filter: sepia(1) saturate(7) hue-rotate(-38deg) brightness(0.95); }
      .rgb-c { left: 12px; filter: sepia(1) saturate(7) hue-rotate(150deg) brightness(0.95); }
      #vinheta { position: absolute; inset: 0; background: radial-gradient(ellipse 80% 62% at 50% 48%, transparent 58%, rgba(4, 2, 10, 0.5) 100%); }
      #scrim-topo { position: absolute; left: 0; top: 0; width: 1080px; height: 640px; background: linear-gradient(to bottom, rgba(6, 4, 13, 0.74), rgba(6, 4, 13, 0.35) 55%, rgba(6, 4, 13, 0)); }
      #scrim-base { position: absolute; left: 0; top: 1040px; width: 1080px; height: 880px; background: linear-gradient(to top, rgba(6, 4, 13, 0.86), rgba(6, 4, 13, 0.55) 48%, rgba(6, 4, 13, 0)); }
      .sombra { text-shadow: 0 4px 20px rgba(0, 0, 0, 0.7), 0 0 3px rgba(0, 0, 0, 0.85); }

      /* gancho */
      #gancho { position: absolute; left: 0; top: 196px; width: 1080px; text-align: center; }
      .g1 { font: 400 60px/1.1 "GRotulo", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: var(--acc); }
      .g2 { font: 900 132px/1.02 "GTitulo", sans-serif; color: #fff; margin-top: 14px;
        text-shadow: 0 0 34px rgba(255, 78, 205, 0.75), 0 6px 26px rgba(0, 0, 0, 0.6); }
      .g3 { font: 700 56px/1.2 "GCorpo", sans-serif; margin-top: 16px; }
      #rod-gancho { position: absolute; left: 0; top: 1296px; width: 1080px; text-align: center; }
      .pilula { display: inline-block; font: 400 48px/1.1 "GRotulo", sans-serif; padding: 16px 32px; border-radius: 999px;
        background: rgba(10, 7, 19, 0.78); border: 3px solid rgba(76, 201, 240, 0.7); box-shadow: 0 0 28px rgba(76, 201, 240, 0.35); }
      #selo { position: absolute; left: 54px; top: 184px; }
      .selo-in { font: 400 34px/1 "GRotulo", sans-serif; padding: 12px 22px; border-radius: 999px; background: rgba(10, 7, 19, 0.74);
        border: 2px solid rgba(255, 78, 205, 0.6); }
      .selo-in b { font-weight: 400; color: var(--cue); display: inline-block; min-width: 2.3em; text-align: right; }

      /* segura o N / textos de passagem */
      .seg { position: absolute; left: 0; top: 1236px; width: 1080px; text-align: center; }
      .seg-tremor, .seg-cresce, .seg-pulso, .seg-in { transform-origin: 540px 70px; }
      .seg-l { font: 900 100px/1.08 "GTitulo", sans-serif; color: #fff;
        text-shadow: 0 0 30px rgba(255, 78, 205, 0.8), 0 6px 24px rgba(0, 0, 0, 0.7); }
      .seg.menor .seg-l { font-size: 80px; line-height: 1.24; }
      .passa { position: absolute; left: 0; top: 1290px; width: 1080px; text-align: center; }
      .passa-in { display: inline-block; font: 900 80px/1.1 "GTitulo", sans-serif; color: #fff; text-shadow: 0 0 26px rgba(76, 201, 240, 0.75), 0 6px 22px rgba(0, 0, 0, 0.7); }

      /* rótulo preso num controle da CDJ */
      .corte { position: absolute; left: 0; top: 0; width: 1080px; height: 1920px; }
      .ancora { position: absolute; left: 0; top: 0; width: 1px; height: 1px; }
      .anel { position: absolute; left: -34px; top: -34px; width: 68px; height: 68px; border-radius: 50%; border: 5px solid var(--neon);
        box-shadow: 0 0 22px rgba(255, 78, 205, 0.8); }
      .fio { position: absolute; left: 0; top: 0; }
      .fio line { stroke: var(--neon); stroke-width: 4; stroke-linecap: round; }
      .rot-in { position: absolute; top: -170px; white-space: nowrap; font: 400 44px/1 "GRotulo", sans-serif; padding: 16px 26px; border-radius: 16px;
        background: rgba(10, 7, 19, 0.88); border: 3px solid var(--neon); box-shadow: 0 0 26px rgba(255, 78, 205, 0.45); }
      .rot-dir { left: 40px; }
      .rot-esq { right: 40px; }

      /* TRACK ID */
      .tid { position: absolute; left: 54px; top: 1052px; width: 880px; }
      .tid-modo { display: inline-block; font: 400 36px/1 "GRotulo", sans-serif; padding: 11px 20px; border-radius: 999px; margin-bottom: 14px;
        background: rgba(255, 78, 205, 0.18); border: 2px solid rgba(255, 78, 205, 0.7); }
      .tid-modo.novo { background: rgba(255, 179, 71, 0.2); border-color: rgba(255, 179, 71, 0.85); color: #ffe2b8; }
      .tid-card { padding: 26px 34px 28px; border-radius: 26px; background: rgba(10, 7, 19, 0.84); border: 2px solid rgba(46, 230, 168, 0.55);
        box-shadow: 0 18px 60px rgba(0, 0, 0, 0.5), 0 0 34px rgba(46, 230, 168, 0.18); }
      .tid-rot { font: 700 32px/1 "GMono", monospace; letter-spacing: 0.08em; color: var(--ok); }
      .tid-tit { font: 900 76px/1.05 "GTitulo", sans-serif; color: #fff; margin-top: 14px; }
      .tid-art { font: 400 48px/1.1 "GRotulo", sans-serif; color: var(--acc); margin-top: 8px; }
      .tid-lic { font: 700 25px/1 "GMono", monospace; color: var(--mut); margin-top: 16px; letter-spacing: 0.04em; }

      /* fim */
      #fim { position: absolute; inset: 0; }
      .fim-topo { position: absolute; left: 0; top: 204px; width: 1080px; text-align: center; }
      .f1 { font: 900 92px/1.08 "GTitulo", sans-serif; color: #fff; }
      .f2 { font: 900 ${NF > 3 ? 104 : 128}px/1.08 "GTitulo", sans-serif; color: #fff; margin-top: 8px;
        text-shadow: 0 0 36px rgba(255, 78, 205, 0.85), 0 6px 26px rgba(0, 0, 0, 0.6); }
      .fim-base { position: absolute; left: 0; top: 1270px; width: 1080px; text-align: center; }
      .marca { font: 900 92px/1 "GTitulo", sans-serif; letter-spacing: 0.14em; color: #fff; }
      .marca b { color: var(--acc); font-weight: 900; text-shadow: 0 0 26px rgba(76, 201, 240, 0.8); }
      .desc { font: 400 40px/1.2 "GRotulo", sans-serif; color: var(--cue); margin-top: 12px; }
      .url { font: 400 42px/1.2 "GRotulo", sans-serif; color: #f2eefc; margin-top: 6px; }
      .link { font: 400 38px/1.2 "GRotulo", sans-serif; color: var(--mut); margin-top: 6px; }

      /* drop: escurece de leve no último meio tempo e o flash (receita do editorial-flash-overlay) */
      #escuro { position: absolute; inset: 0; background: #020105; opacity: 0; }
      #flash { position: absolute; inset: -12%; overflow: hidden; pointer-events: none; }
      #flash .fl { position: absolute; inset: 0; opacity: 0; }
      #fw { background: rgb(255 250 255); }
      #fc { inset: -18%; transform-origin: 50% 48%; mix-blend-mode: screen;
        background: radial-gradient(ellipse 70% 60% at 50% 48%, #fff 0%, rgba(255, 255, 255, 0.96) 22%, rgba(255, 78, 205, 0.62) 50%, rgba(76, 201, 240, 0.28) 70%, transparent 88%); }
      #fs { inset: -28%; mix-blend-mode: screen;
        background: linear-gradient(108deg, transparent 21%, rgba(255, 78, 205, 0.16) 38%, rgba(255, 250, 255, 0.9) 49%, #fff 53%, rgba(76, 201, 240, 0.3) 62%, transparent 79%); }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${f3(DUR)}" data-width="1080" data-height="1920">
      <div id="base"></div>
      <div id="fundo">
        <video id="v-fundo" class="clip" src="assets/app-cdj-fundo.mp4" data-start="0" data-duration="${f3(DUR)}" data-track-index="0" muted playsinline></video>
      </div>
      <div id="tremor">
        <div id="cam" data-layout-allow-overflow>
          <video id="v-cdj" class="clip" src="assets/app-cdj.mp4" data-start="0" data-duration="${f3(DUR)}" data-track-index="1" muted playsinline></video>
          ${rgb}
        </div>
      </div>
      <div id="vinheta"></div>
      <div id="scrim-topo"></div>
      <div id="scrim-base"></div>
      <!-- acima do escurecido; o tremor entra na conta da posição -->
      ${cortes.join('\n      ')}

      ${clips.join('\n      ')}

      <div id="escuro"></div>
      <div id="flash"><div id="fw" class="fl"></div><div id="fc" class="fl"></div><div id="fs" class="fl"></div></div>
      <audio id="mix" src="assets/mix.wav" data-start="0" data-duration="${f3(DUR)}" data-track-index="20" data-volume="1"></audio>
    </div>

    <script>
      (function () {
        const K = 1920 / 900, DUR = ${DUR};
        const D = ${JSON.stringify(D.map(f3))}, FIM_AMB = ${JSON.stringify(FIM_AMB.map(f3))}, SEG = ${JSON.stringify(D.map((_, i) => f3(segIni(i))))};
        const BAT = ${JSON.stringify(BAT.map(f3))}, TEMPOS = ${JSON.stringify(RG.tempos.map((v) => Math.round(v * 10) / 10))};
        const CAM = ${JSON.stringify(CAM)};
        const EASE = {
          l: (p) => p,
          io: (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2),
          in: (p) => Math.pow(p, 2.4),
          o: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
        };
        function limitar(c) {
          const hw = 540 / (K * c.z), hh = 960 / (K * c.z);
          return {
            x: hw * 2 >= 1600 ? 800 : Math.min(1600 - hw, Math.max(hw, c.x)),
            y: hh * 2 >= 900 ? 450 : Math.min(900 - hh, Math.max(hh, c.y)),
            z: c.z,
          };
        }
        function camera(t) {
          let i = 0;
          for (let k = 0; k < CAM.length; k++) if (CAM[k].t <= t) i = k;
          const a = CAM[i], b = CAM[i + 1];
          if (!b) return limitar(a);
          const p = Math.min(1, Math.max(0, (t - a.t) / Math.max(1e-6, b.t - a.t)));
          const q = EASE[b.e || "io"](p);
          return limitar({ x: a.x + (b.x - a.x) * q, y: a.y + (b.y - a.y) * q, z: Math.exp(Math.log(a.z) + (Math.log(b.z) - Math.log(a.z)) * q) });
        }
        // ruído de valor determinístico (mesma ideia do camera-shake do registro)
        function hash(i, s) { let h = Math.imul(i | 0, 374761393) + Math.imul(s | 0, 668265263); h = (h ^ (h >>> 13)) >>> 0; h = Math.imul(h, 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
        function ruido(x, s) { const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10); return (hash(i, s) * (1 - u) + hash(i + 1, s) * u - 0.5) * 2; }
        function batida(t) { let lo = 0, hi = BAT.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (BAT[m] <= t) lo = m; else hi = m; } return lo; }
        function tensao(t) {                        // cresce nos 2 compassos antes do drop; estoura e some depois
          let a = 0;
          D.forEach((d, i) => {
            if (t >= SEG[i] && t < d) a = Math.max(a, Math.pow((t - SEG[i]) / (d - SEG[i]), 2.2));
            if (t >= d) a = Math.max(a, 0.9 * Math.exp(-(t - d) / 0.28));
          });
          return a;
        }
        function pulso(t) {                         // soco no drop + bumbo em cada tempo do ambiente
          let s = 1;
          D.forEach((d, i) => {
            if (t >= d && t < FIM_AMB[i]) { const tb = BAT[batida(t)]; if (tb >= d) s *= 1 + 0.03 * Math.exp(-(t - tb) / 0.1); }
            if (t >= d) s *= 1 + 0.16 * Math.exp(-(t - d) / 0.2);
          });
          return s;
        }
        const cam = document.getElementById("cam"), tremor = document.getElementById("tremor");
        const ancoras = Array.from(document.querySelectorAll(".ancora"));
        const segs = Array.from(document.querySelectorAll(".seg-tremor"));
        const seloBpm = document.getElementById("selo-bpm");
        function aplicar(t) {
          const c = camera(t), s = c.z;
          const tx = 540 - s * K * c.x, ty = 960 - s * K * c.y;
          cam.style.transform = "translate(" + tx.toFixed(2) + "px," + ty.toFixed(2) + "px) scale(" + s.toFixed(5) + ")";
          const a = tensao(t);
          const sx = a * (20 * ruido(t * 7.3, 1) + 9 * ruido(t * 2.2, 2));
          const sy = a * (20 * ruido(t * 6.9, 3) + 9 * ruido(t * 1.9, 4));
          const r = a * 1.1 * ruido(t * 4.1, 5);
          const p = pulso(t);
          tremor.style.transform = "translate(" + sx.toFixed(2) + "px," + sy.toFixed(2) + "px) rotate(" + r.toFixed(3) + "deg) scale(" + p.toFixed(5) + ")";
          // âncoras ficam fora do #tremor (acima do escurecido): o mesmo tremor, na conta
          const cr = Math.cos((r * Math.PI) / 180), sr = Math.sin((r * Math.PI) / 180);
          for (const el of ancoras) {
            const dx = tx + s * K * Number(el.dataset.ax) - 540, dy = ty + s * K * Number(el.dataset.ay) - 960;
            const X = 540 + sx + p * (dx * cr - dy * sr), Y = 960 + sy + p * (dx * sr + dy * cr);
            el.style.transform = "translate(" + X.toFixed(1) + "px," + Y.toFixed(1) + "px)";
          }
          for (const el of segs) el.style.transform = "translate(" + (sx * 0.6).toFixed(2) + "px," + (sy * 0.6).toFixed(2) + "px) rotate(" + (r * 0.8).toFixed(3) + "deg)";
          if (seloBpm) seloBpm.textContent = String(Math.round(TEMPOS[Math.min(batida(t), TEMPOS.length - 1)]));   // o BPM ao vivo
        }
        // motor com setter: o GSAP escreve t em todo render, inclusive no seek (onUpdate não roda no seek)
        const motor = {};
        let agora = 0;
        Object.defineProperty(motor, "t", { get: () => agora, set: (v) => { agora = v; aplicar(v); } });
        aplicar(0);

        const tl = gsap.timeline({ paused: true });
        tl.to(motor, { t: DUR, duration: DUR, ease: "none" }, 0);
        const bar2 = BAT[8];

        // gancho: está na tela desde o 1º quadro; assenta e depois sai pra cima
        tl.fromTo("#gancho .g2", { scale: 1.04 }, { scale: 1, duration: 0.6, ease: "power3.out" }, 0);
        tl.fromTo("#gancho .g3", { y: 18 }, { y: 0, duration: 0.6, ease: "power3.out" }, 0);
        tl.fromTo("#rod-gancho .rg-in", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, 0.45);
        tl.to("#gancho .g-in", { y: -70, opacity: 0, duration: 0.5, ease: "power2.in" }, bar2 - 0.5);
        tl.to("#rod-gancho .rg-in", { y: 40, opacity: 0, duration: 0.4, ease: "power2.in" }, bar2 - 0.5);
        tl.fromTo("#selo .selo-in", { x: -40, opacity: 0 }, { x: 0, opacity: 1, duration: 0.5, ease: "power3.out" }, ${f3(tBar(1.95))});
        tl.to("#selo .selo-in", { opacity: 0, duration: 0.3 }, ${f3(Q - 0.3)});

        // segura o N: entra, cresce, pulsa em cada tempo, explode no drop; escurece de leve e flash
        D.forEach((d, i) => {
          const id = "#segura" + (i + 1), ini = SEG[i];
          if (document.querySelector(id)) {                  // nem todo drop tem o "segura" (menos texto)
            tl.fromTo(id + " .seg-in", { y: 50, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ini);
            tl.fromTo(id + " .seg-cresce", { scale: 1 }, { scale: 1.22, duration: d - ini, ease: "power1.in" }, ini);
            for (let b = batida(ini) + 1; b < BAT.length && BAT[b] < d - 0.1; b++) tl.fromTo(id + " .seg-pulso", { scale: 1.07 }, { scale: 1, duration: 0.3, ease: "power2.out", immediateRender: false }, BAT[b]);
            tl.to(id + " .seg-in", { scale: 1.7, opacity: 0, duration: 0.14, ease: "power2.in" }, d);
          }
          const meio = (BAT[batida(d) ] - BAT[Math.max(0, batida(d) - 1)]) / 2 || 0.22;
          tl.fromTo("#escuro", { opacity: 0 }, { opacity: 0.36, duration: meio - 0.03, ease: "power2.in", immediateRender: false }, d - meio);
          tl.set("#escuro", { opacity: 0 }, d);
          const hit = d - 0.03;
          tl.fromTo("#fw", { opacity: 0 }, { opacity: 0.92, duration: 0.04, ease: "power4.in", immediateRender: false }, hit);
          tl.fromTo("#fc", { opacity: 0, scale: 0.86, rotation: -5 }, { opacity: 1, scale: 1, rotation: -5, duration: 0.05, ease: "power4.in", immediateRender: false }, hit - 0.01);
          tl.fromTo("#fs", { opacity: 0, xPercent: -12, rotation: -2 }, { opacity: 0.9, xPercent: 8, rotation: -2, duration: 0.04, ease: "power4.in", immediateRender: false }, hit);
          tl.to("#fw", { opacity: 0, duration: 0.18, ease: "power3.out" }, hit + 0.04);
          tl.to("#fc", { opacity: 0, scale: 1.18, duration: 0.34, ease: "power2.out" }, hit + 0.04);
          tl.to("#fs", { opacity: 0, xPercent: 28, duration: 0.3, ease: "power2.out" }, hit + 0.04);
          tl.fromTo(["#rgb-r" + (i + 1), "#rgb-c" + (i + 1)], { opacity: 0.85 }, { opacity: 0, duration: 0.38, ease: "power2.out", immediateRender: false }, d - 0.02);
        });

        // TRACK ID: o cartão entra com as linhas em cascata e sai pro lado
        ${JSON.stringify(D.map((d, i) => [`#tid${i + 1}`, f3(d + 0.3), f3(i < NF - 1 ? FIM_AMB[i] - 0.2 : Q - 0.2)]))}.forEach(([id, ini, fim]) => {
          tl.fromTo(id + " .tid-in", { x: -70, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, ini);
          tl.fromTo(id + " .tid-modo", { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, ini + 0.25);
          tl.fromTo([id + " .tid-rot", id + " .tid-tit", id + " .tid-art", id + " .tid-lic"], { y: 26, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out", stagger: 0.08 }, ini + 0.1);
          tl.to(id + " .tid-card", { scale: 1.015, duration: Math.max(0.2, fim - ini - 0.9), ease: "none" }, ini + 0.6);
          tl.to(id + " .tid-in", { x: -50, opacity: 0, duration: 0.3, ease: "power2.in" }, fim - 0.3);
        });

        // textos de passagem
        ${JSON.stringify(D.map((_, i) => i).filter(comPassa).map((i) => [`#mix${i + 1}`, f3(E[i] + 0.3), f3(segIni(i) - 0.1)]))}.forEach(([id, ini, fim]) => {
          tl.fromTo(id + " .passa-in", { y: 46, opacity: 0, scale: 0.94 }, { y: 0, opacity: 1, scale: 1, duration: 0.45, ease: "power3.out" }, ini);
          tl.to(id + " .passa-in", { scale: 1.05, duration: Math.max(0.2, fim - ini - 0.6), ease: "none" }, ini + 0.45);
          tl.to(id + " .passa-in", { y: -30, opacity: 0, duration: 0.25, ease: "power2.in" }, fim - 0.25);
        });

        // "corta o grave" preso no botão
        ${JSON.stringify(cortes.map((_, k) => [`#corte${k + 1}`, f3(G[k]), f3(D[k + 1] - 0.12)]))}.forEach(([id, ini, fim]) => {
          tl.fromTo(id + " .anel", { scale: 1.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.3, ease: "back.out(2)" }, ini);
          tl.fromTo(id + " .fio", { opacity: 0 }, { opacity: 1, duration: 0.2 }, ini + 0.12);
          tl.fromTo(id + " .rot-in", { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.35, ease: "power3.out" }, ini + 0.15);
          for (let b = batida(ini) + 1; b < BAT.length && BAT[b] < fim - 0.2; b++) tl.fromTo(id + " .anel", { scale: 1.25 }, { scale: 1, duration: 0.3, ease: "power2.out", immediateRender: false }, BAT[b]);
          tl.to([id + " .anel", id + " .fio", id + " .rot-in"], { opacity: 0, duration: 0.15 }, fim - 0.15);
        });

        // fim: a pergunta entra ainda no ambiente (e fica); a CDJ volta e a marca aparece embaixo
        const c0 = ${f3(Q)}, cdj = ${f3(FIM_AMB[NF - 1])};
        tl.fromTo("#fim .f1", { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, c0 + 0.1);
        tl.fromTo("#fim .f2", { scale: 0.7, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.55, ease: "back.out(1.8)" }, c0 + 0.3);
        tl.fromTo("#fim .marca", { y: 36, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power3.out" }, cdj + 0.4);
        tl.fromTo(["#fim .desc", "#fim .url", "#fim .link"], { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.4, ease: "power3.out", stagger: 0.12 }, cdj + 0.6);
        for (let b = batida(c0 + 1.9); b < BAT.length - 1 && BAT[b] < DUR - 0.2; b += 2) tl.fromTo("#fim .f2", { scale: 1.05 }, { scale: 1, duration: 0.4, ease: "power2.out", immediateRender: false }, BAT[b]);

        window.__timelines["main"] = tl;
      })();
    </script>
  </body>
</html>
`;
writeFileSync(join(PROJ, 'index.html'), html);
console.log(`ok ${join(PROJ, 'index.html')} · ${IDIOMA} · ${DUR.toFixed(2)} s · ${NF} drops em ${D.map((d) => d.toFixed(2)).join(' / ')} · vídeo ${VIDEO}.mp4`);
