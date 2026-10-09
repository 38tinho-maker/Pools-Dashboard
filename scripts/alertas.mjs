// Verificador de alertas — roda no GitHub Actions e avisa no iPhone via ntfy.
// As configurações vêm do app (variável ALERTAS, sincronizada sozinha).
// Cada aviso dispara uma vez quando a condição passa a valer (não repete), exceto o
// "lembrete enquanto fora", que repete no intervalo escolhido.
// Nada de endereços ou valores é impresso no log (o repositório é público).
import fs from 'node:fs';
import { loadPositions, VERSION } from '../core.js';

const env = process.env;
let A = {};
try { A = JSON.parse(env.ALERTAS || '{}'); } catch { console.log('Variável ALERTAS inválida.'); }
let oldLimits = {};
try { oldLimits = JSON.parse(env.LIMITES || '{}'); } catch { /* opcional */ }

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const wallets = [...new Set([...(env.CARTEIRAS || '').split(/[\s,;]+/), ...(A.carteiras || [])].filter(isAddr))];
const topic = (env.NTFY_TOPIC || A.ntfy || '').trim();
const server = (env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/$/, '');
const graphKey = (env.GRAPH_API_KEY || A.graph || '').trim();
const chains = (A.redes?.length ? A.redes : (env.REDES || 'ethereum,arbitrum,base,polygon,monad').split(',')).map((s) => String(s).trim()).filter(Boolean);
const appUrl = env.APP_URL || '';
const tz = A.tz || 'America/Sao_Paulo';
const D = { range: true, borda: Number(A.borda) || Number(env.ALERTA_PADRAO) || 5, fee: Number(A.fee) || 0, feeUsd: 0, comp: 0, fora: 0, ...(A.def || {}) };
const G = { novas: true, render: true, lembrete: 0, silencio: { on: false, de: '23:00', ate: '07:00' }, ...(A.glob || {}) };
const pos = A.pos || {};
const raw = (id) => { const o = pos[id]; return typeof o === 'number' ? { borda: o } : (o || {}); };
function eff(id) {
  const a = raw(id);
  return {
    range: a.range ?? D.range, borda: a.borda ?? oldLimits[id] ?? D.borda, alvo: a.alvo || null,
    fee: a.fee ?? (D.fee || null), feeUsd: a.feeUsd ?? (D.feeUsd || null),
    comp: a.comp ?? (D.comp ? { side: 'any', pct: D.comp } : null), fora: a.fora ?? (D.fora || null),
  };
}

if (!wallets.length || !topic) {
  console.log('Configure no app o tópico do ntfy e o token do GitHub (ou os secrets CARTEIRAS e NTFY_TOPIC).');
  process.exit(0);
}

// ---------- estado entre execuções ----------
const STATE = '.estado/estado.json';
let st = null;
try { st = JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { /* primeira execução */ }
if (st && !st.pos) st = { pos: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, typeof v === 'string' ? { s: v } : v])), held: [] };
const first = !st;
st ||= { pos: {}, held: [] };
st.held ||= [];
const NOW = Date.now(), H = 3600e3;

// ---------- formatação ----------
const nf = (o) => new Intl.NumberFormat('pt-BR', o);
const fmt = (x) => (x > 0 && x < 1e-6 ? x.toExponential(2).replace('.', ',') : x >= 1000 ? nf({ maximumFractionDigits: 2 }).format(x) : nf({ maximumSignificantDigits: 5 }).format(x));
const pct = (x) => nf({ maximumFractionDigits: 2 }).format(x) + '%';
const usd = (x) => 'US$ ' + nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
const hrs = (ms) => { const h = ms / H; return h < 1 ? `${Math.round(h * 60)} min` : `${nf({ maximumFractionDigits: 1 }).format(h)} h`; };

// ---------- horário de silêncio ----------
function inSilence() {
  if (!G.silencio?.on) return false;
  const hm = new Intl.DateTimeFormat('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(NOW));
  const m = (t) => { const [h, mi] = String(t).split(':').map(Number); return h * 60 + (mi || 0); };
  const now = m(hm), de = m(G.silencio.de || '23:00'), ate = m(G.silencio.ate || '07:00');
  return de <= ate ? now >= de && now < ate : now >= de || now < ate;
}
const silent = inSilence();

async function send({ title, message, priority = 3, tags = [], click }) {
  const r = await fetch(server, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ topic, title, message, priority, tags, click: click || appUrl || undefined }),
  });
  if (!r.ok) throw new Error('ntfy respondeu ' + r.status);
}

// ---------- leitura ----------
const r = await loadPositions({ wallets, chains, graphKey, alertFor: (id) => eff(id).borda || 0 });
if (r.errors.length) console.log(`Avisos em ${r.errors.length} consulta(s):\n` + r.errors.join('\n'));

const out = []; // { urgent, title, message, priority, tags, click }
const push = (m, urgent = false) => out.push({ ...m, urgent });
const seen = new Set();

