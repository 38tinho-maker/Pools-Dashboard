import { VERSION, CHAINS, loadPositions, derive, keccak256 } from './core.js?v=1.2.1';

// ---------- armazenamento local (só neste aparelho) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('lp.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('lp.' + k, JSON.stringify(v)); } catch { /* modo privado */ } },
};
const cfg = {
  wallets: store.get('wallets', []),
  graphKey: store.get('graphKey', ''),
  chains: store.get('chains', Object.keys(CHAINS)),
  alerts: store.get('alerts', {}),
  alertDefault: store.get('alertDefault', 5),
  feeDefault: store.get('feeDefault', 0),
  rpc: store.get('rpc', {}),
  ntfy: store.get('ntfy', ''),
  gh: store.get('gh', { token: '', repo: defaultRepo() }),
};
function defaultRepo() {
  const m = location.hostname.match(/^([^.]+)\.github\.io$/);
  const seg = location.pathname.split('/').filter(Boolean)[0];
  return m && seg ? `${m[1]}/${seg}` : '';
}
const save = (k) => store.set(k, cfg[k]);
// redes novas em versões futuras entram marcadas automaticamente
{
  const known = store.get('knownChains', ['ethereum', 'arbitrum', 'base', 'polygon']);
  const fresh = Object.keys(CHAINS).filter((k) => !known.includes(k));
  if (fresh.length) { cfg.chains = [...new Set([...cfg.chains, ...fresh])]; save('chains'); }
  store.set('knownChains', Object.keys(CHAINS));
}
// padrões de alerta (valem para todas as posições) e opções gerais
cfg.def = store.get('def', { range: true, borda: cfg.alertDefault ?? 5, fee: cfg.feeDefault || 0, feeUsd: 0, comp: 0, fora: 0 });
cfg.glob = store.get('glob', { novas: true, render: true, lembrete: 0, silencio: { on: false, de: '23:00', ate: '07:00' } });
// alerta por posição: { range:false?, borda, alvo:{dir,preco}, fee, feeUsd, comp:{side,pct}, fora }
const alOf = (id) => { const a = cfg.alerts[id]; return typeof a === 'number' ? { borda: a } : { ...(a || {}) }; };
function eff(id) {
  const a = alOf(id), d = cfg.def;
  return {
    range: a.range ?? d.range, borda: a.borda ?? d.borda, alvo: a.alvo || null,
    fee: a.fee ?? (d.fee || null), feeUsd: a.feeUsd ?? (d.feeUsd || null),
    comp: a.comp ?? (d.comp ? { side: 'any', pct: d.comp } : null), fora: a.fora ?? (d.fora || null),
  };
}
const alertFor = (id) => eff(id).borda || 0;
function setAl(id, patch) {
  const a = { ...alOf(id), ...patch }, d = cfg.def;
  for (const k of Object.keys(a)) if (a[k] == null) delete a[k];
  if (a.range === d.range) delete a.range;
  if (a.borda === d.borda) delete a.borda;
  for (const k of ['fee', 'feeUsd', 'fora']) if (a[k] != null && a[k] === (d[k] || null)) delete a[k];
  if (Object.keys(a).length) cfg.alerts[id] = a; else delete cfg.alerts[id];
  save('alerts'); scheduleSync();
}
const saveDef = () => { save('def'); scheduleSync(); };
const saveGlob = () => { save('glob'); scheduleSync(); };

const state = {
  view: location.hash === '#config' ? 'cfg' : 'main',
  data: null, loading: false, error: null,
  filter: store.get('filter', 'all'),
  closedOpen: false, editing: null, dirty: false,
  demo: new URLSearchParams(location.search).has('demo'),
  cfgMsg: '',
  sort: store.get('sort', { k: 'status', desc: false }),
  sync: store.get('sync', null),
};

