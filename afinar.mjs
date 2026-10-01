// Afina o que o drops.mjs achou de cada faixa, pelo BUMBO:
//   1. BPM: pente de batidas no grave (< 120 Hz) testando o valor achado e as leituras erradas
//      comuns (½, 2×, ⅔, 1,5×, ¾, 4/3) — a Metal Tears saiu 116 no drops.mjs e era 180;
//      refina em passos de 0,02 e arredonda pro inteiro se estiver a menos de 0,06 dele.
//   2. DROP: cola o drop na fase do bumbo (a fase com mais ataque ao longo de 8 s), na batida
//      mais perto da marcada — sem isso as duas faixas da passagem "galopam" (flam).
// Uso: node afinar.mjs drops.json "titulo1|titulo2|…" > afinadas.json
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const drops = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const quais = process.argv[3] ? process.argv[3].split('|') : drops.map((d) => d.titulo);
const SR = 8000;

function grave(arq, ini, dur) {
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', Math.max(0, ini).toFixed(3), '-t', String(dur), '-i', existsSync(arq) ? arq : join(AQUI, arq),
    '-ac', '1', '-ar', String(SR), '-af', 'lowpass=f=120,lowpass=f=120', '-f', 's16le', '-'], { maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(`ffmpeg ${arq}: ${r.stderr}`);
  return new Int16Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 2);
}
function ataques(x, msJanela) {
  const w = Math.round(SR * msJanela / 1000), e = [];
  for (let i = 0; i + w <= x.length; i += w) { let s = 0; for (let k = 0; k < w; k++) s += x[i + k] * x[i + k]; e.push(Math.sqrt(s / w)); }
  const atraso = Math.max(1, Math.round(4 / msJanela));
  return e.map((v, i) => Math.max(0, v - (e[i - atraso] || 0)));
}
function pente(on, msJanela, bpm) {
  const lag = 60 / bpm / (msJanela / 1000);
  let s = 0;
  for (const k of [1, 2, 4, 8]) { const L = Math.round(lag * k); for (let i = 0; i + L < on.length; i++) s += on[i] * on[i + L]; }
  return s;
}
const saida = [];
for (const titulo of quais) {
  const d = drops.find((x) => x.titulo.startsWith(titulo));
  if (!d) { console.error('não achei', titulo); continue; }
  // 1) BPM pelo pente, 40 s depois do drop
  const on2 = ataques(grave(d.arquivo, d.drop_s, 40), 2);
  // varre tudo (95–195): a leitura errada pode cair longe de ½/2×/1,5× exatos (Metal Tears: 116 → 180)
  let global = { bpm: d.bpm, s: -1 };
  for (let b = 95; b <= 195; b += 0.1) { const s = pente(on2, 2, b); if (s > global.s) global = { bpm: b, s }; }
  // o valor do drops.mjs só fica se o pente dele estiver a 5% do melhor (não troca o que já estava certo)
  let local = { bpm: d.bpm, s: -1 };
  for (let b = d.bpm * 0.99; b <= d.bpm * 1.01; b += 0.02) { const s = pente(on2, 2, b); if (s > local.s) local = { bpm: b, s }; }
  let melhor = local.s >= 0.95 * global.s ? local : global;
  for (let b = melhor.bpm - 0.1; b <= melhor.bpm + 0.1; b += 0.01) { const s = pente(on2, 2, b); if (s > melhor.s) melhor = { bpm: b, s }; }
  let bpm = Math.abs(melhor.bpm - Math.round(melhor.bpm)) < 0.06 ? Math.round(melhor.bpm) : +melhor.bpm.toFixed(2);
  // 2) fase do bumbo em 8 s a partir de 0,3 s antes do drop marcado; drop = batida dessa fase mais perto
  const ini = d.drop_s - 0.3, on1 = ataques(grave(d.arquivo, ini, 8), 1), ms = 60000 / bpm;
  let fase = [0, -1];
  for (let ph = 0; ph < ms; ph++) { let s = 0; for (let t = ph; t < on1.length; t += ms) { const i = Math.round(t); s += Math.max(on1[i] || 0, on1[i + 1] || 0, on1[i - 1] || 0); } if (s > fase[1]) fase = [ph, s]; }
  const k = Math.round((300 - fase[0]) / ms), drop = +(ini + (fase[0] + k * ms) / 1000).toFixed(4);
  saida.push({ ...d, bpm, batida_s: +(60 / bpm).toFixed(5), drop_s: drop, bpm_drops: d.bpm, drop_drops: d.drop_s });
  console.error(`${d.titulo}: ${d.bpm} → ${bpm} BPM · drop ${d.drop_s} → ${drop} s`);
}
console.log(JSON.stringify(saida, null, 1));
