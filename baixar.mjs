// Baixa as faixas do dia (dias/<id>.json → faixas[].arquivo, faixas[].link) do Jamendo, uma vez
// cada, com espera se o Jamendo pedir calma (429). Só faixas CC BY / CC BY-SA entram nos dias.
// Uso: node baixar.mjs dias/<id>.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
for (const f of cfg.faixas) {
  if (!/^CC BY(-SA)? /i.test(f.licenca)) throw new Error(`licença que não pode ir em vídeo: ${f.titulo} (${f.licenca})`);
  const destino = join(AQUI, f.arquivo);
  if (existsSync(destino) && statSync(destino).size > 100000) { console.log('já tenho', f.arquivo); continue; }
  const id = f.link.match(/track\/(\d+)/)[1];
  const url = `https://prod-1.storage.jamendo.com/?trackid=${id}&format=mp32`;
  for (let tentativa = 1; ; tentativa++) {
    const r = await fetch(url, { signal: AbortSignal.timeout(120000) }).catch((e) => ({ ok: false, status: 'rede: ' + e.message }));
    if (r.ok) {
      const buf = Buffer.from(await r.arrayBuffer());
      mkdirSync(dirname(destino), { recursive: true });
      writeFileSync(destino, buf);
      console.log(`ok ${f.arquivo} (${(buf.length / 1e6).toFixed(1)} MB) · ${f.titulo} — ${f.artista}`);
      break;
    }
    if (tentativa >= 6) throw new Error(`não consegui baixar ${f.titulo}: ${r.status}`);
    const ms = r.status === 429 ? 60000 * tentativa : 10000 * tentativa;
    console.log(`  ${f.titulo}: ${r.status}, tento de novo em ${ms / 1000} s`);
    await espera(ms);
  }
  await espera(3000);                                      // devagar com o Jamendo
}