// ---------- utilidades ----------
const $app = document.getElementById('app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = (o) => new Intl.NumberFormat('pt-BR', o);
const usd = (x) => (x == null ? '—' : 'US$ ' + nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x));
const usdShort = (x) => (x == null ? '—' : nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x));
const fmtP = (x) => (!isFinite(x) ? '—' : x > 0 && x < 1e-6 ? tiny(x) : x >= 1000 ? nf({ maximumFractionDigits: 2 }).format(x) : nf({ maximumSignificantDigits: 6 }).format(x));
const fmtE = (x) => (!isFinite(x) ? '—' : x > 0 && x < 1e-6 ? tiny(x) : x >= 10000 ? nf({ maximumFractionDigits: 0 }).format(x) : nf({ maximumSignificantDigits: 5 }).format(x));
const tiny = (x) => x.toExponential(2).replace('.', ',');
const pct1 = (x) => (!isFinite(x) ? '—' : x > 999 ? '>999%' : nf({ maximumFractionDigits: 1 }).format(x) + '%');
const pct2 = (x) => (!isFinite(x) ? '—' : x > 999 ? '>999%' : nf({ minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x) + '%');
const parseNum = (v) => { let s = String(v || '').trim().replace(/\s/g, ''); if (!s) return null; if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.'); else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); const n = parseFloat(s); return isFinite(n) && n > 0 ? n : null; };
const short = (a) => a.slice(0, 6) + '…' + a.slice(-4);
const walletName = (addr) => cfg.wallets.find((w) => w.addr.toLowerCase() === addr.toLowerCase())?.name || short(addr);

const ICON = {
  gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/></svg>',
  refresh: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
  back: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  trash: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>',
  sort: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4"/></svg>',
  chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
};

// ---------- moedas ----------
const COIN = [
  [/^(w?eth|steth|wsteth|cbeth|reth|weeth)$/i, 'Ξ', '#9FA6FF'],
  [/^(usdc|usdc\.e|usdbc)$/i, '$', '#4C9BF0'],
  [/^(usdt|usdt0|usd₮0)$/i, '₮', '#35C49A'],
  [/^(dai|usds)$/i, '◈', '#F5C04A'],
  [/btc/i, '₿', '#F7A23B'],
  [/^(w?pol|w?matic)$/i, 'P', '#A58BFF'],
  [/^arb$/i, 'A', '#5AA9F5'],
  [/^w?mon$/i, 'M', '#9B8CFF'],
];
function coinStyle(sym) {
  for (const [re, g, c] of COIN) if (re.test(sym)) return { g, c };
  let h = 0; for (const ch of sym) h = (h * 31 + ch.codePointAt(0)) % 360;
  return { g: (sym[0] || '?').toUpperCase(), c: `hsl(${h} 65% 68%)` };
}
function checksum(addr) {
  const a = addr.toLowerCase().replace(/^0x/, '');
  const h = keccak256(new TextEncoder().encode(a));
  let o = '0x';
  for (let i = 0; i < 40; i++) o += parseInt(h[i], 16) >= 8 ? a[i].toUpperCase() : a[i];
  return o;
}
const logoCache = {};
function logoUrl(chain, t) {
  const k = chain + t.addr;
  if (logoCache[k]) return logoCache[k];
  const root = 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/';
  if (t.native) return (logoCache[k] = root + (t.symbol === 'ETH' ? 'ethereum' : chain) + '/info/logo.png');
  return (logoCache[k] = `${root}${chain}/assets/${checksum(t.addr)}/logo.png`);
}
function coinHtml(p, t, side) {
  const s = coinStyle(t.symbol);
  return `<span class="coin ${side}" style="background:${s.c}" aria-hidden="true">${esc(s.g)}<img src="${logoUrl(p.chain, t)}" alt="" loading="lazy" onerror="this.remove()"></span>`;
}

// ---------- status ----------
const statusOf = (p) => (p.closed ? 'fechada' : p.status === 'fora' ? 'fora' : p.dist * 100 < alertFor(p.id) ? 'perto' : 'range');
const num2 = (x) => (x == null ? '' : nf({ maximumFractionDigits: 2 }).format(x));
const sw = (on, attrs) => `<button class="sw ${on ? 'on' : ''}" role="switch" aria-checked="${on}" ${attrs}><span></span></button>`;
const ST = {
  range: { label: 'No range', c: 'var(--ok)', t: 'var(--okT)' },
  perto: { label: 'Perto da borda', c: 'var(--warn)', t: 'var(--warnT)' },
  fora: { label: 'Fora do range', c: 'var(--bad)', t: 'var(--badT)' },
};
const ORDER = { fora: 0, perto: 1, range: 2 };
const SORTS = {
  status: { label: 'Status', desc: false, v: (p) => ORDER[statusOf(p)] * 1e12 - (p.valueUsd || 0) },
  valor: { label: 'Valor', desc: true, v: (p) => p.valueUsd ?? -1 },
  fees: { label: 'Fees (US$)', desc: true, v: (p) => p.feesUsd ?? -1 },
  feepct: { label: 'Fee %', desc: true, v: (p) => (isFinite(p.feeYield) ? p.feeYield : -1) },
  borda: { label: 'Distância da borda', desc: false, v: (p) => (p.status === 'fora' ? -p.dist : p.dist) },
  rede: { label: 'Rede', desc: false, v: (p) => p.chainName + String(1e12 - Math.round(p.valueUsd || 0)).padStart(14, '0') },
};
function sortPositions(list) {
  const s = SORTS[state.sort.k] || SORTS.status;
  const out = [...list].sort((a, b) => { const x = s.v(a), y = s.v(b); return typeof x === 'string' ? x.localeCompare(y) : x - y; });
  return state.sort.desc ? out.reverse() : out;
}

// ---------- render ----------
function header() {
  const d = new Date();
  const dia = d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }).replace('.', '').replace('-feira', '');
  return `<header class="top">
    <div><div class="when">${esc(dia.charAt(0).toUpperCase() + dia.slice(1))} · <span id="ago">${agoText()}</span></div>
    <h1>Liquidez <small>v${VERSION}</small></h1></div>
    <div class="btns">
      <button class="icon-btn ${state.loading ? 'spin' : ''}" data-act="refresh" aria-label="Atualizar">${ICON.refresh}</button>
      <button class="icon-btn" data-act="cfg" aria-label="Configurações">${ICON.gear}</button>
    </div></header>`;
}
function agoText() {
  if (state.loading && !state.data) return 'carregando…';
  if (!state.data) return '—';
  const s = Math.max(0, Math.round((Date.now() - state.data.updatedAt) / 1000));
  return s < 60 ? `${s} s atrás` : `${Math.floor(s / 60)} min atrás`;
}

