// Verificador de alertas — roda no GitHub Actions e avisa no iPhone via ntfy.
// As configurações vêm do app (variável ALERTAS, sincronizada sozinha) e avisa quando:
//   • a posição sai do range, volta ao range ou fica perto da borda (% por posição)
//   • o preço cruza o preço alvo definido
//   • as fees a coletar atingem o % definido do valor da posição
// Nada de endereços ou valores é impresso no log (o repositório é público).
import fs from 'node:fs';
import { loadPositions, VERSION } from '../core.js';

const env = process.env;
let A = {};
try { A = JSON.parse(env.ALERTAS || '{}'); } catch { console.log('Variável ALERTAS inválida.'); }
let oldLimits = {};
try { oldLimits = JSON.parse(env.LIMITES || '{}'); } catch { /* formato antigo, opcional */ }

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const wallets = [...new Set([...(env.CARTEIRAS || '').split(/[\s,;]+/), ...(A.carteiras || [])].filter(isAddr))];
const topic = (env.NTFY_TOPIC || A.ntfy || '').trim();
const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const graphKey = (env.GRAPH_API_KEY || A.graph || '').trim();
const defBorda = Number(A.borda) || Number(env.ALERTA_PADRAO) || 5;
const defFee = Number(A.fee) || 0;
const chains = (A.redes?.length ? A.redes : (env.REDES || 'ethereum,arbitrum,base,polygon,monad').split(',')).map((s) => String(s).trim()).filter(Boolean);
const appUrl = env.APP_URL || '';
const pos = A.pos || {};
const cfgOf = (id) => { const o = pos[id]; return typeof o === 'number' ? { borda: o } : (o || {}); };
const bordaFor = (id) => cfgOf(id).borda ?? oldLimits[id] ?? defBorda;
const feeFor = (id) => cfgOf(id).fee ?? (defFee || null);

if (!wallets.length || !topic) {
  console.log('Configure no app o tópico do ntfy e o token do GitHub (ou os secrets CARTEIRAS e NTFY_TOPIC).');
  process.exit(0);
}

const STATE = '.estado/estado.json';
let prev = null;
try { prev = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* primeira execução */ }
const prevOf = (id) => { const o = prev?.[id]; return typeof o === 'string' ? { s: o } : o; };

const nf = (o) => new Intl.NumberFormat('pt-BR', o);
const fmt = (x) => (x > 0 && x < 1e-6 ? x.toExponential(2).replace('.', ',') : x >= 1000 ? nf({ maximumFractionDigits: 2 }).format(x) : nf({ maximumSignificantDigits: 5 }).format(x));
const pct = (x) => nf({ maximumFractionDigits: 2 }).format(x) + '%';

async function send({ title, message, priority = 3, tags = [], click }) {
  const r = await fetch(server, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority, tags, click: click || appUrl || undefined }),
  });
  if (!r.ok) throw new Error('ntfy respondeu ' + r.status);
}

const r = await loadPositions({ wallets, chains, graphKey, alertFor: bordaFor });
if (r.errors.length) console.log(`Avisos em ${r.errors.length} consulta(s):\n` + r.errors.join('\n'));

const next = {};
if (prev && r.errors.length) Object.assign(next, prev); // rede com falha: mantém o último estado
const msgs = [];
for (const p of r.positions) {
  if (p.closed) { delete next[p.id]; continue; }
  const c = cfgOf(p.id);
  const alvoHit = c.alvo?.preco > 0 ? (c.alvo.dir === 'acima' ? p.price > c.alvo.preco : p.price < c.alvo.preco) : false;
  const feeT = feeFor(p.id);
  const feeHit = feeT > 0 && isFinite(p.feeYield) ? p.feeYield >= feeT : false;
  const now = { s: p.status, alvo: alvoHit, fee: feeHit };
  next[p.id] = now;
  const was = prevOf(p.id);
  if (!prev || !was) continue; // primeira vez que vê a posição: só registra

  const pair = `${p.base.symbol}/${p.quote.symbol}`;
  const where = `${p.chainName} ${p.ver} #${p.tokenId}`;
  const range = `${fmt(p.pmin)}–${fmt(p.pmax)}`;
  const comp = `${p.base.symbol} ${Math.round(p.compBase * 100)}% · ${p.quote.symbol} ${100 - Math.round(p.compBase * 100)}%`;

  if (now.s !== was.s) {
    if (now.s === 'fora') {
      const holding = p.side === 'abaixo' ? p.base.symbol : p.quote.symbol;
      msgs.push({ title: `Saiu do range: ${pair}`, priority: 4, tags: ['rotating_light'], click: p.link,
        message: `${where}\nPreço ${fmt(p.price)} ${p.side} do range (${range}).\nAgora 100% ${holding}, sem render fees.` });
    } else if (now.s === 'range' && was.s === 'fora') {
      msgs.push({ title: `Entrou no range: ${pair}`, priority: 3, tags: ['white_check_mark'], click: p.link,
        message: `${where}\nPreço ${fmt(p.price)} · range ${range}\n${comp}` });
    } else if (now.s === 'perto') {
      const edge = p.side === 'min' ? 'mínimo' : 'máximo';
      const toward = p.side === 'min' ? p.base.symbol : p.quote.symbol;
      msgs.push({ title: `${was.s === 'fora' ? 'Entrou no range, perto da borda' : 'Perto da borda'}: ${pair}`, priority: 3, tags: ['warning'], click: p.link,
        message: `${where}\nA ${pct(p.dist * 100)} do ${edge} (${range}), preço ${fmt(p.price)}.\nIndo para ${toward} · ${comp}` });
    }
  }
  if (now.alvo && !was.alvo) {
    msgs.push({ title: `Preço alvo: ${pair}`, priority: 4, tags: ['dart'], click: p.link,
      message: `${where}\nPreço ${fmt(p.price)} ${c.alvo.dir === 'acima' ? 'acima' : 'abaixo'} do alvo ${fmt(c.alvo.preco)}.` });
  }
  if (now.fee && !was.fee) {
    msgs.push({ title: `Fees em ${pct(p.feeYield)}: ${pair}`, priority: 3, tags: ['moneybag'], click: p.link,
      message: `${where}\nFees a coletar: ${p.feesUsd != null ? 'US$ ' + nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(p.feesUsd) : '—'} (${pct(p.feeYield)} da posição; alvo ${pct(feeT)}).` });
  }
}

for (const m of msgs) await send(m);

if (!prev) {
  const open = r.positions.filter((p) => !p.closed).length;
  await send({ title: 'Alertas ativados', priority: 2, tags: ['bell'],
    message: `Monitorando ${open} posição(ões): entrada e saída do range, perto da borda, preço alvo e % de fees.` });
}

fs.mkdirSync('.estado', { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(next));
console.log(`Pools LP v${VERSION}: ${Object.keys(next).length} posição(ões) abertas verificadas, ${msgs.length} alerta(s) enviado(s).`);
