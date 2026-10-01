// Faixas do Jamendo que PODEM tocar num vídeo postado: licença CC BY ou CC BY-SA
// (sem NC/ND — o vídeo divulga o Garimpo). Ordena por popularidade no Jamendo,
// que é o único sinal de "é boa" que existe sem ouvir.
// Uso: node jamendo-cc.mjs "techno,house,hardtechno"   → JSON
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ID = readFileSync(join(homedir(), '.garimpo', 'jamendo-client-id.txt'), 'utf8').trim();
const tags = (process.argv[2] || 'techno,house').split(',').map((s) => s.trim());
const livre = (u) => /creativecommons\.org\/licenses\/by(-sa)?\//.test(u || '');

const saida = [];
for (const tag of tags) {
  for (const offset of [0, 200, 400]) {
    const q = new URLSearchParams({ client_id: ID, format: 'json', limit: '200', offset: String(offset), tags: tag,
      include: 'musicinfo licenses stats', order: 'popularity_total', audioformat: 'mp32' });
    let j;
    try { j = await (await fetch('https://api.jamendo.com/v3.0/tracks/?' + q, { signal: AbortSignal.timeout(20000) })).json(); } catch { continue; }
    if (j?.headers?.status !== 'success') continue;
    for (const t of j.results || []) {
      if (!livre(t.license_ccurl) || !t.audiodownload_allowed) continue;
      if (t.duration < 120 || t.duration > 480) continue;
      if (t.musicinfo?.vocalinstrumental === 'vocal' && !/techno|house/.test(tag)) continue;
      saida.push({ tag, id: t.id, titulo: t.name, artista: t.artist_name, dur: t.duration,
        licenca: t.license_ccurl.replace(/^https?:\/\/creativecommons\.org\/licenses\//, 'CC ').replace(/\/$/, ''),
        ouvidas: t.stats?.listened_total ?? t.stats?.listened ?? null, downloads: t.stats?.downloads_total ?? null,
        popularidade: t.stats?.popularity_total ?? null, velocidade: t.musicinfo?.speed, generos: (t.musicinfo?.tags?.genres || []).join('/'),
        link: t.shareurl });
    }
  }
}
const vistos = new Set();
const unicas = saida.filter((x) => !vistos.has(x.id) && vistos.add(x.id));
console.log(JSON.stringify(unicas));
