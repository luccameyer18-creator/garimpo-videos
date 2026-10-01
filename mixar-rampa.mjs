// Mixagem de DJ com RAMPA DE BPM (pedido do Lucca, 30/09: "faz a mudança gradual por bpm,
// começa do mais baixo até o mais alto"). As faixas vêm em ordem de BPM (do menor pro maior):
//   - cada DROP começa no BPM da própria faixa;
//   - nos 8 compassos até o próximo drop o andamento sobe suave (smoothstep) até o BPM da
//     próxima, e as DUAS faixas acompanham (rubberband com o tempo mudando a cada 1/4 de
//     batida via asendcmd) — sempre batida com batida;
//   - cada faixa entra 4 compassos antes do SEU drop (pré-drop sempre), por cima do drop da
//     anterior; troca de graves no último compasso; a que sai desce tarde (1−q⁴) até o drop;
//   - SEM corte antes do drop (o respiro soava como o vídeo travando).
// Linha do tempo em compassos: drops em cfg.drops (ex. 4,12,20,28,36), fim em cfg.fimComp.
// Uso: node mixar-rampa.mjs dias/<id>.json → saida/<id>/mix.wav + mix.json (régua em segundos:
//      batidas, tempo por batida, entradas, drops, trocas de grave, fim)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const pasta = join(AQUI, 'saida', cfg.id);
const tmp = join(AQUI, 'tmp');
mkdirSync(pasta, { recursive: true }); mkdirSync(tmp, { recursive: true });
const SR = 48000;
const F = cfg.faixas;
const N = F.length;
const DROPS = cfg.drops;                       // compassos
const NB = (cfg.fimComp) * 4;                  // batidas no vídeo
const dB = DROPS.map((d) => d * 4);            // batida de cada drop
const B = F.map((f) => f.bpm);

// ───────── o andamento, batida a batida ─────────
const suave = (q) => q * q * (3 - 2 * q);
function tempo(b) {                             // b = batida (fracionária) no vídeo
  if (b < dB[0]) return B[0];
  for (let i = 0; i < N - 1; i++) if (b < dB[i + 1]) return B[i] + (B[i + 1] - B[i]) * suave((b - dB[i]) / (dB[i + 1] - dB[i]));
  return B[N - 1];
}
// tempo de vídeo de cada batida: integra 60/T em passos de 1/32 de batida
const batidas = [0];
{
  let t = 0;
  for (let b = 0; b < NB; b++) {
    for (let k = 0; k < 32; k++) t += (60 / tempo(b + (k + 0.5) / 32)) / 32;
    batidas.push(t);
  }
}
const tB = (b) => {                              // batida fracionária → segundos
  const i = Math.max(0, Math.min(NB - 1, Math.floor(b)));
  return batidas[i] + (batidas[i + 1] - batidas[i]) * (b - i);
};
const n = Math.round(batidas[NB] * SR);
const L = new Float32Array(n), R = new Float32Array(n);

// passa-alta de 2ª ordem com a frequência mudando por amostra (corta o grave da que sai)
function passaAlta() {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (v, fc) => {
    if (fc < 25) { x2 = x1; x1 = v; y2 = y1; y1 = v; return v; }
    const w = 2 * Math.PI * fc / SR, a = Math.sin(w) / (2 * 0.707), c = Math.cos(w);
    const b0 = (1 + c) / 2, b1 = -(1 + c), b2 = b0, a0 = 1 + a, a1 = -2 * c, a2 = 1 - a;
    const y = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1; x1 = v; y2 = y1; y1 = y; return y;
  };
}

