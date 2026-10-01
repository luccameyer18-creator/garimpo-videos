// Monta o DIA a partir das faixas afinadas (afinar.mjs): dias/<id>.json (o que a fábrica grava)
// e dias/<id>.posts.json (legenda + comentário + horário em PT, ES e EN).
// As faixas entram em ordem de BPM (rampa do mais lento pro mais rápido) e os drops a cada 8
// compassos; os ambientes alternam viagem (a Full HD nova) e pista.
// Uso: node planejar.mjs <id> <gênero> afinadas.json "titulo1|titulo2|…" [app_commit]
//   ex.: node planejar.mjs 2026-10-02-hardstyle hardstyle afinadas.json "Mesmerize|Leviathan|Kick"
import { readFileSync, writeFileSync } from 'node:fs';

const [id, genero, arqAfinadas, ordemTxt, appCommit] = process.argv.slice(2);
const afinadas = JSON.parse(readFileSync(arqAfinadas, 'utf8'));
const faixas = ordemTxt.split('|').map((t) => {
  const f = afinadas.find((x) => x.titulo.toLowerCase().includes(t.toLowerCase()));
  if (!f) throw new Error('não achei a faixa: ' + t);
  return f;
}).sort((a, b) => a.bpm - b.bpm);
const N = faixas.length;
// título limpo pro cartão: tira "Artista - " do começo, "(original mix)", "(… 2017)", "( HardStyle …)"
const limpo = (t, artista) => t.replace(new RegExp('^' + artista.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*', 'i'), '')
  .replace(/\s*\((original mix|[^)]*(edit|mix|hardstyle|20\d\d)[^)]*)\)\s*/gi, ' ').replace(/\s+/g, ' ').trim();
const lic = (l) => 'CC ' + l.replace(/^CC\s*/i, '').replace(/\/(\d\.\d)(\/(\w+))?$/, (m, v, x, p) => ' ' + v + (p ? ' ' + p.toUpperCase() : '')).toUpperCase().replace(/^CC CC /, 'CC ') + ' · Jamendo';
const cfg = {
  id, genero, app_commit: appCommit || '247849bc3eb169a2f91acdb29341cdc8b54773fa', idiomas: ['pt', 'es', 'en'],
  // abertura curta (01/10): a viagem em tela cheia com a pergunta no 1º quadro e o 1º drop em 1 compasso;
  // os drops alternam pista/viagem a partir daí (o 1º drop corta da viagem pra pista)
  abertura: 'viagem', drops: Array.from({ length: N }, (_, i) => 1 + 8 * i), fimComp: 1 + 8 * (N - 1) + 8, rampa: true,
  ambientes: faixas.map((_, i) => (i % 2 === 0 ? 'pista' : 'viagem')),
  faixas: faixas.map((f) => ({ arquivo: f.arquivo, drop_s: f.drop_s, batida_s: f.batida_s, bpm: f.bpm,
    titulo: limpo(f.titulo, f.artista), artista: f.artista.replace(/\.$/, ''),
    // biblioteca de sons do TikTok (isenta de royalties): o dia vira "privado" (áudio criptografado na nuvem)
    ...(f.fonte === 'tiktok' ? { fonte: 'tiktok', id: f.id, url: f.url, licenca: 'som isento de royalties · TikTok', link: f.link || null }
      : { licenca: lic(f.licenca), link: f.link }) })),
};
if (cfg.faixas.some((f) => f.fonte === 'tiktok')) cfg.privado = true;
writeFileSync(`dias/${id}.json`, JSON.stringify(cfg, null, 1));

