// Verificador de alertas — roda no GitHub Actions e avisa no iPhone via ntfy.
// Notifica só quando o estado de uma posição muda: entrou "perto da borda",
// saiu do range ou voltou ao range. Nada de endereços ou valores é impresso
// no log (o repositório é público).
import fs from 'node:fs';
import { loadPositions, VERSION } from '../core.js';

const env = process.env;
const wallets = (env.CARTEIRAS || '').split(/[\s,;]+/).filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a));
const topic = (env.NTFY_TOPIC || '').trim();
const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const graphKey = (env.GRAPH_API_KEY || '').trim();
const def = Number(env.ALERTA_PADRAO) || 5;
const chains = (env.REDES || 'ethereum,arbitrum,base,polygon').split(',').map((s) => s.trim()).filter(Boolean);
const appUrl = env.APP_URL || '';
let limits = {};
try { limits = JSON.parse(env.LIMITES || '{}'); } catch { console.log('LIMITES inválido, usando o padrão.'); }

if (!wallets.length || !topic) {
  console.log('Configure os secrets CARTEIRAS e NTFY_TOPIC para ativar os alertas.');
  process.exit(0);
}

const STATE = '.estado/estado.json';
let prev = null;
try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* primeira execução */ }

const nf = (o) => new Intl.NumberFormat('pt-BR', o);
const fmt = (x) => (x >= 1000 ? nf({ maximumFractionDigits: 2 }).format(x) : nf({ maximumSignificantDigits: 5 }).format(x));
const pct = (x) => nf({ maximumFractionDigits: 1 }).format(x * 100) + '%';

async function send({ title, message, priority = 3, tags = [], click }) {
  const r = await fetch(server, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority, tags, click: click || appUrl || undefined }),
  });
  if (!r.ok) throw new Error('ntfy respondeu ' + r.status);
}

const r = await loadPositions({ wallets, chains, graphKey, alertFor: (id) => limits[id] ?? def });
if (r.errors.length) console.log(`Avisos em ${r.errors.length} consulta(s):\n` + r.errors.join('\n'));

const next = {};
// se alguma rede falhou, mantém o último estado conhecido das posições que sumiram
if (prev && r.errors.length) Object.assign(next, prev);
const changes = [];
for (const p of r.positions) {
  if (p.closed) { delete next[p.id]; continue; }
  next[p.id] = p.status;
  const before = prev?.[p.id];
  if (prev && before !== p.status && !(before === undefined && p.status === 'range')) changes.push({ p, before });
}

for (const { p, before } of changes) {
  const pair = `${p.base.symbol}/${p.quote.symbol}`;
  const where = `${p.chainName} ${p.ver} #${p.tokenId}`;
  const range = `${fmt(p.pmin)}–${fmt(p.pmax)}`;
  const comp = `${p.base.symbol} ${Math.round(p.compBase * 100)}% · ${p.quote.symbol} ${100 - Math.round(p.compBase * 100)}%`;
  if (p.status === 'fora') {
    const holding = p.side === 'abaixo' ? p.base.symbol : p.quote.symbol;
    await send({ title: `Fora do range: ${pair}`, priority: 4, tags: ['rotating_light'],
      message: `${where}\nPreço ${fmt(p.price)} ${p.side} do range (${range}).\nAgora 100% ${holding}, sem render fees.`, click: p.link });
  } else if (p.status === 'perto') {
    const edge = p.side === 'min' ? 'mínimo' : 'máximo';
    const toward = p.side === 'min' ? p.base.symbol : p.quote.symbol;
    await send({ title: `Perto da borda: ${pair}`, priority: 3, tags: ['warning'],
      message: `${where}\nA ${pct(p.dist)} do ${edge} (${range}), preço ${fmt(p.price)}.\nIndo para ${toward} · ${comp}`, click: p.link });
  } else if (p.status === 'range' && (before === 'fora' || before === 'perto')) {
    await send({ title: `De volta ao range: ${pair}`, priority: 3, tags: ['white_check_mark'],
      message: `${where}\nPreço ${fmt(p.price)} · range ${range}\n${comp}`, click: p.link });
  }
}

if (!prev) {
  const open = r.positions.filter((p) => !p.closed).length;
  await send({ title: 'Alertas ativados', priority: 2, tags: ['bell'],
    message: `Monitorando ${open} posição(ões). Você será avisado quando alguma ficar perto da borda, sair ou voltar ao range.` });
}

fs.mkdirSync('.estado', { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(next));
console.log(`Pools LP v${VERSION}: ${Object.keys(next).length} posição(ões) abertas verificadas, ${changes.length} mudança(s).`);