function ringCard(p) {
  const st = ST[statusOf(p)];
  const ang = ((135 + p.frac * 270) * Math.PI) / 180;
  const dx = (66 + 54 * Math.cos(ang)).toFixed(1), dy = (66 + 54 * Math.sin(ang)).toFixed(1);
  const cb = Math.round(p.compBase * 100), cq = 100 - cb;
  const al = alertFor(p.id);
  const out = p.status === 'fora';
  const fill = out ? 0 : Math.min(1, (p.dist * 100) / 25) * 100;
  const tick = Math.min(1, al / 25) * 100;
  const multi = cfg.wallets.length > 1 && state.filter === 'all';
  const fee = p.fee & 0x800000 ? 'taxa dinâmica' : nf({ maximumFractionDigits: 3 }).format(p.feePct) + '%';
  const yieldTxt = p.feeYield != null && isFinite(p.feeYield) ? ` · ${pct2(p.feeYield)}` : '';
  const A = alOf(p.id), E = eff(p.id);
  const compSym = (c) => (c.side === 'base' ? p.base.symbol : c.side === 'quote' ? p.quote.symbol : 'moeda');
  const extra = [
    E.range ? '' : 'range desligado',
    E.borda ? `borda ${E.borda}%` : '',
    E.alvo ? `preço ${E.alvo.dir === 'acima' ? '>' : '<'} ${fmtP(E.alvo.preco)}` : '',
    E.fee ? `fee ≥ ${pct1(E.fee)}` : '',
    E.feeUsd ? `fee ≥ US$ ${num2(E.feeUsd)}` : '',
    E.comp ? `${esc(compSym(E.comp))} ≥ ${E.comp.pct}%` : '',
    E.fora ? `fora > ${num2(E.fora)} h` : '',
  ].filter(Boolean).join(' · ');
  const showExtra = Object.keys(A).length > 0;
  const cs = A.comp?.side || 'base';
  const feeTxt = (p.feesUsd != null ? `+ ${usdShort(p.feesUsd)} fees` : `+ ${Object.entries(p.fees).map(([k, v]) => fmtE(v) + ' ' + esc(k)).join(' · ')}`) + yieldTxt;
  const editing = state.editing === p.id;
  return `<article class="card">
    <div class="row">
      <div class="ring" role="img" aria-label="${esc(p.base.symbol)} ${cb}%, ${esc(p.quote.symbol)} ${cq}%; preço em ${Math.round(p.frac * 100)}% do range">
        <svg width="132" height="132" viewBox="0 0 132 132" aria-hidden="true">
          <circle cx="66" cy="66" r="54" fill="none" stroke="var(--track)" stroke-width="12" stroke-linecap="round" stroke-dasharray="254.47 400" transform="rotate(135 66 66)"/>
          <circle cx="66" cy="66" r="54" fill="none" stroke="${st.c}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${(p.frac * 254.47).toFixed(1)} 400" transform="rotate(135 66 66)" opacity="0.35"/>
          <circle cx="${dx}" cy="${dy}" r="9" fill="#FFFFFF" stroke="${st.c}" stroke-width="4"/>
        </svg>
        ${coinHtml(p, p.base, 'l')}${coinHtml(p, p.quote, 'r')}
        <div class="center"><b>${Math.round(p.frac * 100)}%</b><span>do range</span></div>
        <div class="edge l ${cb >= cq ? 'dom' : ''}"><span class="sym">${esc(p.base.symbol)}</span><span class="pc">${cb}%</span><span class="px">${fmtE(p.pmin)}</span></div>
        <div class="edge r ${cq > cb ? 'dom' : ''}"><span class="sym">${esc(p.quote.symbol)}</span><span class="pc">${cq}%</span><span class="px">${fmtE(p.pmax)}</span></div>
      </div>
      <div class="info">
        <span class="pill" style="color:${st.c};background:${st.t}">${st.label}</span>
        <a class="pair" href="${p.link}" target="_blank" rel="noopener">${esc(p.base.symbol)} / ${esc(p.quote.symbol)}</a>
        <span class="meta">${fee} · ${p.chainName} · ${p.ver} · #${p.tokenId}${multi ? ' · ' + esc(walletName(p.owner)) : ''}</span>
        <span class="val">${usd(p.valueUsd)}</span>
        <span class="fee">${feeTxt}</span>
        <span class="cur">atual ${fmtP(p.price)}</span>
      </div>
    </div>
    ${editing ? `<div class="alert-edit" data-id="${p.id}">
      <span class="ae-title">Alertas desta posição</span>
      <div class="ae"><span>Entrou / saiu do range</span>${sw(E.range, 'data-act="tg" data-f="range"')}</div>
      <div class="ae"><span>Perto da borda</span>
        <span class="step"><button data-act="st" data-d="-1" aria-label="Diminuir">−</button><b data-f="borda" data-v="${E.borda || 0}">${E.borda ? E.borda + '%' : 'desl.'}</b><button data-act="st" data-d="1" aria-label="Aumentar">+</button></span></div>
      <div class="ae"><span>Preço alvo <small>${esc(p.base.symbol)} em ${esc(p.quote.symbol)}</small></span>
        <span class="ae-in"><span class="seg" data-f="dir"><button data-act="seg" data-v="abaixo" class="${(A.alvo?.dir || 'abaixo') === 'abaixo' ? 'on' : ''}">abaixo</button><button data-act="seg" data-v="acima" class="${A.alvo?.dir === 'acima' ? 'on' : ''}">acima</button></span>
        <input class="field sm" data-f="preco" inputmode="decimal" placeholder="${fmtP(p.price)}" value="${A.alvo ? fmtP(A.alvo.preco) : ''}" aria-label="Preço alvo"></span></div>
      <div class="ae"><span>Fees atingiram</span><span class="ae-in"><input class="field sm" data-f="fee" inputmode="decimal" placeholder="${cfg.def.fee ? num2(cfg.def.fee) : '—'}" value="${num2(A.fee)}" aria-label="Fees em % para avisar"><span class="unit">%</span></span></div>
      <div class="ae"><span>Fees atingiram</span><span class="ae-in"><input class="field sm" data-f="feeUsd" inputmode="decimal" placeholder="${cfg.def.feeUsd ? num2(cfg.def.feeUsd) : '—'}" value="${num2(A.feeUsd)}" aria-label="Fees em US$ para avisar"><span class="unit">US$</span></span></div>
      <div class="ae"><span>Composição</span>
        <span class="ae-in"><span class="seg" data-f="side"><button data-act="seg" data-v="base" class="${cs === 'base' ? 'on' : ''}">${esc(p.base.symbol)}</button><button data-act="seg" data-v="quote" class="${cs === 'quote' ? 'on' : ''}">${esc(p.quote.symbol)}</button></span><span class="unit">≥</span>
        <input class="field xs" data-f="comp" inputmode="numeric" placeholder="${cfg.def.comp || '—'}" value="${A.comp ? A.comp.pct : ''}" aria-label="Composição mínima em %"><span class="unit">%</span></span></div>
      <div class="ae"><span>Fora do range há mais de</span><span class="ae-in"><input class="field sm" data-f="fora" inputmode="decimal" placeholder="${cfg.def.fora ? num2(cfg.def.fora) : '—'}" value="${num2(A.fora)}" aria-label="Horas fora do range"><span class="unit">h</span></span></div>
      <div class="ae end"><span class="hint">Vazio = usa o padrão das configurações.</span><button class="ok" data-act="al-ok">OK</button></div></div>`
    : `<button class="dist" data-act="edit" data-id="${p.id}" aria-label="Até a borda ${pct1(p.dist * 100)}; toque para ajustar os alertas">
      <span class="lbl">${out ? 'Fora por' : 'Até a borda'}</span>
      <span class="bar"><i style="width:${fill.toFixed(0)}%;background:${st.c}"></i><em style="left:${tick.toFixed(0)}%"></em></span>
      <span class="v" ${out ? 'style="color:var(--bad)"' : ''}>${pct1(p.dist * 100)}</span></button>
      ${showExtra && extra ? `<div class="alerts-on">Alertas: ${extra}</div>` : ''}`}
  </article>`;
}

