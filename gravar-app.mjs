// Grava a TELA REAL do Garimpo (a CDJ, o mixer, os ambientes) tocando e mixando as
// 3 faixas na régua da nossa mixagem (mixar.mjs): 124 BPM, cada faixa entrando no seu
// pré-drop, crossfader andando nas passagens, troca de graves, e os ambientes do app
// (🎉 pista, 🌀 viagem, 👁 só o show) nos drops.
//
// QUADRO A QUADRO, com relógio virtual. Ao vivo o app não passava de ~6 quadros/s
// sem janela nesta máquina (a GPU da Intel satura rasterizando as ondas), então aqui
// o tempo da página é nosso: performance.now, Date.now, rAF, timers, animações CSS e
// o ctx.currentTime do áudio andam 1/60 s por vez, e cada 1/30 s vira um print. Tudo
// que o app desenha é função desse tempo (a posição dos decks sai do TimeMap do
// transport); os "anchors" do worklet (relógio de áudio de verdade) são descartados
// enquanto grava. O que o app lê do som ao vivo (espectro e medidores) é servido da
// NOSSA mixagem final (master) e das faixas originais (canais A/B), na posição exata.
//
// Uso: [IDIOMA=es] node gravar-app.mjs dias/<id>.json     → saida/<id>/app-cdj-<idioma>.mp4 (+ .json)
//      node gravar-app.mjs dias/<id>.json video 6          → só os 6 primeiros segundos
//      node gravar-app.mjs dias/<id>.json fotos 3,9,20     → saida/<id>/app-<t>.jpg
// Tela: VW×VH CSS a DSF (padrão 1600×900 a 2,4 = 3840×2160).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
// APP_RAIZ: grava de uma cópia exata de um commit publicado (git archive), com as músicas em
// _midia/ — o checkout principal pode estar com trabalho de outra sessão pela metade
const APP_RAIZ = process.env.APP_RAIZ || '';
const RAIZ = APP_RAIZ || join(AQUI, 'app-garimpo');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const CHROME = process.env.CHROME || undefined;                // sem CHROME: o Chromium do Playwright
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const modo = process.argv[3] || 'video';
const pasta = join(AQUI, 'saida', cfg.id);
const IDIOMA = process.env.IDIOMA || 'pt';                     // a língua da CDJ (o app tem pt/en/es)
const D = cfg.drops || [4, 12, 20], FIMC = cfg.fimComp || 28;
const FPS = 30;
const VW = Number(process.env.VW || 1600), VH = Number(process.env.VH || 900), DSF = Number(process.env.DSF || 2.4);
// A RÉGUA em segundos (entradas, drops, troca de grave, andamento por batida). Com rampa de BPM
// vem pronta do mixar-rampa.mjs (mix.json); com BPM fixo (mixar.mjs), é calculada aqui igual.
const R = (() => {
  const mj = JSON.parse(readFileSync(join(pasta, 'mix.json'), 'utf8'));
  if (mj.rampa) return mj;
  const BPM = cfg.bpmSet || 124, T = 60 / BPM, NB = FIMC * 4;
  const batidas = Array.from({ length: NB + 1 }, (_, b) => b * T);
  return {
    batidas, tempos: new Array(NB).fill(BPM), fim_s: NB * T, drops_s: D.map((d) => d * 4 * T),
    faixas: cfg.faixas.map((f, i) => ({ bpm: f.bpm, entrada_s: (D[i] - 4) * 4 * T, drop_s: D[i] * 4 * T,
      grave_sai_s: i < cfg.faixas.length - 1 ? (D[i + 1] - 1) * 4 * T : null, sai_s: i < cfg.faixas.length - 1 ? D[i + 1] * 4 * T : NB * T,
      fonte_ini_s: f.drop_s - 16 * (60 / f.bpm) })),
  };
})();
const NF = cfg.faixas.length;
const AMB = cfg.ambientes || cfg.faixas.map((_, i) => (i % 2 ? 'viagem' : 'pista'));
const fotos = modo === 'fotos' ? process.argv[4].split(',').map(Number).sort((a, b) => a - b) : [];
const DUR = modo === 'fotos' ? Math.max(...fotos) + 0.05 : Number(process.argv[4] || R.fim_s);
// bpm e gênero vão junto: sem eles o analisador do app trava na tercina (leu 83,9 numa de 119,9)
const idJm = (f) => f.link?.match(/track\/(\d+)/)?.[1] || String(f.id || f.titulo).replace(/\W+/g, '');   // Jamendo, ou o id da biblioteca do TikTok
const GENERO = cfg.genero ? cfg.genero.replace(/\b\w/g, (c) => c.toUpperCase()) : 'House';
const jm = (f) => ({ source: 'jamendo', id: 'jm:' + idJm(f), title: f.titulo, artist: f.artista, bpm: f.bpm, genre: GENERO });
// o mesmo mp32 do Jamendo, da cópia local (drops.mjs baixou): o Jamendo devolve 429 se a gente
// baixa as faixas inteiras a cada teste, e carregarJamendo só faz um fetch do arquivo todo
const midia = (p) => (APP_RAIZ ? '/_midia/' + basename(p) : rota(p));
const urlJm = (f) => midia(join(AQUI, f.arquivo));
const rota = (p) => '/' + relative(RAIZ, p).replace(/\\/g, '/');

