// Comprime o vídeo final pra caber no upload pela extensão do Chrome (limite 10 MB):
// x264 em 2 passadas no bitrate que dá o tamanho alvo, AAC 128k, sem perfil ICC e com as
// tags bt709/tv (o "colr prof" do Chrome travava o upload no TikTok Studio).
// Uso: node comprimir.mjs entrada.mp4 saida.mp4 [MB alvo = 9.3]
import { spawnSync } from 'node:child_process';
import { statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/, (m, e) => 'ffprobe' + (e || ''));
const [ent, sai, mbArg] = process.argv.slice(2);
const alvo = Number(mbArg || 9.3) * 1e6;                              // bytes (MB decimal, com folga)
const dur = Number(spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', ent]).stdout.toString().trim());
const AUDIO = 128;                                                     // kbps
const video = Math.floor((alvo * 8 / dur / 1000 - AUDIO) * 0.97);     // 3% pro contêiner
const vf = 'sidedata=mode=delete:type=ICC_PROFILE,scale=in_range=pc:out_range=tv,format=yuv420p,setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709';
const log = join(dirname(sai), 'x264-2pass');
const comum = ['-y', '-loglevel', 'error', '-i', ent, '-vf', vf, '-c:v', 'libx264', '-preset', 'slow', '-b:v', video + 'k',
  '-maxrate', Math.round(video * 1.6) + 'k', '-bufsize', Math.round(video * 2) + 'k', '-passlogfile', log];
let r = spawnSync(FFMPEG, [...comum, '-pass', '1', '-an', '-f', 'mp4', process.platform === 'win32' ? 'NUL' : '/dev/null']);
if (r.status !== 0) throw new Error('passada 1: ' + r.stderr);
r = spawnSync(FFMPEG, [...comum, '-pass', '2', '-c:a', 'aac', '-b:a', AUDIO + 'k', '-movflags', '+faststart', sai]);
if (r.status !== 0) throw new Error('passada 2: ' + r.stderr);
for (const s of ['-0.log', '-0.log.mbtree']) rmSync(log + s, { force: true });
console.log(`ok ${sai} · ${(statSync(sai).size / 1e6).toFixed(2)} MB · vídeo ${video} kbps · ${dur.toFixed(2)} s`);