for (const p of r.positions) {
  seen.add(p.id);
  const was = st.pos[p.id];
  const pair = `${p.base.symbol}/${p.quote.symbol}`;
  const where = `${p.chainName} ${p.ver} #${p.tokenId}`;

  // posição fechada (ficou sem liquidez)
  if (p.closed) {
    if (was && !was.closed && G.novas && !first) push({ title: `Posição fechada: ${pair}`, priority: 3, tags: ['wastebasket'], click: p.link, message: `${where}\nA liquidez foi retirada.` });
    st.pos[p.id] = { closed: true };
    continue;
  }

  const E = eff(p.id);
  const status = p.status === 'fora' ? 'fora' : E.borda && p.dist * 100 < E.borda ? 'perto' : 'range';
  const compBaseP = p.compBase * 100, compQuoteP = 100 - compBaseP;
  let compHit = false, compCoin = '', compVal = 0;
  if (E.comp?.pct) {
    if (E.comp.side === 'base' || (E.comp.side === 'any' && compBaseP >= compQuoteP)) { compHit = compBaseP >= E.comp.pct; compCoin = p.base.symbol; compVal = compBaseP; }
    else { compHit = compQuoteP >= E.comp.pct; compCoin = p.quote.symbol; compVal = compQuoteP; }
  }
  const now = {
    s: status,
    alvo: E.alvo?.preco > 0 ? (E.alvo.dir === 'acima' ? p.price > E.alvo.preco : p.price < E.alvo.preco) : false,
    fee: E.fee > 0 && isFinite(p.feeYield) ? p.feeYield >= E.fee : false,
    feeUsd: E.feeUsd > 0 && p.feesUsd != null ? p.feesUsd >= E.feeUsd : false,
    comp: compHit,
    foraDesde: status === 'fora' ? (was?.s === 'fora' && was.foraDesde ? was.foraDesde : NOW) : null,
    foraAvisado: status === 'fora' ? !!was?.foraAvisado : false,
    lembreteAt: status === 'fora' ? was?.lembreteAt || NOW : null,
    render: false,
    hist: was?.hist || [],
  };

  // histórico de fees (1 ponto por hora, até 7 dias) para "pool parou de render"
  if (p.feesUsd != null) {
    const last = now.hist[now.hist.length - 1];
    if (last && p.feesUsd < last[1] * 0.9) now.hist = []; // fees coletadas: recomeça
    if (!last || NOW - last[0] >= H * 0.95 || !now.hist.length) now.hist.push([NOW, p.feesUsd, status === 'fora' ? 0 : 1]);
    now.hist = now.hist.filter((h) => NOW - h[0] <= 7 * 24 * H + H);
    const h = now.hist, oldest = h[0];
    if (G.render && oldest && NOW - oldest[0] >= 48 * H) {
      const ref = h.find((x) => NOW - x[0] <= 24 * H + H / 2) || h[h.length - 1];
      const inRange24 = h.filter((x) => NOW - x[0] <= 24 * H).every((x) => x[2] === 1);
      const rate24 = (p.feesUsd - ref[1]) / Math.max(1, (NOW - ref[0]) / H);
      const rate7 = (p.feesUsd - oldest[1]) / Math.max(1, (NOW - oldest[0]) / H);
      now.render = inRange24 && rate7 > 0 && rate24 < 0.3 * rate7;
      now.rate24 = rate24 * 24; now.rate7 = rate7 * 24;
    }
  }
  st.pos[p.id] = now;

  if (first) continue; // primeira execução: só registra
  if (!was || was.closed) {
    if (G.novas) push({ title: `Posição nova: ${pair}`, priority: 3, tags: ['sparkles'], click: p.link,
      message: `${where}\nRange ${fmt(p.pmin)}–${fmt(p.pmax)} · preço ${fmt(p.price)}${p.valueUsd != null ? ` · ${usd(p.valueUsd)}` : ''}` });
    continue;
  }

  const range = `${fmt(p.pmin)}–${fmt(p.pmax)}`;
  const comp = `${p.base.symbol} ${Math.round(compBaseP)}% · ${p.quote.symbol} ${100 - Math.round(compBaseP)}%`;

  // entrou / saiu / perto da borda
  if (now.s !== was.s) {
    if (now.s === 'fora' && E.range) {
      const holding = p.side === 'abaixo' ? p.base.symbol : p.quote.symbol;
      push({ title: `Saiu do range: ${pair}`, priority: 4, tags: ['rotating_light'], click: p.link,
        message: `${where}\nPreço ${fmt(p.price)} ${p.side} do range (${range}).\nAgora 100% ${holding}, sem render fees.` }, true);
      now.lembreteAt = NOW;
    } else if (was.s === 'fora' && E.range) {
      push({ title: `Entrou no range: ${pair}`, priority: 3, tags: ['white_check_mark'], click: p.link,
        message: `${where}\nPreço ${fmt(p.price)} · range ${range}\n${comp}${now.s === 'perto' ? `\nAinda perto da borda (${pct(p.dist * 100)}).` : ''}` });
    } else if (now.s === 'perto' && was.s === 'range') {
      const edge = p.side === 'min' ? 'mínimo' : 'máximo';
      push({ title: `Perto da borda: ${pair}`, priority: 3, tags: ['warning'], click: p.link,
        message: `${where}\nA ${pct(p.dist * 100)} do ${edge} (${range}), preço ${fmt(p.price)}.\n${comp}` });
    }
  }
  if (now.alvo && !was.alvo) push({ title: `Preço alvo: ${pair}`, priority: 4, tags: ['dart'], click: p.link,
    message: `${where}\nPreço ${fmt(p.price)} ${E.alvo.dir === 'acima' ? 'acima' : 'abaixo'} do alvo ${fmt(E.alvo.preco)}.` });
  if (now.fee && !was.fee) push({ title: `Fees em ${pct(p.feeYield)}: ${pair}`, priority: 3, tags: ['moneybag'], click: p.link,
    message: `${where}\nFees a coletar: ${p.feesUsd != null ? usd(p.feesUsd) : '—'} (${pct(p.feeYield)} da posição; alvo ${pct(E.fee)}).` });
  if (now.feeUsd && !was.feeUsd) push({ title: `Fees passaram de ${usd(E.feeUsd)}: ${pair}`, priority: 3, tags: ['moneybag'], click: p.link,
    message: `${where}\nFees a coletar: ${usd(p.feesUsd)}${isFinite(p.feeYield) ? ` (${pct(p.feeYield)} da posição)` : ''}.` });
  if (now.comp && !was.comp) push({ title: `${compCoin} em ${Math.round(compVal)}%: ${pair}`, priority: 3, tags: ['scales'], click: p.link,
    message: `${where}\n${comp} (alerta em ${E.comp.pct}%).\nPreço ${fmt(p.price)} · range ${range}` });
  if (now.s === 'fora' && E.fora && !now.foraAvisado && NOW - now.foraDesde >= E.fora * H) {
    now.foraAvisado = true;
    push({ title: `Fora do range há ${hrs(NOW - now.foraDesde)}: ${pair}`, priority: 4, tags: ['hourglass'], click: p.link,
      message: `${where}\nPreço ${fmt(p.price)} · range ${range}\nConsidere rebalancear.` });
  }
  if (now.s === 'fora' && was.s === 'fora' && E.range && G.lembrete > 0 && NOW - now.lembreteAt >= G.lembrete * H) {
    now.lembreteAt = NOW;
    push({ title: `Ainda fora do range: ${pair}`, priority: 3, tags: ['repeat'], click: p.link,
      message: `${where}\nFora há ${hrs(NOW - now.foraDesde)}. Preço ${fmt(p.price)} · range ${range}` });
  }
  if (now.render && !was.render) push({ title: `Pool rendendo pouco: ${pair}`, priority: 3, tags: ['chart_with_downwards_trend'], click: p.link,
    message: `${where}\nNo range, mas as fees das últimas 24h (${usd(now.rate24)}/dia) estão bem abaixo da média de 7 dias (${usd(now.rate7)}/dia).` });
}