// ───────────── o relógio virtual (entra antes de qualquer script do app) ─────────────
function RELOGIO() {
  if (window.__vt) return;
  const R = {
    now: performance.now.bind(performance), dnow: Date.now,
    raf: window.requestAnimationFrame.bind(window), caf: window.cancelAnimationFrame.bind(window),
    st: window.setTimeout.bind(window), ct: window.clearTimeout.bind(window),
    si: window.setInterval.bind(window), ci: window.clearInterval.bind(window),
  };
  const V = window.__vt = { on: false, ms: 0, ms0: 0, d0: 0, seq: 1, rafs: new Map(), timers: new Map(), ctxs: [], fontes: null, playAt: null, erros: [] };
  performance.now = () => (V.on ? V.ms : R.now());
  Date.now = () => (V.on ? V.d0 + (V.ms - V.ms0) : R.dnow());

  window.requestAnimationFrame = function (cb) {
    const id = V.seq++, e = { cb, real: 0 };
    V.rafs.set(id, e);
    if (!V.on) e.real = R.raf((ts) => { if (!V.rafs.has(id)) return; e.real = 0; if (V.on) return; V.rafs.delete(id); cb(ts); });
    return id;
  };
  window.cancelAnimationFrame = function (id) { const e = V.rafs.get(id); if (!e) return; if (e.real) R.caf(e.real); V.rafs.delete(id); };

  // timers: de verdade até congelar; congelados, vencem no tempo virtual
  const disparar = (id) => {
    const t = V.timers.get(id); if (!t) return;
    if (V.on) { if (t.iv) R.ci(t.real); t.real = 0; t.due = V.ms; return; }
    if (!t.iv) V.timers.delete(id);
    t.fn(...t.args);
  };
  const criar = (iv) => function (fn, ms, ...args) {
    if (typeof fn !== 'function') { const s = String(fn); fn = () => (0, eval)(s); }
    const id = V.seq++, t = { fn, args, ms: Math.max(iv ? 1 : 0, Number(ms) || 0), iv, real: 0, due: 0, nasc: R.now() };
    V.timers.set(id, t);
    if (V.on) t.due = V.ms + t.ms;
    else t.real = (iv ? R.si : R.st)(() => disparar(id), t.ms);
    return id;
  };
  window.setTimeout = criar(false);
  window.setInterval = criar(true);
  window.clearTimeout = window.clearInterval = function (id) { const t = V.timers.get(id); if (!t) return; if (t.real) (t.iv ? R.ci : R.ct)(t.real); V.timers.delete(id); };

  // o relógio do áudio: congelado, anda com o virtual a partir de onde estava
  const RAC = window.AudioContext;
  if (RAC) {
    const Novo = class AudioContext extends RAC { constructor(...a) { super(...a); V.ctxs.push(this); } };
    window.AudioContext = Novo;
    if (window.webkitAudioContext) window.webkitAudioContext = Novo;
    const dCT = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'currentTime');
    Object.defineProperty(BaseAudioContext.prototype, 'currentTime', { configurable: true, enumerable: true,
      get() { const r = dCT.get.call(this); return V.on && this.__base !== undefined ? this.__base + (V.ms - V.ms0) / 1000 : r; } });
    const dOL = Object.getOwnPropertyDescriptor(RAC.prototype, 'outputLatency');
    if (dOL) Object.defineProperty(RAC.prototype, 'outputLatency', { configurable: true, enumerable: true,
      get() { return V.on && this.__base !== undefined ? 0 : dOL.get.call(this); } });
    V.ctReal = (c) => dCT.get.call(c);
  }
  // os "anchors" do worklet trazem o relógio de áudio DE VERDADE: congelado, ficam de fora
  const dOM = Object.getOwnPropertyDescriptor(MessagePort.prototype, 'onmessage');
  Object.defineProperty(MessagePort.prototype, 'onmessage', { configurable: true, enumerable: true,
    get() { return this.__om ?? null; },
    set(fn) {
      this.__om = fn;
      dOM.set.call(this, typeof fn === 'function' ? function (ev) { if (V.on && ev && ev.data && ev.data.t === 'anchor') return; return fn.call(this, ev); } : fn);
    } });

  // o que o app "ouve": espectro e medidores servidos da mixagem e das faixas
  const fft = (re, im) => {
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let x = re[i]; re[i] = re[j]; re[j] = x; x = im[i]; im[i] = im[j]; im[j] = x; } }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), h = len >> 1;
      for (let i = 0; i < n; i += len) {
        let cr = 1, ci = 0;
        for (let k = 0; k < h; k++) {
          const a = i + k, b = a + h, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
          const tt = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = tt;
        }
      }
    }
  };
  function sinal(node, n) {
    const F = V.fontes; if (!F) return null;
    const fonte = node.__fonte || 'master';
    let arr, sr, fim;
    if (fonte === 'master') {
      if (V.playAt == null) return null;
      arr = F.mix; sr = F.srMix; fim = Math.round((node.context.currentTime - V.playAt) * sr);
    } else {
      const d = globalThis.__garimpo?.decks?.[fonte];
      if (!d || !d.faixa || !d.transport?.playing) return null;
      const b = F.faixas[d.faixa.id]; if (!b) return null;
      arr = b.dados; sr = b.sr; fim = Math.round((d.displayPosition - b.ini) * sr);
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) { const k = fim - n + i; out[i] = k >= 0 && k < arr.length ? arr[k] : 0; }
    if (fonte !== 'master' && globalThis.__garimpo?.mixer?.canal(fonte)?.eq?.morto?.('grave')) {
      // grave cortado: passa-alta simples (~250 Hz) pro medidor cair como no app
      const a = 1 / (1 + 2 * Math.PI * 250 / sr); let y = 0, xa = out[0];
      for (let i = 0; i < n; i++) { const x = out[i]; y = a * (y + x - xa); xa = x; out[i] = y; }
    }
    return out;
  }
  function espectro(node) {
    const n = node.fftSize, h = n >> 1;
    let p = node.__prev; if (!p || p.length !== h) p = node.__prev = new Float32Array(h);
    if (node.__tq === V.ms) return p;              // uma vez por instante, como no app
    node.__tq = V.ms;
    const s = sinal(node, n), m = new Float32Array(h);
    if (s) {
      const re = new Float64Array(n), im = new Float64Array(n);
      for (let i = 0; i < n; i++) re[i] = s[i] * (0.42 - 0.5 * Math.cos(2 * Math.PI * i / n) + 0.08 * Math.cos(4 * Math.PI * i / n));
      fft(re, im);
      for (let k = 0; k < h; k++) m[k] = Math.hypot(re[k], im[k]) / n;
    }
    const tau = node.smoothingTimeConstant;
    for (let k = 0; k < h; k++) p[k] = tau * p[k] + (1 - tau) * m[k];
    return p;
  }
  const AN = AnalyserNode.prototype;
  const O = { bf: AN.getByteFrequencyData, ff: AN.getFloatFrequencyData, bt: AN.getByteTimeDomainData, ft: AN.getFloatTimeDomainData };
  AN.getFloatFrequencyData = function (arr) {
    if (!V.on) return O.ff.call(this, arr);
    const p = espectro(this); for (let k = 0; k < arr.length; k++) arr[k] = k < p.length ? 20 * Math.log10(p[k] || 1e-12) : -Infinity;
  };
  AN.getByteFrequencyData = function (arr) {
    if (!V.on) return O.bf.call(this, arr);
    const p = espectro(this), lo = this.minDecibels, hi = this.maxDecibels;
    for (let k = 0; k < arr.length; k++) { const db = k < p.length ? 20 * Math.log10(p[k] || 1e-12) : -1e9; arr[k] = Math.max(0, Math.min(255, Math.floor(255 / (hi - lo) * (db - lo)))); }
  };
  AN.getFloatTimeDomainData = function (arr) {
    if (!V.on) return O.ft.call(this, arr);
    const s = sinal(this, arr.length); for (let i = 0; i < arr.length; i++) arr[i] = s ? s[i] : 0;
  };
  AN.getByteTimeDomainData = function (arr) {
    if (!V.on) return O.bt.call(this, arr);
    const s = sinal(this, arr.length); for (let i = 0; i < arr.length; i++) arr[i] = Math.max(0, Math.min(255, Math.floor(128 * (1 + (s ? s[i] : 0)))));
  };

  V.congelar = () => {
    V.ms = V.ms0 = R.now(); V.d0 = R.dnow();
    for (const c of V.ctxs) c.__base = V.ctReal(c);
    for (const t of V.timers.values()) if (t.real) {
      (t.iv ? R.ci : R.ct)(t.real); t.real = 0;
      const vivo = R.now() - t.nasc;
      t.due = V.ms + (t.iv ? t.ms - (vivo % t.ms) : Math.max(0, t.ms - vivo));
    }
    for (const e of V.rafs.values()) if (e.real) { R.caf(e.real); e.real = 0; }
    V.on = true;
  };
  // avança até `alvo` (ms virtuais): timers na ordem, depois um quadro de rAF e as animações CSS
  V.passo = (alvo) => {
    for (let guarda = 0; guarda < 20000; guarda++) {
      let prox = null, pid = 0;
      for (const [id, t] of V.timers) if (!t.real && t.due <= alvo && (!prox || t.due < prox.due || (t.due === prox.due && id < pid))) { prox = t; pid = id; }
      if (!prox) break;
      V.ms = Math.max(V.ms, prox.due);
      if (prox.iv) prox.due += prox.ms; else V.timers.delete(pid);
      try { prox.fn(...prox.args); } catch (e) { V.erros.push('timer: ' + (e?.message || e)); }
    }
    V.ms = alvo;
    const fila = [...V.rafs].filter(([, e]) => !e.real);
    for (const [id] of fila) V.rafs.delete(id);
    for (const [, e] of fila) { try { e.cb(V.ms); } catch (err) { V.erros.push('raf: ' + (err?.message || err)); } }
    for (const a of document.getAnimations()) {
      if (a.__t0 === undefined) a.__t0 = V.ms;
      if (a.playState !== 'paused') a.pause();
      a.currentTime = V.ms - a.__t0;
    }
  };
}