// estica a faixa i a partir de srcIni seguindo o andamento do vídeo (rubberband + asendcmd)
function esticar(f, i, e, x, srcIni) {
  const bat = 60 / f.bpm;
  const cmds = [];
  for (let k = 0; k <= (x - e) * 4; k++) cmds.push(`${(k / 4 * bat).toFixed(4)} rubberband tempo ${(tempo(e + k / 4 + 0.125) / f.bpm).toFixed(6)};`);
  const arqCmd = join(tmp, `rampa-${cfg.id}-${i}.txt`);
  writeFileSync(arqCmd, cmds.join('\n'));
  const r = spawnSync(FFMPEG, ['-v', 'error', '-ss', srcIni.toFixed(4), '-t', ((x - e) * bat + 1.0).toFixed(4), '-i', join(AQUI, f.arquivo),
    '-af', `asendcmd=f=${relative(AQUI, arqCmd).replace(/\\/g, '/')},rubberband=tempo=${(tempo(e + 0.125) / f.bpm).toFixed(6)}:pitchq=quality,loudnorm=I=-10:TP=-1.5:LRA=11,aresample=${SR}`,
    '-ac', '2', '-ar', String(SR), '-f', 'f32le', '-'], { maxBuffer: 1 << 30, cwd: AQUI });
  if (r.status !== 0) throw new Error(`faixa ${i}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
// onde cai o bumbo em relação à grade: mediana do desvio (ms) do ataque do grave mais forte
// perto de cada batida esperada (sem o 1º e o último compasso, que têm rampa de volume)
function desvioBumbo(pcm, t0, bIni, bFim) {
  const env = [], w = SR / 1000;                               // 1 ms
  let lp = 0, lp2 = 0; const a = 1 - Math.exp(-2 * Math.PI * 120 / SR);
  for (let k = 0, s = 0, c = 0; k * 2 < pcm.length; k++) {
    lp += a * ((pcm[k * 2] + pcm[k * 2 + 1]) / 2 - lp); lp2 += a * (lp - lp2);
    s += lp2 * lp2; if (++c === w) { env.push(Math.sqrt(s / w)); s = 0; c = 0; }
  }
  const on = env.map((v, i) => Math.max(0, v - (env[i - 4] || 0)));
  const desv = [];
  for (let b = bIni; b < bFim; b++) {
    const c = Math.round((batidas[b] - t0) * 1000);
    let m = [0, 0]; for (let d = -90; d <= 90; d++) { const v = on[c + d] || 0; if (v > m[1]) m = [d, v]; }
    if (m[1] > 0) desv.push(m[0]);
  }
  desv.sort((p, q) => p - q);
  return desv.length ? desv[Math.floor(desv.length / 2)] : 0;
}

const faixasOut = [];
F.forEach((f, i) => {
  const e = dB[i] - 16;                                       // entra 4 compassos antes do drop
  const x = i < N - 1 ? dB[i + 1] : NB;                        // sai no drop da próxima (ou no fim)
  const bat = 60 / f.bpm;
  let srcIni = f.drop_s - 16 * bat;
  // calibra: mede onde o bumbo caiu, corrige o início e estica de novo (até 2 vezes)
  let pcm = esticar(f, i, e, x, srcIni), desv = 0;
  for (let volta = 0; volta < 2; volta++) {
    desv = desvioBumbo(pcm, tB(e), e + 4, x - 4);
    if (Math.abs(desv) <= 3) break;
    srcIni += (desv / 1000) * (tempo(dB[i]) / f.bpm);         // bumbo adiantado (desv<0) → começa antes
    pcm = esticar(f, i, e, x, srcIni);
  }
  const desvFinal = desvioBumbo(pcm, tB(e), e + 4, x - 4);
  console.log(`  ${f.titulo}: bumbo ${desvFinal >= 0 ? '+' : ''}${desvFinal} ms da grade (início ${srcIni.toFixed(3)} s)`);
  const off = Math.round(tB(e) * SR);
  const hpL = passaAlta(), hpR = passaAlta();
  const tEntra = tB(e), tEntraCheia = tB(e + 4);
  const tSaiGrave = tB(x - 4), tSai = tB(x);
  const tFim = batidas[NB];
  for (let k = 0; k * 2 + 1 < pcm.length; k++) {
    const idx = off + k;
    if (idx >= n) break;
    const tv = idx / SR;
    if (tv >= tSai) break;
    let g = i === 0 ? 1 : Math.min(1, (tv - tEntra) / (tEntraCheia - tEntra));   // entrada: 1 compasso subindo
    let fc = 0;
    if (i < N - 1 && tv >= tSaiGrave) {
      const q = Math.min(1, (tv - tSaiGrave) / (tSai - tSaiGrave));
      fc = 40 + 360 * Math.min(1, q * 4);                      // grave some em 1/4 de compasso
      g *= 1 - q * q * q * q;                                  // e desce tarde até o drop da próxima
    }
    if (i === N - 1 && tv > tFim - 2 * (60 / B[N - 1])) g *= Math.max(0, (tFim - tv) / (2 * (60 / B[N - 1])));
    L[idx] += hpL(pcm[k * 2], fc) * g;
    R[idx] += hpR(pcm[k * 2 + 1], fc) * g;
  }
  faixasOut.push({ titulo: f.titulo, artista: f.artista, licenca: f.licenca, link: f.link, bpm: f.bpm,
    entrada_s: +tEntra.toFixed(4), drop_s: +tB(dB[i]).toFixed(4), grave_sai_s: i < N - 1 ? +tSaiGrave.toFixed(4) : null, sai_s: +tSai.toFixed(4),
    fonte_ini_s: +srcIni.toFixed(4) });
});

// limitador simples: nada passa de −1 dBFS
let pico = 0; for (let k = 0; k < n; k++) pico = Math.max(pico, Math.abs(L[k]), Math.abs(R[k]));
const alvo = 0.89, ganho = pico > alvo ? alvo / pico : 1;
const pcmOut = Buffer.alloc(n * 4);
for (let k = 0; k < n; k++) {
  const sat = (v) => Math.max(-1, Math.min(1, Math.tanh(v * ganho * 1.15) / Math.tanh(1.15)));
  pcmOut.writeInt16LE(Math.round(sat(L[k]) * 32767), k * 4);
  pcmOut.writeInt16LE(Math.round(sat(R[k]) * 32767), k * 4 + 2);
}
const cab = Buffer.alloc(44);
cab.write('RIFF', 0); cab.writeUInt32LE(36 + pcmOut.length, 4); cab.write('WAVE', 8); cab.write('fmt ', 12);
cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(2, 22); cab.writeUInt32LE(SR, 24);
cab.writeUInt32LE(SR * 4, 28); cab.writeUInt16LE(4, 32); cab.writeUInt16LE(16, 34); cab.write('data', 36); cab.writeUInt32LE(pcmOut.length, 40);
writeFileSync(join(pasta, 'mix.wav'), Buffer.concat([cab, pcmOut]));
const regua = {
  rampa: true, drops_comp: DROPS, fimComp: cfg.fimComp, bpm: B,
  fim_s: +batidas[NB].toFixed(4),
  drops_s: dB.map((b) => +tB(b).toFixed(4)),
  faixas: faixasOut,
  batidas: batidas.map((t) => +t.toFixed(4)),                 // segundos de cada batida (0..NB)
  tempos: Array.from({ length: NB }, (_, b) => +tempo(b + 0.5).toFixed(3)),   // BPM no meio de cada batida
};
writeFileSync(join(pasta, 'mix.json'), JSON.stringify(regua));
console.log(`ok ${join(pasta, 'mix.wav')} · ${regua.fim_s.toFixed(2)} s · BPM ${B.map((b) => b.toFixed(1)).join(' → ')} · drops em ${regua.drops_s.map((d) => d.toFixed(2)).join(', ')} s · ganho ${ganho.toFixed(2)}`);