function mainView() {
  let h = header();
  if (state.demo) h += `<div class="demo-banner"><span>Demonstração com dados fictícios</span><button data-act="demo-off">Sair</button></div>`;
  if (!state.demo && !cfg.wallets.length) {
    return h + `<div class="empty"><h2>Nenhuma carteira ainda</h2>
      <p>Adicione o endereço de uma carteira para ver suas posições de liquidez na Uniswap v3 e v4.</p>
      <button class="primary" data-act="cfg">Adicionar carteira</button>
      <button class="secondary" data-act="demo-on">Ver demonstração</button></div>`;
  }
  if (state.error && !state.data) h += `<div class="notice warn">Não foi possível carregar: ${esc(state.error)}</div>`;
  if (!state.data) return h + '<div class="skel"></div><div class="skel"></div>';

  const d = state.data;
  const mine = d.positions.filter((p) => state.filter === 'all' || p.owner.toLowerCase() === state.filter);
  const open = sortPositions(mine.filter((p) => !p.closed));
  const closed = mine.filter((p) => p.closed);
  const cnt = { range: 0, perto: 0, fora: 0 };
  open.forEach((p) => cnt[statusOf(p)]++);
  const total = open.reduce((s, p) => s + (p.valueUsd || 0), 0);
  const fees = mine.reduce((s, p) => s + (p.feesUsd || 0), 0);

  h += `<section class="summary"><div>
      <div class="label">Total · ${open.length} ${open.length === 1 ? 'posição' : 'posições'}</div>
      <div class="total num">${usd(total)}</div>
      <div class="fees num">+ ${usdShort(fees)} fees</div></div>
    <div class="counters">
      <div class="counter"><b style="border-color:var(--ok)">${cnt.range}</b><span>range</span></div>
      <div class="counter"><b style="border-color:var(--warn)">${cnt.perto}</b><span>perto</span></div>
      <div class="counter"><b style="border-color:var(--bad)">${cnt.fora}</b><span>fora</span></div>
    </div></section>`;

  if (cfg.wallets.length > 1 && !state.demo) {
    h += `<nav class="chips" aria-label="Carteiras"><button class="chip ${state.filter === 'all' ? 'on' : ''}" data-act="filter" data-v="all">Todas</button>` +
      cfg.wallets.map((w) => `<button class="chip ${state.filter === w.addr.toLowerCase() ? 'on' : ''}" data-act="filter" data-v="${w.addr.toLowerCase()}">${esc(w.name)}</button>`).join('') + '</nav>';
  }
  if (d.needsGraphKey && !state.demo) h += `<div class="notice">Posições <b>v4</b> não aparecem sem a chave do The Graph. <a href="#config">Configurar</a></div>`;
  if (d.errors?.length) h += `<div class="notice warn">${d.errors.map(esc).join('<br>')}</div>`;
  if (state.error) h += `<div class="notice warn">Última atualização falhou: ${esc(state.error)}</div>`;
  if (!open.length && !closed.length) h += `<div class="empty"><h2>Nenhuma posição encontrada</h2><p>Confira as carteiras e as redes nas configurações.</p></div>`;
  if (open.length > 1) {
    h += `<div class="sortbar"><label class="sortbtn"><span>Ordenar: <b>${SORTS[state.sort.k]?.label || 'Status'}</b></span>${ICON.chev}
      <select data-act="sort" aria-label="Ordenar posições">${Object.entries(SORTS).map(([k, o]) => `<option value="${k}" ${k === state.sort.k ? 'selected' : ''}>${o.label}</option>`).join('')}</select></label>
      <button class="icon-btn" data-act="sortdir" aria-label="Inverter ordem (${state.sort.desc ? 'decrescente' : 'crescente'})">${ICON.sort}</button></div>`;
  }
  h += open.map(ringCard).join('');
  if (closed.length) {
    const cf = closed.reduce((s, p) => s + (p.feesUsd || 0), 0);
    h += `<section class="closed ${state.closedOpen ? 'open' : ''}">
      <button data-act="closed" aria-expanded="${state.closedOpen}"><span>Fechadas (${closed.length})</span><span style="display:flex;align-items:center;gap:6px">${cf > 0.005 ? `<span class="num" style="font-weight:400;font-size:12px;color:var(--gain)">+ ${usdShort(cf)} a coletar</span>` : ''}${ICON.chev}</span></button>
      ${state.closedOpen ? closed.map((p) => `<a class="item" href="${p.link}" target="_blank" rel="noopener"><span>${esc(p.base.symbol)} / ${esc(p.quote.symbol)} · ${p.chainName} · ${p.ver}</span><span>#${p.tokenId}</span></a>`).join('') : ''}
    </section>`;
  }
  return h;
}

function cfgView() {
  const w = cfg.wallets.map((x, i) => `<div class="w"><div><b>${esc(x.name)}</b><span>${short(x.addr)}</span></div><button class="del" data-act="wdel" data-i="${i}" aria-label="Remover ${esc(x.name)}">${ICON.trash}</button></div>`).join('');
  return `<header class="top" style="align-items:center;justify-content:flex-start">
      <button class="icon-btn" data-act="back" aria-label="Voltar">${ICON.back}</button>
      <h1 style="font-size:24px">Configurações</h1></header>
    <div class="cfg" style="display:flex;flex-direction:column;gap:24px">
    <section><h2>Carteiras</h2>
      ${w ? `<div class="group">${w}</div>` : ''}
      <form id="wform" style="display:flex;flex-direction:column;gap:8px">
        <div class="row2"><input class="field" name="name" placeholder="Apelido" aria-label="Apelido" style="width:110px;flex-shrink:0" autocomplete="off">
        <input class="field" name="addr" placeholder="0x…" aria-label="Endereço da carteira" autocomplete="off" autocapitalize="off" spellcheck="false"></div>
        <div class="err" id="werr" role="alert"></div>
        <button class="primary" type="submit">Adicionar</button>
      </form></section>

    <section><h2><label for="gkey">Chave The Graph</label></h2>
      <div class="row2"><input class="field secret" id="gkey" name="lp-graph-key" type="text" value="${esc(cfg.graphKey)}" placeholder="Cole sua chave" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"><button class="copy" data-act="reveal" data-for="gkey">Mostrar</button></div>
      <span class="err" id="gkerr">${gkMsg()}</span>
      <span class="hint">Necessária para posições v4. Grátis em thegraph.com/studio. Salva só neste aparelho.</span></section>

    <section><h2>Redes</h2><div class="nets">
      ${Object.entries(CHAINS).map(([k, c]) => `<label><input type="checkbox" data-act="net" data-k="${k}" ${cfg.chains.includes(k) ? 'checked' : ''}>${c.name}</label>`).join('')}
    </div></section>

    <section><h2>Alertas no iPhone</h2>
      <label class="lbl2" for="ntfy">Tópico do ntfy</label>
      <div class="row2"><input class="field" id="ntfy" value="${esc(cfg.ntfy)}" placeholder="ex.: pools-marco-7f3k9q" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="copy" data-act="ntfy-test">Testar</button></div>
      <label class="lbl2" for="ghtok">Token do GitHub</label>
      <div class="row2"><input class="field secret" id="ghtok" name="lp-gh-token" type="text" value="${esc(cfg.gh.token)}" placeholder="ghp_… ou github_pat_…" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-1p-ignore data-lpignore="true"><button class="copy" data-act="reveal" data-for="ghtok">Mostrar</button></div>
      <span class="err" id="tkerr">${tkMsg()}</span>
      <label class="lbl2" for="ghrepo">Repositório</label>
      <input class="field" id="ghrepo" value="${esc(cfg.gh.repo)}" placeholder="usuario/repositorio" autocomplete="off" autocapitalize="off" spellcheck="false">
      <span class="hint" id="syncst">${syncText()}</span>
    </section>

    <section><h2>Alertas — padrão de todas as posições</h2>
      <div class="group pad">
        <div class="ae"><span>Entrou / saiu do range</span>${sw(cfg.def.range, 'data-act="dtg" data-f="range"')}</div>
        <div class="ae"><span>Perto da borda</span><span class="ae-in"><input class="field xs" data-def="borda" inputmode="numeric" value="${cfg.def.borda || ''}" placeholder="—"><span class="unit">%</span></span></div>
        <div class="ae"><span>Fees atingiram</span><span class="ae-in"><input class="field xs" data-def="fee" inputmode="decimal" value="${num2(cfg.def.fee || null)}" placeholder="—"><span class="unit">%</span></span></div>
        <div class="ae"><span>Fees atingiram</span><span class="ae-in"><input class="field xs" data-def="feeUsd" inputmode="decimal" value="${num2(cfg.def.feeUsd || null)}" placeholder="—"><span class="unit">US$</span></span></div>
        <div class="ae"><span>Composição numa moeda ≥</span><span class="ae-in"><input class="field xs" data-def="comp" inputmode="numeric" value="${cfg.def.comp || ''}" placeholder="—"><span class="unit">%</span></span></div>
        <div class="ae"><span>Fora do range há mais de</span><span class="ae-in"><input class="field xs" data-def="fora" inputmode="decimal" value="${num2(cfg.def.fora || null)}" placeholder="—"><span class="unit">h</span></span></div>
      </div>
      <span class="hint">Vazio = desligado. Cada posição pode mudar esses valores no próprio cartão.</span>
    </section>

    <section><h2>Carteira e pools</h2>
      <div class="group pad">
        <div class="ae"><span>Posição nova ou fechada<small>Avisa quando algo muda na carteira</small></span>${sw(cfg.glob.novas, 'data-act="gtg" data-f="novas"')}</div>
        <div class="ae"><span>Pool parou de render<small>No range, mas fees de 24h abaixo de 30% da média dos 7 dias</small></span>${sw(cfg.glob.render, 'data-act="gtg" data-f="render"')}</div>
      </div>
    </section>

    <section><h2>Quando avisar</h2>
      <div class="group pad">
        <div class="ae"><span>Lembrete enquanto fora<small>Repete o aviso de saída do range</small></span><span class="ae-in"><span class="unit">a cada</span><input class="field xs" id="glemb" inputmode="decimal" value="${num2(cfg.glob.lembrete || null)}" placeholder="—"><span class="unit">h</span></span></div>
        <div class="ae"><span>Horário de silêncio<small>Só "saiu do range" toca nesse horário</small></span>${sw(cfg.glob.silencio.on, 'data-act="gtg" data-f="silencio"')}</div>
        <div class="ae ${cfg.glob.silencio.on ? '' : 'hidden'}"><span>Das</span><span class="ae-in"><input class="field sm" type="time" id="gde" value="${cfg.glob.silencio.de}"><span class="unit">às</span><input class="field sm" type="time" id="gate" value="${cfg.glob.silencio.ate}"></span></div>
      </div>
      <span class="hint">Avisos segurados no silêncio chegam juntos ao fim do horário, num resumo. O GitHub verifica a cada ~10 min.</span>
    </section>

    <details class="adv"><summary>RPC personalizado</summary><div class="rpc">
      ${Object.entries(CHAINS).map(([k, c]) => `<input class="field" data-act="rpc" data-k="${k}" placeholder="${c.name}: ${c.rpc}" value="${esc(cfg.rpc[k] || '')}" aria-label="RPC ${c.name}" autocapitalize="off" spellcheck="false">`).join('')}
      <span class="hint">Deixe vazio para usar o RPC público padrão.</span></div></details>

    <p class="foot">Pools LP · v${VERSION}</p>
    </div>`;
}

function render() {
  $app.innerHTML = state.view === 'cfg' ? cfgView() : mainView();
}

// ---------- dados ----------
async function refresh() {
  if (state.demo) { state.data = demoData(); render(); return; }
  if (!cfg.wallets.length || state.loading) { render(); return; }
  state.loading = true; render();
  try {
    state.data = await loadPositions({ wallets: cfg.wallets.map((w) => w.addr), chains: cfg.chains, graphKey: cfg.graphKey.trim(), rpcOverrides: cfg.rpc, alertFor });
    state.error = null;
  } catch (e) { state.error = e.message || String(e); }
  state.loading = false;
  if (state.view === 'main' && !state.editing) render();
}

// ---------- demonstração ----------
function demoData() {
  const T = {
    wethA: { addr: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1', symbol: 'WETH', dec: 18 },
    usdcA: { addr: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', symbol: 'USDC', dec: 6 },
    eth: { addr: '0x0000000000000000000000000000000000000000', symbol: 'ETH', dec: 18, native: true },
    cbbtc: { addr: '0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf', symbol: 'cbBTC', dec: 8 },
    wethE: { addr: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', symbol: 'WETH', dec: 18 },
    usdt: { addr: '0xdac17f958d2ee523a2206206994597c13d831ec7', symbol: 'USDT', dec: 6 },
    wbtcP: { addr: '0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6', symbol: 'WBTC', dec: 8 },
    usdcP: { addr: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', symbol: 'USDC', dec: 6 },
  };
  const prices = {
    'arbitrum:0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 3118.4, 'arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831': 1,
    'coingecko:ethereum': 3118.4, 'base:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf': 106992,
    'ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 3118.4, 'ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7': 1,
    'polygon:0x1bfd67037b42cf73acf2047067bd4f2c47d9bfd6': 106992, 'polygon:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359': 1,
  };
  const lg = (x) => Math.log(x) / Math.log(1.0001);
  const mk = (o) => {
    const sc = 10 ** (o.t0.dec - o.t1.dec);
    const raw = { id: `${o.chain}-${o.ver}-${o.tokenId}`, chain: o.chain, ver: o.ver, tokenId: o.tokenId, owner: '0xdemo', t0: o.t0, t1: o.t1, fee: o.fee,
      tl: Math.floor(lg(o.min / sc)), tu: Math.floor(lg(o.max / sc)), tick: Math.floor(lg(o.p / sc)),
      sqrtP: BigInt(Math.round(Math.sqrt(o.p / sc) * 2 ** 96)), liq: 10n ** 12n, fees0: 0n, fees1: 0n };
    const probe = derive(raw, prices, 5);
    raw.liq = o.value ? BigInt(Math.round(1e12 * (o.value / (probe.valueUsd || 1)))) : 0n;
    raw.fees1 = BigInt(Math.round((o.fees / (prices[`${o.chain}:${o.t1.addr}`] || 3118.4)) * 10 ** o.t1.dec));
    return derive(raw, prices, alertFor(raw.id));
  };
  const positions = [
    mk({ chain: 'arbitrum', ver: 'v3', tokenId: '812044', t0: T.wethA, t1: T.usdcA, fee: 500, p: 3118.4, min: 2850, max: 3450, value: 6420.15, fees: 38.92 }),
    mk({ chain: 'base', ver: 'v4', tokenId: '10493', t0: T.eth, t1: T.cbbtc, fee: 3000, p: 1 / 34.31, min: 1 / 34.8, max: 1 / 30.1, value: 3105.77, fees: 21.4 }),
    mk({ chain: 'ethereum', ver: 'v3', tokenId: '967310', t0: T.wethE, t1: T.usdt, fee: 3000, p: 3118.4, min: 3300, max: 3900, value: 2214.6, fees: 4.11 }),
    mk({ chain: 'polygon', ver: 'v3', tokenId: '2231876', t0: T.wbtcP, t1: T.usdcP, fee: 500, p: 106992, min: 90000, max: 100000, value: 0, fees: 0 }),
  ];
  return { positions, errors: [], needsGraphKey: false, updatedAt: Date.now() - 12000 };
}

// ---------- sincronização dos alertas com o GitHub ----------
const TOKEN_RE = /^(ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})$/;
const gkMsg = () => (cfg.graphKey && !/^[a-f0-9]{32}$/i.test(cfg.graphKey) ? 'Essa chave não parece do The Graph (32 letras e números). Cole de novo.' : '');
const tkMsg = () => (cfg.gh.token && !TOKEN_RE.test(cfg.gh.token) ? 'Isso não parece um token do GitHub (começa com ghp_ ou github_pat_). Cole de novo.' : '');
function syncText() {
  if (!cfg.gh.token || !cfg.gh.repo) return 'Preencha o token e o repositório para os alertas funcionarem.';
  const s = state.sync;
  if (!s) return 'Ainda não sincronizado.';
  const t = new Date(s.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return s.ok ? `Sincronizado em ${t}.` : `Falha ao sincronizar (${t}): ${s.msg}`;
}
function payload() {
  const pos = {};
  for (const id of Object.keys(cfg.alerts)) { const a = alOf(id); if (Object.keys(a).length) pos[id] = a; }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo';
  return { v: 2, carteiras: cfg.wallets.map((w) => w.addr), redes: cfg.chains, ntfy: cfg.ntfy, graph: cfg.graphKey || '', tz,
    def: cfg.def, glob: cfg.glob, borda: cfg.def.borda, fee: cfg.def.fee || 0, pos };
}
let syncTimer = null;
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
async function syncNow() {
  if (state.demo || !cfg.gh.token || !cfg.gh.repo) return;
  if (!TOKEN_RE.test(cfg.gh.token)) { state.sync = { ok: false, at: Date.now(), msg: 'o campo não contém um token do GitHub' }; store.set('sync', state.sync); const el = document.getElementById('syncst'); if (el) el.textContent = syncText(); return; }
  const value = JSON.stringify(payload());
  const base = `https://api.github.com/repos/${cfg.gh.repo}/actions/variables`;
  const headers = { Authorization: `Bearer ${cfg.gh.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' };
  try {
    let r = await fetch(`${base}/ALERTAS`, { method: 'PATCH', headers, body: JSON.stringify({ name: 'ALERTAS', value }) });
    if (r.status === 404) r = await fetch(base, { method: 'POST', headers, body: JSON.stringify({ name: 'ALERTAS', value }) });
    if (!r.ok) throw new Error(r.status === 401 ? 'token inválido ou vencido' : r.status === 403 || r.status === 404 ? 'token sem permissão de Variables neste repositório' : 'erro ' + r.status);
    state.sync = { ok: true, at: Date.now() };
  } catch (e) { state.sync = { ok: false, at: Date.now(), msg: e.message }; }
  store.set('sync', state.sync);
  const el = document.getElementById('syncst'); if (el) el.textContent = syncText();
  if (!state.sync.ok) toast('Alertas não sincronizados');
}
async function ntfyTest() {
  if (!cfg.ntfy) return toast('Preencha o tópico');
  try {
    const r = await fetch('https://ntfy.sh', { method: 'POST', body: JSON.stringify({ topic: cfg.ntfy, title: 'Pools LP', message: 'Teste: as notificações estão funcionando.', tags: ['bell'] }) });
    toast(r.ok ? 'Enviado — veja o ntfy' : 'Falhou: ' + r.status);
  } catch { toast('Falha ao enviar'); }
}

// ---------- ações ----------
function toast(msg) {
  const t = document.createElement('div');
  t.textContent = msg;
  t.style.cssText = 'position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 24px);transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 16px;border-radius:12px;font-size:14px;z-index:9';
  document.body.appendChild(t); setTimeout(() => t.remove(), 1600);
}
function go(view) {
  if (view === 'cfg') { if (location.hash !== '#config') location.hash = 'config'; }
  else if (location.hash) history.back();
}
window.addEventListener('hashchange', () => {
  const was = state.view;
  state.view = location.hash === '#config' ? 'cfg' : 'main';
  state.cfgMsg = '';
  render();
  if (was === 'cfg' && state.view === 'main' && state.dirty) { state.dirty = false; state.data = null; refresh(); }
});

$app.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'refresh') refresh();
  else if (act === 'cfg') go('cfg');
  else if (act === 'back') go('main');
  else if (act === 'filter') { state.filter = el.dataset.v; store.set('filter', state.filter); render(); }
  else if (act === 'closed') { state.closedOpen = !state.closedOpen; render(); }
  else if (act === 'edit') { state.editing = el.dataset.id; render(); }
  else if (act === 'st') {
    const b = el.parentElement.querySelector('b');
    const v = Math.max(0, Math.min(50, (+b.dataset.v || 0) + (+el.dataset.d)));
    b.dataset.v = v; b.textContent = v ? v + '%' : 'desl.';
  } else if (act === 'seg') {
    el.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === el));
  } else if (act === 'tg') {
    const on = !el.classList.contains('on'); el.classList.toggle('on', on); el.setAttribute('aria-checked', on);
  } else if (act === 'dtg') {
    cfg.def[el.dataset.f] = !cfg.def[el.dataset.f]; saveDef(); render();
  } else if (act === 'gtg') {
    const f = el.dataset.f;
    if (f === 'silencio') cfg.glob.silencio = { ...cfg.glob.silencio, on: !cfg.glob.silencio.on }; else cfg.glob[f] = !cfg.glob[f];
    saveGlob(); render();
  } else if (act === 'al-ok') {
    const box = el.closest('.alert-edit'), id = box?.dataset.id;
    if (box && id) {
      const q = (f) => box.querySelector(`[data-f="${f}"]`);
      const seg = (f) => q(f).querySelector('button.on')?.dataset.v;
      const preco = parseNum(q('preco').value), comp = parseNum(q('comp').value);
      setAl(id, {
        range: q('range').classList.contains('on'),
        borda: +q('borda').dataset.v,
        alvo: preco ? { dir: seg('dir') || 'abaixo', preco } : null,
        fee: parseNum(q('fee').value), feeUsd: parseNum(q('feeUsd').value),
        comp: comp ? { side: seg('side') || 'base', pct: Math.min(100, Math.round(comp)) } : null,
        fora: parseNum(q('fora').value),
      });
    }
    state.editing = null; render();
  }
  else if (act === 'sortdir') { state.sort = { ...state.sort, desc: !state.sort.desc }; store.set('sort', state.sort); render(); }
  else if (act === 'ntfy-test') ntfyTest();
  else if (act === 'reveal') { const i = document.getElementById(el.dataset.for); const show = i.classList.toggle('shown'); el.textContent = show ? 'Ocultar' : 'Mostrar'; }
  else if (act === 'demo-on') { state.demo = true; refresh(); }
  else if (act === 'demo-off') { state.demo = false; state.data = null; history.replaceState(null, '', location.pathname); refresh(); }
  else if (act === 'wdel') { cfg.wallets.splice(+el.dataset.i, 1); save('wallets'); state.dirty = true; scheduleSync(); render(); }
});
$app.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.act === 'net') {
    const k = el.dataset.k;
    cfg.chains = el.checked ? [...new Set([...cfg.chains, k])] : cfg.chains.filter((x) => x !== k);
    save('chains'); state.dirty = true; scheduleSync();
  } else if (el.dataset.act === 'sort') {
    state.sort = { k: el.value, desc: SORTS[el.value].desc }; store.set('sort', state.sort); render();
  } else if (el.dataset.def) {
    const f = el.dataset.def, v = parseNum(el.value);
    cfg.def[f] = f === 'borda' || f === 'comp' ? (v ? Math.min(f === 'borda' ? 50 : 100, Math.round(v)) : 0) : v || 0; saveDef();
  } else if (el.id === 'glemb') { cfg.glob.lembrete = parseNum(el.value) || 0; saveGlob(); }
  else if (el.id === 'gde' || el.id === 'gate') { cfg.glob.silencio = { ...cfg.glob.silencio, [el.id === 'gde' ? 'de' : 'ate']: el.value || (el.id === 'gde' ? '23:00' : '07:00') }; saveGlob(); }
  else if (el.dataset.act === 'rpc') {
    const v = el.value.trim();
    if (v) cfg.rpc[el.dataset.k] = v; else delete cfg.rpc[el.dataset.k];
    save('rpc'); state.dirty = true;
  } else if (el.id === 'gkey') { cfg.graphKey = el.value.trim(); save('graphKey'); state.dirty = true; scheduleSync(); const e2 = document.getElementById('gkerr'); if (e2) e2.textContent = gkMsg(); }
  else if (el.id === 'ntfy') { cfg.ntfy = el.value.trim(); save('ntfy'); scheduleSync(); }
  else if (el.id === 'ghtok' || el.id === 'ghrepo') {
    cfg.gh = { token: document.getElementById('ghtok').value.trim(), repo: document.getElementById('ghrepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, '') };
    save('gh'); syncNow();
    const e3 = document.getElementById('tkerr'); if (e3) e3.textContent = tkMsg();
  }
});
$app.addEventListener('submit', (e) => {
  if (e.target.id !== 'wform') return;
  e.preventDefault();
  const f = new FormData(e.target);
  const addr = String(f.get('addr') || '').trim();
  const name = String(f.get('name') || '').trim();
  const err = (m) => { document.getElementById('werr').textContent = m; };
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) return err('Endereço inválido: use 0x seguido de 40 caracteres.');
  if (cfg.wallets.some((w) => w.addr.toLowerCase() === addr.toLowerCase())) return err('Essa carteira já está na lista.');
  cfg.wallets.push({ name: name || `Carteira ${cfg.wallets.length + 1}`, addr });
  save('wallets'); state.dirty = true; state.cfgMsg = ''; scheduleSync(); render();
});

// ---------- ciclo ----------
setInterval(() => { const a = document.getElementById('ago'); if (a) a.textContent = agoText(); }, 1000);
setInterval(() => { if (document.visibilityState === 'visible' && state.view === 'main' && !state.editing) refresh(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.data && Date.now() - state.data.updatedAt > 30000) refresh();
});
render();
refresh();