// ───────── legendas (3 línguas) ─────────
const b0 = Math.round(faixas[0].bpm), b1 = Math.round(faixas[N - 1].bpm), rampa = b1 - b0 >= 3;
const lista = cfg.faixas.map((f, i) => `${i + 1}. ${f.titulo} – ${f.artista} (${Math.round(f.bpm)})`).join('\n');
const nums = (e) => (N === 3 ? `1, 2 ${e} 3` : `1–${N}`);
const licencas = cfg.privado ? null : [...new Set(cfg.faixas.map((f) => f.licenca.replace(/ \d\.\d.*$/, '')))].join(' / ');
// crédito da música: CC do Jamendo, ou os sons isentos de royalties do próprio TikTok
const credito = { pt: licencas ? `${licencas} · Jamendo` : 'sons isentos de royalties do TikTok', es: licencas ? `${licencas} · Jamendo` : 'sonidos libres de regalías de TikTok', en: licencas ? `${licencas} · Jamendo` : 'royalty-free TikTok sounds' };
const TAGS = {
  techno: { pt: '#techno #hardtechno #trackid #djtok #musicaeletronica', es: '#techno #hardtechno #trackid #djtok #musicaelectronica', en: '#techno #hardtechno #trackid #djtok #cdj' },
  hardstyle: { pt: '#hardstyle #hardtechno #rave #trackid #djtok', es: '#hardstyle #hardtechno #rave #trackid #djtok', en: '#hardstyle #hardtechno #rave #trackid #djtok' },
  'acid house': { pt: '#acidhouse #acid #techno #trackid #djtok', es: '#acidhouse #acid #techno #trackid #djtok', en: '#acidhouse #acid #techno #trackid #djtok' },
  funk: { pt: '#funk #funkbrasileiro #bailefunk #trackid #djtok', es: '#funk #funkbrasileño #brazilianfunk #trackid #djtok', en: '#brazilianfunk #funk #phonk #trackid #djtok' },
};
const tag = TAGS[genero] || { pt: `#${genero.replace(/\s+/g, '')} #trackid #djtok #rave #musicaeletronica`, es: `#${genero.replace(/\s+/g, '')} #trackid #djtok #rave #musicaelectronica`, en: `#${genero.replace(/\s+/g, '')} #trackid #djtok #rave #dj` };
const posts = {
  pt: {
    legenda: `${rampa ? `do ${b0} ao ${b1} BPM: ` : ''}qual desses ${N} drops de ${genero} é o melhor? ⚡ comenta ${N === 3 ? '1, 2 ou 3' : `de 1 a ${N}`} 👇\n⛏️ Garimpo: acha música que quase ninguém ouviu, DJ automático que te dá aula e CDJ grátis online\n${lista}\n🎵 ${credito.pt} · tocado na CDJ do Garimpo (grátis, no navegador) · link no comentário 📌\n${tag.pt}`,
    comentario: 'o Garimpo tá aqui ⛏️ garimpo-topaz.vercel.app (de graça, abre no navegador do celular)', horario: '19:30 (Brasília)' },
  es: {
    legenda: `${rampa ? `del ${b0} al ${b1} BPM: ` : ''}¿cuál de estos ${N} drops de ${genero} es el mejor? ⚡ comenta ${N === 3 ? '1, 2 o 3' : `del 1 al ${N}`} 👇\n⛏️ Garimpo: encuentra música que casi nadie escuchó, DJ automático con clases y CDJ gratis online\n${lista}\n🎵 ${credito.es} · sonando en la CDJ de Garimpo (gratis, en el navegador) · link en los comentarios 📌\n${tag.es}`,
    comentario: 'Garimpo está aquí ⛏️ garimpo-topaz.vercel.app (gratis, se abre en el navegador del celular)', horario: '22:00 (Brasília) = 19h MX · 20h CO · 22h AR' },
  en: {
    legenda: `${rampa ? `from ${b0} to ${b1} BPM: ` : ''}which of these ${N} ${genero} drops is the best? ⚡ comment ${N === 3 ? '1, 2 or 3' : `1 to ${N}`} 👇\n⛏️ Garimpo: random music finder + automatic DJ with lessons + free online CDJ\n${lista}\n🎵 ${credito.en} · played on Garimpo, a free DJ app in your browser · link in the comments 📌\n${tag.en}`,
    comentario: 'Garimpo is here ⛏️ garimpo-topaz.vercel.app (free, opens right in your phone browser)', horario: '17:00 (Brasília) = 16h ET · 21h UK' },
};
writeFileSync(`dias/${id}.posts.json`, JSON.stringify(posts, null, 1));
console.log(`ok dias/${id}.json · ${N} faixas · BPM ${cfg.faixas.map((f) => Math.round(f.bpm)).join(' → ')} · ${cfg.faixas.map((f) => f.titulo + ' — ' + f.artista).join(' | ')}`);