// posições que sumiram da carteira (transferidas ou queimadas) — só se nenhuma rede falhou
if (!first && !r.errors.length) {
  for (const [id, v] of Object.entries(st.pos)) {
    if (seen.has(id)) continue;
    if (!v.closed && G.novas) push({ title: 'Posição saiu da carteira', priority: 3, tags: ['wastebasket'], message: `#${id.split('-').pop()} (${id.split('-')[0]} ${id.split('-')[1]}) não está mais na carteira.` });
    delete st.pos[id];
  }
}

// ---------- envio (com horário de silêncio) ----------
let sent = 0;
if (silent) {
  for (const m of out) {
    if (m.urgent) { await send(m); sent++; } else st.held.push({ t: m.title, m: m.message.split('\n')[1] || '' });
  }
} else {
  if (st.held.length) {
    const list = st.held.slice(0, 12).map((h) => `• ${h.t}`).join('\n');
    await send({ title: `Resumo do silêncio: ${st.held.length} aviso(s)`, priority: 3, tags: ['sunrise'],
      message: list + (st.held.length > 12 ? `\n… e mais ${st.held.length - 12}` : '') });
    st.held = []; sent++;
  }
  for (const m of out) { await send(m); sent++; }
}

if (first) {
  const open = r.positions.filter((p) => !p.closed).length;
  await send({ title: 'Alertas ativados', priority: 2, tags: ['bell'], message: `Monitorando ${open} posição(ões) abertas.` });
}

fs.mkdirSync('.estado', { recursive: true });
fs.writeFileSync(STATE, JSON.stringify(st));
console.log(`Pools LP v${VERSION}: ${Object.values(st.pos).filter((v) => !v.closed).length} posição(ões) abertas, ${out.length} alerta(s)${silent ? ' (silêncio)' : ''}, ${sent} envio(s).`);