// ───────────── sobe o app ─────────────
const PORTA = 8099;
// o servidor do app volta sozinho se cair (01/10: na gravação em espanhol as faixas 3–5 deram
// "Failed to fetch" e o vídeo saiu quebrado sem avisar)
const logSrv = [];
let srv, fechando = false;
const subir = () => {
  srv = spawn(process.execPath, ['dev-server.mjs', String(PORTA)], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stdout.on('data', (b) => logSrv.push(...String(b).split(/\r?\n/).filter(Boolean)));
  srv.stderr.on('data', (b) => logSrv.push(...String(b).split(/\r?\n/).filter(Boolean).map((l) => 'ERR ' + l)));
  srv.on('exit', (c) => { logSrv.push('SERVIDOR SAIU código ' + c); if (!fechando) setTimeout(subir, 300); });
};
subir();
const fecharSrv = () => { fechando = true; srv.kill(); };
for (let k = 0; k < 50; k++) { try { await fetch(`http://127.0.0.1:${PORTA}/`); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }
const nav = await chromium.launch({ executablePath: CHROME, args: ['--autoplay-policy=no-user-gesture-required', '--force-color-profile=srgb', '--hide-scrollbars',
  ...(process.env.GL_ARGS ? process.env.GL_ARGS.split(' ') : ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist'])] });
const pag = await nav.newPage({ viewport: { width: VW, height: VH }, deviceScaleFactor: DSF });
const erros = [];
pag.on('pageerror', (e) => erros.push('pageerror: ' + e.message));
pag.on('requestfailed', (r) => erros.push('falhou: ' + r.url().slice(0, 120) + ' ' + r.failure()?.errorText));
pag.on('console', (m) => { if (m.type() === 'error' && !/favicon|404|ERR_/.test(m.text())) erros.push('console: ' + m.text().slice(0, 200)); });
await pag.addInitScript(RELOGIO);
// a língua da CDJ: o app lê garimpo.idioma antes de montar a tela
await pag.addInitScript((l) => { try { localStorage.setItem('garimpo.idioma', l); } catch {} }, IDIOMA);
// a gravação não precisa das fontes de música lá fora (as faixas vêm de audio/): cada teste
// abria o app e varria hearthis/Audius/Jamendo de novo — e eles limitam (hearthis: devagar)
await pag.route((u) => u.hostname !== '127.0.0.1' && /hearthis|audius|jamendo|workers\.dev/i.test(u.hostname), (r) => r.abort('blockedbyclient'));
// o Jev (API paga) e o /_log do servidor de desenvolvimento ficam fora da gravação — igual na nuvem, que nem tem chave
await pag.route((u) => u.hostname === '127.0.0.1' && /^\/_(jev|log)\b/.test(u.pathname), (r) => r.fulfill({ status: 503, contentType: 'application/json', body: '{"erro":"fora da gravação"}' }));
await pag.goto(`http://127.0.0.1:${PORTA}/`, { waitUntil: 'domcontentloaded' });
await pag.waitForTimeout(2500);
await pag.click('#b-entrar');
await pag.waitForTimeout(2500);
// o tour de boas-vindas, em qualquer língua: pelo botão (.guia-pular), não pelo texto — em espanhol
// o texto não casou e o tour ficou escurecendo a CDJ a gravação inteira (01/10)
for (let k = 0; k < 30; k++) {
  const b = pag.locator('.guia-pular').first();
  if (await b.isVisible().catch(() => false)) { await b.click().catch(() => {}); await pag.waitForTimeout(500); }
  const aberto = await pag.evaluate(() => [...document.querySelectorAll('.guia-pular')].some((e) => e.offsetParent !== null && !e.hidden)).catch(() => false);
  if (!aberto && k >= 4) break;                                    // espera ~2 s pra ter certeza que não abriu depois
  await pag.waitForTimeout(400);
}
if (await pag.evaluate(() => [...document.querySelectorAll('.guia-pular')].some((e) => e.offsetParent !== null && !e.hidden)).catch(() => false)) throw new Error('o tour não fechou');
await pag.waitForTimeout(800);
await pag.keyboard.press('Escape').catch(() => {});

// aquece os ambientes (o MilkDrop e a galera montam na 1ª vez) pra não engasgar no drop
await pag.evaluate(async () => {
  const b = document.body.classList, espera = (ms) => new Promise((r) => setTimeout(r, ms));
  document.querySelector('.cena-viagem')?.click(); await espera(2500);
  if (b.contains('viagem')) document.querySelector('.cena-viagem')?.click();
  document.querySelector('.cena-pista')?.click(); await espera(1200);
  if (b.contains('pista-cheia')) document.querySelector('.cena-pista')?.click();
  await espera(600);
});

// o andamento do vídeo num instante t (s), pela régua
const tempoEm = (t) => { const bs = R.batidas; let lo = 0, hi = bs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bs[m] <= t) lo = m; else hi = m; } return R.tempos[Math.min(lo, R.tempos.length - 1)]; };
// carrega as duas primeiras, afina pro andamento da entrada de cada uma e posiciona no pré-drop
const pronto = await pag.evaluate(async ({ a, b, ua, ub, preA, preB, pitchA, pitchB }) => {
  const { decks, mixer } = globalThis.__garimpo;
  await Promise.all([decks.A.carregarJamendo(a, ua), decks.B.carregarJamendo(b, ub)]);
  const espera = async (d) => { for (let i = 0; i < 300 && !d.pronta; i++) await new Promise((r) => setTimeout(r, 100)); };
  await espera(decks.A); await espera(decks.B);
  // faixa de pitch em ±50% (o "50" do app): a rampa de BPM pede até +24%
  for (const d of [decks.A, decks.B]) d.transport.setPitchRange?.(0.5);
  decks.A.setPitch(pitchA); decks.A.seek(preA);
  decks.B.setPitch(pitchB); decks.B.seek(preB);
  mixer.setCrossfader(0);
  mixer.canal('B').setKill('grave', true);
  await new Promise((r) => setTimeout(r, 600));
  return { bpmA: decks.A.bpmNatural, bpmB: decks.B.bpmNatural, efetivoA: +decks.A.bpmEfetivo.toFixed(2), efetivoB: +decks.B.bpmEfetivo.toFixed(2), prontaA: decks.A.pronta, prontaB: decks.B.pronta };
}, { a: jm(cfg.faixas[0]), b: jm(cfg.faixas[1]), ua: urlJm(cfg.faixas[0]), ub: urlJm(cfg.faixas[1]),
     preA: R.faixas[0].fonte_ini_s, preB: R.faixas[1].fonte_ini_s,
     pitchA: tempoEm(R.faixas[0].entrada_s) / cfg.faixas[0].bpm - 1, pitchB: tempoEm(R.faixas[1].entrada_s) / cfg.faixas[1].bpm - 1 });
console.log('carregadas:', JSON.stringify(pronto));
if (process.env.ATE === 'carregar') {
  console.log('servidor:', logSrv.filter((l) => !/^200 /.test(l)).slice(-15).join(' | '), `(${logSrv.filter((l) => /^200 /.test(l)).length} respostas 200)`);
  for (const e of erros.slice(0, 15)) console.log('erro:', e);
  await nav.close(); fecharSrv(); process.exit(0);
}

// o som que o app vai "ouvir": a mixagem final (master) e um trecho de cada faixa original (canais)
const fontes = await pag.evaluate(async ({ uMix, faixas }) => {
  const ctx = globalThis.__garimpo.ctx;
  const dec = async (url, ini = 0, dur = 1e9) => {
    const buf = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const sr = buf.sampleRate, i0 = Math.max(0, Math.floor(ini * sr)), i1 = Math.min(buf.length, Math.floor((ini + dur) * sr));
    const L = buf.getChannelData(0), Rc = buf.numberOfChannels > 1 ? buf.getChannelData(1) : L, m = new Float32Array(i1 - i0);
    for (let i = 0; i < m.length; i++) m[i] = 0.5 * (L[i0 + i] + Rc[i0 + i]);
    return { dados: m, sr, ini: i0 / sr };
  };
  const mix = await dec(uMix);
  const F = { mix: mix.dados, srMix: mix.sr, faixas: {} };
  for (const f of faixas) F.faixas[f.id] = await dec(f.url, f.ini, f.dur);
  __vt.fontes = F;
  const { mixer } = globalThis.__garimpo;
  mixer.canal('A').medidor.__fonte = 'A';
  mixer.canal('B').medidor.__fonte = 'B';
  return { mixSeg: +(F.mix.length / F.srMix).toFixed(2), sr: F.srMix, faixas: Object.keys(F.faixas) };
}, { uMix: midia(join(pasta, 'mix-final.wav')), faixas: cfg.faixas.map((f, i) => ({ id: jm(f).id, url: midia(join(AQUI, f.arquivo)), ini: R.faixas[i].fonte_ini_s - 3,
  // quanto da fonte a faixa usa: batidas tocadas × duração da batida original, com folga
  dur: ((R.faixas[i].sai_s - R.faixas[i].entrada_s) * 1.35 * tempoEm(R.faixas[i].drop_s) / 60) * (60 / f.bpm) + 8 })) });
console.log('fontes:', JSON.stringify(fontes));

// abertura (01/10, depois da retenção de 29/09: a maioria saía no 1º segundo com a CDJ parada):
// o 1º quadro já é o ambiente em tela cheia e a CDJ só aparece depois do 1º drop. Liga aqui, ainda
// no relógio de verdade, pra viagem HD estar montada (sem a fusão da 2D) quando a gravação começa.
if (cfg.abertura) await pag.evaluate(async (amb) => {
  const b = document.body.classList, espera = (ms) => new Promise((r) => setTimeout(r, ms));
  const ligado = () => (amb === 'viagem' ? b.contains('viagem') : b.contains('pista-cheia'));
  if (!ligado()) document.querySelector(amb === 'viagem' ? '.cena-viagem' : '.cena-pista')?.click();
  await espera(800);
  document.dispatchEvent(new CustomEvent('so-show'));
  await espera(6000);
}, cfg.abertura);

// ───────────── congela e arma a apresentação na régua ─────────────
// N faixas alternando os decks (A, B, A, …), cada uma entrando no seu pré-drop por cima do drop
// da anterior, crossfader andando nos 4 compassos, troca de graves no último, e o PITCH dos dois
// decks seguindo o andamento do vídeo (rampa de BPM) — o prato mostra o BPM subindo.
const V0 = await pag.evaluate(({ R, faixas, urls, bpms, AMB }) => {
  __vt.congelar();
  const V = __vt, { decks, mixer, ctx } = globalThis.__garimpo, body = document.body.classList;
  const t0 = performance.now();
  const agora = () => (performance.now() - t0) / 1000;
  const em = (s, fn) => setTimeout(() => {
    const falha = (e) => V.erros.push('agenda ' + s.toFixed(2) + ': ' + (e?.message || e));
    try { const p = fn(); if (p && p.catch) p.catch(falha); } catch (e) { falha(e); }
  }, Math.max(0, s * 1000 - (performance.now() - t0)));
  const clicar = (sel) => { const b = [...document.querySelectorAll(sel)].find((x) => x.offsetParent !== null) || document.querySelector(sel); b?.click(); };
  const pista = (on) => { if (body.contains('pista-cheia') !== on) clicar('.cena-pista'); };
  const viagem = (on) => { if (body.contains('viagem') !== on) clicar('.cena-viagem'); };
  const ambiente = (i) => (AMB[i] === 'viagem' ? viagem(true) : pista(true));
  const show = (on) => { if (on) document.dispatchEvent(new CustomEvent('so-show')); else if (body.contains('so-viagem')) document.getElementById('b-so-viagem')?.click(); };
  const tocar = (d) => d.transport.play({ at: ctx.currentTime });      // na batida exata, sem o lookahead
  const rampa = (de, ate, s0, s1) => {
    const id = setInterval(() => {
      const q = Math.min(1, Math.max(0, (agora() - s0) / (s1 - s0)));
      mixer.setCrossfader(de + (ate - de) * q * q * (3 - 2 * q));
      if (q >= 1) clearInterval(id);
    }, 1000 / 60);
  };
  const N = faixas.length;
  const letra = (i) => (i % 2 === 0 ? 'A' : 'B');
  const lado = (i) => (i % 2 === 0 ? 0 : 1);
  const noDeck = { A: 0, B: 1 };                                   // que faixa cada deck tem
  const tempoEm = (t) => { const bs = R.batidas; let lo = 0, hi = bs.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (bs[m] <= t) lo = m; else hi = m; } return R.tempos[Math.min(lo, R.tempos.length - 1)]; };
  // o pitch acompanha a rampa de BPM, nos dois decks, 60×/s
  const ultimo = { A: null, B: null };
  setInterval(() => {
    const T = tempoEm(agora());
    for (const L of ['A', 'B']) {
      const i = noDeck[L];
      if (i == null || !decks[L].pronta) continue;
      const p = T / bpms[i] - 1;
      if (ultimo[L] === null || Math.abs(p - ultimo[L]) > 1e-5) { decks[L].setPitch(p); ultimo[L] = p; }
    }
  }, 1000 / 60);
  V.playAt = ctx.currentTime;
  tocar(decks.A);                                                   // pré-drop da 1
  for (let i = 0; i < N; i++) {
    const f = R.faixas[i];
    em(f.drop_s, () => {                                            // DROP i: grave de volta, a anterior para, o ambiente
      if (i > 0) { mixer.canal(letra(i)).setKill('grave', false); decks[letra(i - 1)].pause(); }
      ambiente(i); show(true);
    });
    if (i >= 1 && i + 1 < N) em(f.drop_s + 0.3, async () => {       // a próxima entra no deck que acabou de sair
      const L = letra(i + 1);
      noDeck[L] = null; ultimo[L] = null;
      // até 4 tentativas (2 s virtuais cada; a última espera 20 s): carga que falha não passa calada
      for (let t = 1; t <= 4; t++) {
        try { await decks[L].carregarJamendo(faixas[i + 1], urls[i + 1]); } catch (e) { V.erros.push(`carga ${i + 1} tentativa ${t}: ${e?.message || e}`); }
        for (let k = 0; k < (t < 4 ? 40 : 400) && !decks[L].pronta; k++) await new Promise((r) => setTimeout(r, 50));
        if (decks[L].pronta) break;
        V.erros.push(`carga ${i + 1} tentativa ${t}: não ficou pronta`);
      }
      decks[L].transport.setPitchRange?.(0.5);
      decks[L].setPitch(tempoEm(R.faixas[i + 1].entrada_s) / bpms[i + 1] - 1);
      decks[L].seek(R.faixas[i + 1].fonte_ini_s);
      mixer.canal(L).setKill('grave', true);
      noDeck[L] = i + 1;
      (V.cargas ||= []).push({ faixa: i + 1, pronta: decks[L].pronta, em: +agora().toFixed(2) });
    });
    if (i + 1 < N) {
      const g = R.faixas[i + 1];
      em(g.entrada_s, () => { show(false); tocar(decks[letra(i + 1)]); rampa(lado(i), lado(i + 1), g.entrada_s, g.drop_s); });   // a próxima entra
      em(f.grave_sai_s, () => mixer.canal(letra(i)).setKill('grave', true));                                                  // troca de graves
    }
  }
  em(R.batidas[R.batidas.length - 1 - 8], () => show(false));      // fim: a CDJ de volta, 2 compassos antes
  return V.ms;
}, { R: { faixas: R.faixas, batidas: R.batidas, tempos: R.tempos }, faixas: cfg.faixas.map(jm), urls: cfg.faixas.map(urlJm), bpms: cfg.faixas.map((f) => f.bpm), AMB });

// ───────────── quadro a quadro ─────────────
const cdp = await pag.context().newCDPSession(pag);
// sem clip o CDP devolve em pixels CSS (1600×900); o scale do clip é absoluto → VW·DSF × VH·DSF
const foto = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, optimizeForSpeed: true,
  clip: { x: 0, y: 0, width: VW, height: VH, scale: DSF } })).data, 'base64');
