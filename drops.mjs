// Acha o DROP de cada faixa (o maior salto de grave logo depois de uma quebra),
// o BPM e o compasso, e mede a força do drop e o master. Baixa o áudio só de
// faixas CC BY / BY-SA (a licença deixa pôr em vídeo, com crédito).
// Uso: node drops.mjs candidatas.json   (lista [{fonte:'jamendo', id, titulo, artista, licenca}])
//      → audio/<fonte>-<id>.mp3 e drops.json
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const SR = 11025;
mkdirSync('audio', { recursive: true });

function url(c) {
  if (c.url) return c.url;                                   // biblioteca do TikTok: o endereço do som
  if (c.fonte === 'jamendo') return `https://prod-1.storage.jamendo.com/?trackid=${c.id}&format=mp32`;
  if (c.fonte === 'audius') return `https://api.audius.co/v1/tracks/${c.id}/stream?app_name=garimpo`;
  throw new Error('fonte ' + c.fonte);
}
// devagar com o Jamendo: 3 s entre faixas e espera crescente se ele pedir calma (429)
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function baixar(c) {
  const f = `audio/${c.fonte}-${c.id}.mp3`;
  if (existsSync(f)) return f;
  for (let t = 1; ; t++) {
    const r = await fetch(url(c), { signal: AbortSignal.timeout(120000) }).catch((e) => ({ ok: false, status: 'rede: ' + e.message }));
    if (r.ok) { writeFileSync(f, Buffer.from(await r.arrayBuffer())); await espera(3000); return f; }
    if (t >= 5) throw new Error('download ' + r.status);
    await espera(r.status === 429 ? 60000 * t : 10000 * t);
  }
}
function pcm(f) {
  return new Promise((ok, erro) => {
    const ff = spawn(FFMPEG, ['-loglevel', 'error', '-i', f, '-ac', '1', '-ar', String(SR), '-f', 'f32le', '-']);
    const ch = []; ff.stdout.on('data', (d) => ch.push(d)); ff.on('close', () => {
      const b = Buffer.concat(ch); ok(new Float32Array(b.buffer, b.byteOffset, b.length / 4));
    }); ff.on('error', erro);
  });
}
function lufs(f, ini, dur) {
  return new Promise((ok) => {
    const ff = spawn(FFMPEG, ['-hide_banner', '-nostats', '-ss', String(ini), '-t', String(dur), '-i', f, '-af', 'ebur128', '-f', 'null', '-']);
    let e = ''; ff.stderr.on('data', (d) => { e += d; });
    ff.on('close', () => { const m = e.match(/Integrated loudness:\s*\n\s*I:\s*(-?[\d.]+) LUFS/); ok(m ? +m[1] : null); });
  });
}

function analisar(x) {
  // grave (passa-baixa ~120 Hz, 2 polos) em janelas de 10 ms
  const H = Math.round(SR * 0.01), n = Math.floor(x.length / H);
  const g = new Float32Array(n), tot = new Float32Array(n);
  let a = 0, b = 0; const k = 1 - Math.exp(-2 * Math.PI * 120 / SR);
  for (let i = 0; i < n; i++) {
    let sg = 0, st = 0;
    for (let j = 0; j < H; j++) { const v = x[i * H + j]; a += k * (v - a); b += k * (a - b); sg += b * b; st += v * v; }
    g[i] = Math.sqrt(sg / H); tot[i] = Math.sqrt(st / H);
  }
  // BPM: autocorrelação do fluxo do grave, 110–150 BPM (acid house / techno)
  const fl = new Float32Array(n); for (let i = 1; i < n; i++) fl[i] = Math.max(0, g[i] - g[i - 1]);
  let melhor = 0, lagB = 0;
  for (let lag = Math.round(6000 / 150); lag <= Math.round(6000 / 110); lag++) {
    let s = 0; for (let i = 0; i + lag < n; i++) s += fl[i] * fl[i + lag];
    if (s > melhor) { melhor = s; lagB = lag; }
  }
  // refina o período com resolução fracionária (parábola nos vizinhos)
  const ac = (L) => { let s = 0; for (let i = 0; i + L < n; i++) s += fl[i] * fl[i + L]; return s; };
  const y0 = ac(lagB - 1), y1 = ac(lagB), y2 = ac(lagB + 1);
  const lag = lagB + (y0 - y2) / (2 * (y0 - 2 * y1 + y2) || 1);
  const B = lag * 0.01, bpm = 60 / B;
  // fase: onde as batidas caem com mais fluxo
  let fase = 0, mf = -1;
  for (let p = 0; p < lagB; p++) { let s = 0; for (let t = p; t < n; t += lag) s += fl[Math.round(t)] || 0; if (s > mf) { mf = s; fase = p; } }
  // energia do grave por compasso (4 batidas) a partir da fase
  const barra = 4 * lag, barras = [];
  for (let t = fase; t + barra < n; t += barra) { let s = 0; const i0 = Math.round(t), i1 = Math.round(t + barra); for (let i = i0; i < i1; i++) s += g[i]; barras.push({ t: t * 0.01, e: s / (i1 - i0) }); }
  const maxE = Math.max(...barras.map((q) => q.e));
  // drop: compasso cujo grave dos 4 seguintes é alto e o dos 4 anteriores é baixo
  let drop = null;
  for (let i = 4; i + 4 <= barras.length; i++) {
    if (barras[i].t < 15 || barras[i].t > x.length / SR - 25) continue;
    const pre = (barras[i - 1].e + barras[i - 2].e + barras[i - 3].e + barras[i - 4].e) / 4;
    const pos = (barras[i].e + barras[i + 1].e + barras[i + 2].e + barras[i + 3].e) / 4;
    const nota = (pos / (pre + maxE * 0.03)) * (pos / maxE);
    if (!drop || nota > drop.nota) drop = { t: barras[i].t, nota, salto: pos / (pre + 1e-9), cheio: pos / maxE };
  }
  return { bpm: +bpm.toFixed(2), batida_s: +B.toFixed(4), drop };
}

const cands = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const res = [];
for (const c of cands) {
  try {
    const f = await baixar(c);
    const x = await pcm(f);
    const a = analisar(x);
    const ini = Math.max(0, a.drop.t - 8 * a.batida_s);
    const l = await lufs(f, ini, 24 * a.batida_s);
    res.push({ ...c, arquivo: f, dur: +(x.length / SR).toFixed(1), bpm: a.bpm, batida_s: a.batida_s, drop_s: +a.drop.t.toFixed(3),
      salto: +a.drop.salto.toFixed(2), cheio: +a.drop.cheio.toFixed(2), forca: +a.drop.nota.toFixed(2), lufs: l });
    console.error(`ok ${c.titulo} — ${c.artista}: ${a.bpm} BPM, drop ${a.drop.t.toFixed(1)} s, salto ${a.drop.salto.toFixed(1)}×, ${l} LUFS`);
  } catch (e) { console.error(`falhou ${c.titulo}: ${e.message}`); }
}
res.sort((p, q) => q.forca - p.forca);
writeFileSync('drops.json', JSON.stringify(res, null, 2));
console.log(JSON.stringify(res.map((r) => [r.titulo, r.artista, r.bpm, r.drop_s, r.salto, r.cheio, r.lufs])));
