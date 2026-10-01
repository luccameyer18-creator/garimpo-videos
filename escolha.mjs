// Vídeo de ESCOLHA: os drops candidatos em sequência, numerados, todos no mesmo
// volume, pro Lucca ouvir e escolher. Cada trecho: 1 compasso antes do drop + 3 depois.
// Uso: node escolha.mjs drops.json "titulo1|titulo2|..."  → saida/escolha.mp4
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FONTE = process.env.FONTE_ESCOLHA || 'hf-molde/assets/fonts/ArchivoBlack-Regular.ttf';
const drops = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// sem lista: todas; com POR_TAG=n, as n de drop mais forte de cada gênero (agrupadas por gênero)
const POR_TAG = Number(process.env.POR_TAG || 0);
const ordem = process.argv[3] ? process.argv[3].split('|')
  : POR_TAG ? Object.values(drops.reduce((m, d) => ((m[d.tag || '-'] ||= []).push(d), m), {}))
    .flatMap((v) => v.sort((a, b) => b.forca - a.forca).slice(0, POR_TAG)).map((d) => d.titulo)
  : drops.map((d) => d.titulo);
const lista = ordem.map((t) => drops.find((d) => d.titulo.startsWith(t))).filter(Boolean);
mkdirSync('saida/escolha', { recursive: true });

// cada linha centralizada sozinha, com fonte que CABE na largura (antes o bloco inteiro era
// centralizado pela linha mais larga e o número saía cortado na borda — reclamação do Lucca)
const cabe = (s, max, larg = 640) => Math.max(22, Math.min(max, Math.floor(larg / (0.6 * Math.max(1, [...s].length)))));
const curto = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join('').trim() + '…' : s);
const partes = [];
lista.forEach((d, i) => {
  const ini = Math.max(0, d.drop_s - 4 * d.batida_s), dur = 16 * d.batida_s;
  const titulo = curto(d.titulo.replace(/\s*\(original mix\)\.?/i, '').replace(/\s*[-–]\s*Electromagna.*$/i, ''), 30);
  const info = `${d.tag ? d.tag.toUpperCase() + ' · ' : ''}${Math.round(d.bpm)} BPM · drop ${Math.floor(d.drop_s / 60)}:${String(Math.round(d.drop_s % 60)).padStart(2, '0')} · ${d.licenca.replace(/^CC /i, 'CC ').toUpperCase()}`;
  const linhas = [[String(i + 1), 230, 330], [titulo, cabe(titulo, 58), 640], [curto(d.artista, 32), cabe(curto(d.artista, 32), 42), 720], [info, cabe(info, 28), 800]];
  const txt = linhas.map((l, k) => { const f = `saida/escolha/t${i}-${k}.txt`; writeFileSync(f, l[0]); return f; });
  const desenho = linhas.map((l, k) => `drawtext=fontfile='${FONTE}':textfile='${txt[k]}':fontcolor=${k === 0 ? '0xff4ecd' : k === 3 ? '0xb9aed6' : 'white'}:fontsize=${l[1]}:x=(w-text_w)/2:y=${l[2]}`).join(',');
  const out = `saida/escolha/p${i}.mp4`;
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'lavfi', '-i', `color=c=0x0b0616:s=720x1280:r=30:d=${dur.toFixed(3)}`,
    '-ss', ini.toFixed(3), '-t', dur.toFixed(3), '-i', d.arquivo,
    '-filter_complex', `[0]${desenho}[v];[1]loudnorm=I=-10:TP=-1:LRA=11,afade=t=in:d=0.02,afade=t=out:st=${(dur - 0.08).toFixed(3)}:d=0.08,aresample=48000[a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-shortest', out]);
  if (r.status !== 0) { console.error('falhou', d.titulo, r.stderr?.toString().slice(0, 300)); return; }
  partes.push(out);
});
writeFileSync('saida/escolha/lista.txt', partes.map((p) => `file '${p.replace('saida/escolha/', '')}'`).join('\n'));
const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'saida/escolha/lista.txt', '-c', 'copy', 'saida/escolha.mp4']);
console.log(r.status === 0 ? `ok saida/escolha.mp4 (${partes.length} drops)` : 'concat falhou ' + r.stderr);
lista.forEach((d, i) => console.log(`${i + 1}. ${d.titulo} — ${d.artista} · ${d.licenca} · ${d.link}`));