const N = Math.round(DUR * FPS);
const querFoto = new Set(fotos.map((s) => Math.round(s * FPS)));
let ff = null;
const saida = join(pasta, modo === 'video' && process.argv[4] ? `app-cdj-${IDIOMA}-teste.mp4` : `app-cdj-${IDIOMA}.mp4`);
if (modo === 'video') {
  ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-',
    '-vf', 'sidedata=mode=delete:type=ICC_PROFILE,scale=in_range=pc:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-r', String(FPS), '-movflags', '+faststart', saida], { stdio: ['pipe', 'inherit', 'inherit'] });
}
const ini = Date.now();
for (let i = 0; i < N; i++) {
  await pag.evaluate((a) => { const V = __vt; if (a - 1000 / 60 > V.ms) V.passo(a - 1000 / 60); V.passo(a); }, V0 + (i * 1000) / FPS);
  if (ff) { if (!ff.stdin.write(await foto())) await new Promise((r) => ff.stdin.once('drain', r)); }
  else if (querFoto.has(i)) { const f = join(pasta, `app-${IDIOMA}-${(i / FPS).toFixed(2)}.jpg`); writeFileSync(f, await foto()); console.log(f); }
  if (i % 150 === 0 && i) { const s = (Date.now() - ini) / 1000; console.log(`${i}/${N} quadros · ${s.toFixed(0)} s · falta ~${((N - i) * s / i / 60).toFixed(1)} min`); }
}
const pagErros = await pag.evaluate(() => ({ erros: __vt.erros.slice(0, 10), carregou3: __vt.cargas || null }));
if (ff) { ff.stdin.end(); await new Promise((r) => ff.on('close', r)); }
await nav.close(); fecharSrv();
const seg = (Date.now() - ini) / 1000;
if (ff) {
  writeFileSync(saida.replace(/\.mp4$/, '.json'), JSON.stringify({ quadros: N, fps: FPS, tela: `${VW}x${VH}@${DSF}`, segundosGravando: Math.round(seg),
    idioma: IDIOMA, drops: R.faixas.map((f) => +(+f.drop_s).toFixed(3)), carregadas: pronto, fontes, cargas: pagErros.carregou3,
    errosRelogio: pagErros.erros, errosPagina: erros.filter((e) => !/BLOCKED_BY_CLIENT|blockedbyclient/.test(e)) }, null, 2));
  console.log(`ok ${saida} · ${N} quadros · ${(statSync(saida).size / 1e6).toFixed(1)} MB · ${(seg / 60).toFixed(1)} min (${(seg / N * 1000).toFixed(0)} ms/quadro)`);
}
console.log('cargas no meio:', JSON.stringify(pagErros.carregou3));
console.log('servidor:', logSrv.filter((l) => !/^200 /.test(l)).slice(-12).join(' | ') || 'ok', `(${logSrv.filter((l) => /^200 /.test(l)).length} respostas 200)`);
if (ff && !process.argv[4]) {
  const cargas = pagErros.carregou3 || [], esperadas = Math.max(0, NF - 2), ruins = cargas.filter((c) => !c.pronta).length;
  if (cargas.length < esperadas || ruins) {
    console.error(`GRAVAÇÃO RUIM: ${cargas.length}/${esperadas} cargas no meio, ${ruins} sem ficar prontas — não usar este vídeo`);
    for (const e of pagErros.erros) console.error('  ' + e);
    process.exit(2);
  }
}
const tudo = [...pagErros.erros, ...erros];
console.log(tudo.length ? 'ERROS:\n' + tudo.slice(0, 10).join('\n') : 'sem erros na página');
