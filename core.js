// Pools LP — núcleo de dados (usado pelo app e pelo verificador de alertas)
// Lê posições Uniswap v3 e v4 direto da blockchain (RPC público), usa The Graph
// só para descobrir os IDs das posições v4 e DefiLlama para preços em US$.

export const VERSION = '1.0.2';

export const CHAINS = {
  ethereum: {
    name: 'Ethereum', slug: 'ethereum', llama: 'ethereum',
    rpc: 'https://ethereum-rpc.publicnode.com',
    v3npm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    v3factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    v4pm: '0xbd216513d74c8cf14cf4747e6aaa6420ff64ee9e',
    v4sv: '0x7ffe42c4a5deea5b0fec41c94c136cf115597227',
    v4sub: 'DiYPVdygkfjDWhbxGSqAQxwBKmfKnkWQojqeM2rkLb3G',
    native: { symbol: 'ETH', llama: 'coingecko:ethereum' },
  },
  arbitrum: {
    name: 'Arbitrum', slug: 'arbitrum', llama: 'arbitrum',
    rpc: 'https://arbitrum-one-rpc.publicnode.com',
    v3npm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    v3factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    v4pm: '0xd88f38f930b7952f2db2432cb002e7abbf3dd869',
    v4sv: '0x76fd297e2d437cd7f76d50f01afe6160f86e9990',
    v4sub: 'G5TsTKNi8yhPSV7kycaE23oWbqv9zzNqR49FoEQjzq1r',
    native: { symbol: 'ETH', llama: 'coingecko:ethereum' },
  },
  base: {
    name: 'Base', slug: 'base', llama: 'base',
    rpc: 'https://base-rpc.publicnode.com',
    v3npm: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
    v3factory: '0x33128a8fC17869897dcE68Ed026d694621f6FDfD',
    v4pm: '0x7c5f5a4bbd8fd63184577525326123b519429bdc',
    v4sv: '0xa3c0c9b65bad0b08107aa264b0f3db444b867a71',
    v4sub: 'HNCFA9TyBqpo5qpe6QreQABAA1kV8g46mhkCcicu6v2R',
    native: { symbol: 'ETH', llama: 'coingecko:ethereum' },
  },
  polygon: {
    name: 'Polygon', slug: 'polygon', llama: 'polygon',
    rpc: 'https://polygon-bor-rpc.publicnode.com',
    v3npm: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
    v3factory: '0x1F98431c8aD98523631AE4a59f267346ea31F984',
    v4pm: '0x1ec2ebf4f37e7363fdfe3551602425af0b3ceef9',
    v4sv: '0x5ea1bd7974c8a611cbab0bdcafcb1d9cc9b3ba5a',
    v4sub: 'CwpebM66AH5uqS5sreKij8yEkkPcHvmyEs7EwFtdM5ND',
    native: { symbol: 'POL', llama: 'coingecko:polygon-ecosystem-token' },
  },
  monad: {
    name: 'Monad', slug: 'monad', llama: 'monad',
    rpc: 'https://rpc.monad.xyz',
    v3npm: '0x7197e214c0b767cfb76fb734ab638e2c192f4e53',
    v3factory: '0x204faca1764b154221e35c0d20abb3c525710498',
    v4pm: '0x5b7ec4a94ff9bedb700fb82ab09d5846972f4016',
    v4sv: '0x77395f3b2e73ae90843717371294fa97cc419d64',
    v4sub: null, // ainda sem índice oficial no The Graph: só v3
    native: { symbol: 'MON', llama: 'coingecko:monad' },
  },
};

// ---------- keccak256 (para seletores e poolId da v4) ----------
const MASK = (1n << 64n) - 1n;
const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808An, 0x8000000080008000n,
  0x000000000000808Bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008An, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000An,
  0x000000008000808Bn, 0x800000000000008Bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800An, 0x800000008000000An,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
const rotl = (v, n) => (n === 0 ? v : ((v << BigInt(n)) | (v >> BigInt(64 - n))) & MASK);
function keccakF(s) {
  const C = new Array(5), B = new Array(25);
  for (let r = 0; r < 24; r++) {
    for (let x = 0; x < 5; x++) C[x] = s[x] ^ s[x + 5] ^ s[x + 10] ^ s[x + 15] ^ s[x + 20];
    for (let x = 0; x < 5; x++) {
      const d = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) s[x + y] ^= d;
    }
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(s[x + 5 * y], ROT[x][y]);
    for (let x = 0; x < 5; x++) for (let y = 0; y < 5; y++) {
      s[x + 5 * y] = B[x + 5 * y] ^ ((B[(x + 1) % 5 + 5 * y] ^ MASK) & B[(x + 2) % 5 + 5 * y]);
    }
    s[0] ^= RC[r];
  }
}
export function keccak256(bytes) {
  const rate = 136;
  const padLen = rate - (bytes.length % rate);
  const msg = new Uint8Array(bytes.length + padLen);
  msg.set(bytes);
  msg[bytes.length] ^= 0x01;
  msg[msg.length - 1] ^= 0x80;
  const s = new Array(25).fill(0n);
  for (let off = 0; off < msg.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(msg[off + i * 8 + b]);
      s[i] ^= lane;
    }
    keccakF(s);
  }
  let hex = '';
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) hex += Number((s[i] >> BigInt(8 * b)) & 0xffn).toString(16).padStart(2, '0');
  return hex;
}
const utf8 = (str) => new TextEncoder().encode(str);
const hexToBytes = (h) => { h = h.replace(/^0x/, ''); const o = new Uint8Array(h.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
const selCache = {};
export const sel = (sig) => (selCache[sig] ||= keccak256(utf8(sig)).slice(0, 8));

// ---------- ABI mínima ----------
const M256 = 1n << 256n;
const word = (v) => (((BigInt(v) % M256) + M256) % M256).toString(16).padStart(64, '0');
const addrWord = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export function call(to, sig, args = []) {
  const types = sig.slice(sig.indexOf('(') + 1, -1).split(',').filter(Boolean);
  const data = '0x' + sel(sig) + args.map((a, i) => (types[i] === 'address' ? addrWord(a) : types[i] === 'bytes32' ? String(a).replace(/^0x/, '').padStart(64, '0') : word(a))).join('');
  return { to, data };
}
export const words = (hex) => { const h = (hex || '0x').replace(/^0x/, ''); const o = []; for (let i = 0; i + 64 <= h.length; i += 64) o.push(BigInt('0x' + h.substr(i, 64))); return o; };
export const signed = (v, bits) => { const m = 1n << BigInt(bits); v = v & (m - 1n); return v >= m >> 1n ? v - m : v; };
const wAddr = (w) => '0x' + w.toString(16).padStart(40, '0').slice(-40);
function decodeString(hex) {
  const h = (hex || '0x').replace(/^0x/, '');
  if (!h) return null;
  try {
    if (h.length === 64) return new TextDecoder().decode(hexToBytes(h)).replace(/\u0000+$/g, '').trim() || null;
    const off = parseInt(h.substr(0, 64), 16) * 2;
    const len = parseInt(h.substr(off, 64), 16);
    return new TextDecoder().decode(hexToBytes(h.substr(off + 64, len * 2))).trim() || null;
  } catch { return null; }
}

// ---------- RPC em lote ----------
async function rpcBatch(url, calls, chunk = 40) {
  const out = new Array(calls.length).fill(null);
  for (let i = 0; i < calls.length; i += chunk) {
    const part = calls.slice(i, i + chunk);
    const body = part.map((c, j) => ({ jsonrpc: '2.0', id: i + j, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
    let res;
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      res = await r.json();
      if (!Array.isArray(res)) throw new Error('lote não suportado');
    } catch (e) {
      // alguns RPCs não aceitam lote: tenta um a um
      res = [];
      for (const b of body) {
        const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) });
        res.push(await r.json());
      }
    }
    for (const it of res) if (it && it.result && it.result !== '0x') out[it.id] = it.result;
  }
  return out;
}

// ---------- The Graph (IDs das posições v4) ----------
async function v4TokenIds(chain, owners, graphKey) {
  const url = `https://gateway.thegraph.com/api/${graphKey}/subgraphs/id/${chain.v4sub}`;
  const query = `{ positions(first: 500, where: { owner_in: ${JSON.stringify(owners.map((o) => o.toLowerCase()))} }) { tokenId owner } }`;
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
  const j = await r.json();
  if (j.errors) throw new Error(j.errors[0]?.message || 'erro no The Graph');
  return (j.data?.positions || []).map((p) => ({ tokenId: BigInt(p.tokenId), owner: p.owner }));
}

// ---------- matemática de fees ----------
const sub256 = (a, b) => (((a - b) % M256) + M256) % M256;
const Q128 = 1n << 128n;

// ---------- leitura por rede ----------
async function tokenMeta(rpc, chain, addrs, cache) {
  const need = [...new Set(addrs.map((a) => a.toLowerCase()))].filter((a) => !cache[a]);
  const calls = [];
  for (const a of need) {
    if (/^0x0{40}$/.test(a)) { cache[a] = { addr: a, symbol: chain.native.symbol, dec: 18, native: true }; continue; }
    calls.push(call(a, 'symbol()'), call(a, 'decimals()'));
  }
  const res = await rpcBatch(rpc, calls);
  let k = 0;
  for (const a of need) {
    if (cache[a]) continue;
    const sym = decodeString(res[k++]);
    const d = words(res[k++])[0];
    cache[a] = { addr: a, symbol: sym || a.slice(0, 6), dec: d !== undefined ? Number(d) : 18 };
  }
}

async function readV3(key, chain, rpc, owners, meta) {
  const bal = await rpcBatch(rpc, owners.map((o) => call(chain.v3npm, 'balanceOf(address)', [o])));
  const idx = [];
  owners.forEach((o, i) => { const n = Number(words(bal[i])[0] || 0n); for (let j = n - 1; j >= 0 && j >= n - 1000; j--) idx.push({ owner: o, j }); });
  if (!idx.length) return [];
  const idsRes = await rpcBatch(rpc, idx.map((x) => call(chain.v3npm, 'tokenOfOwnerByIndex(address,uint256)', [x.owner, x.j])));
  const ids = idx.map((x, i) => ({ owner: x.owner, tokenId: words(idsRes[i])[0] })).filter((x) => x.tokenId !== undefined);
  const posRes = await rpcBatch(rpc, ids.map((x) => call(chain.v3npm, 'positions(uint256)', [x.tokenId])));
  const raw = [];
  ids.forEach((x, i) => {
    const w = words(posRes[i]);
    if (w.length < 12) return;
    raw.push({ ...x, t0: wAddr(w[2]), t1: wAddr(w[3]), fee: Number(w[4]), tl: Number(signed(w[5], 24)), tu: Number(signed(w[6], 24)),
      liq: w[7], last0: w[8], last1: w[9], owed0: w[10], owed1: w[11] });
  });
  if (!raw.length) return [];
  const poolKeys = [...new Set(raw.map((p) => `${p.t0}|${p.t1}|${p.fee}`))];
  const poolRes = await rpcBatch(rpc, poolKeys.map((k) => { const [a, b, f] = k.split('|'); return call(chain.v3factory, 'getPool(address,address,uint24)', [a, b, f]); }));
  const poolAddr = {};
  poolKeys.forEach((k, i) => { poolAddr[k] = wAddr(words(poolRes[i])[0] || 0n); });
  await tokenMeta(rpc, chain, raw.flatMap((p) => [p.t0, p.t1]), meta);
  const pools = [...new Set(Object.values(poolAddr))];
  const sRes = await rpcBatch(rpc, pools.flatMap((p) => [call(p, 'slot0()'), call(p, 'feeGrowthGlobal0X128()'), call(p, 'feeGrowthGlobal1X128()')]));
  const ps = {};
  pools.forEach((p, i) => { const s0 = words(sRes[i * 3]); ps[p] = { sqrtP: s0[0] || 0n, tick: Number(signed(s0[1] || 0n, 24)), g0: words(sRes[i * 3 + 1])[0] || 0n, g1: words(sRes[i * 3 + 2])[0] || 0n }; });
  const tRes = await rpcBatch(rpc, raw.flatMap((p) => { const pa = poolAddr[`${p.t0}|${p.t1}|${p.fee}`]; return [call(pa, 'ticks(int24)', [p.tl]), call(pa, 'ticks(int24)', [p.tu])]; }));
  return raw.map((p, i) => {
    const pool = ps[poolAddr[`${p.t0}|${p.t1}|${p.fee}`]];
    const L = words(tRes[i * 2]), U = words(tRes[i * 2 + 1]);
    const oL0 = L[2] || 0n, oL1 = L[3] || 0n, oU0 = U[2] || 0n, oU1 = U[3] || 0n;
    const below0 = pool.tick >= p.tl ? oL0 : sub256(pool.g0, oL0), below1 = pool.tick >= p.tl ? oL1 : sub256(pool.g1, oL1);
    const above0 = pool.tick < p.tu ? oU0 : sub256(pool.g0, oU0), above1 = pool.tick < p.tu ? oU1 : sub256(pool.g1, oU1);
    const in0 = sub256(sub256(pool.g0, below0), above0), in1 = sub256(sub256(pool.g1, below1), above1);
    const f0 = p.owed0 + (p.liq * sub256(in0, p.last0)) / Q128;
    const f1 = p.owed1 + (p.liq * sub256(in1, p.last1)) / Q128;
    return { id: `${key}-v3-${p.tokenId}`, chain: key, ver: 'v3', tokenId: p.tokenId.toString(), owner: p.owner,
      t0: meta[p.t0.toLowerCase()], t1: meta[p.t1.toLowerCase()], fee: p.fee, tl: p.tl, tu: p.tu, liq: p.liq,
      sqrtP: pool.sqrtP, tick: pool.tick, fees0: f0, fees1: f1 };
  });
}

async function readV4(key, chain, rpc, owners, graphKey, meta) {
  const ids = await v4TokenIds(chain, owners, graphKey);
  if (!ids.length) return [];
  const res = await rpcBatch(rpc, ids.flatMap((x) => [call(chain.v4pm, 'getPoolAndPositionInfo(uint256)', [x.tokenId]), call(chain.v4pm, 'getPositionLiquidity(uint256)', [x.tokenId])]));
  const raw = [];
  ids.forEach((x, i) => {
    const w = words(res[i * 2]);
    if (w.length < 6 || w[1] === 0n) return; // queimada
    const info = w[5];
    const enc = w.slice(0, 5).map((v) => v.toString(16).padStart(64, '0')).join('');
    raw.push({ ...x, c0: wAddr(w[0]), c1: wAddr(w[1]), fee: Number(w[2]),
      tl: Number(signed(info >> 8n, 24)), tu: Number(signed(info >> 32n, 24)),
      liq: words(res[i * 2 + 1])[0] || 0n, poolId: '0x' + keccak256(hexToBytes(enc)) });
  });
  if (!raw.length) return [];
  await tokenMeta(rpc, chain, raw.flatMap((p) => [p.c0, p.c1]), meta);
  const poolIds = [...new Set(raw.map((p) => p.poolId))];
  const sRes = await rpcBatch(rpc, poolIds.map((id) => call(chain.v4sv, 'getSlot0(bytes32)', [id])));
  const ps = {};
  poolIds.forEach((id, i) => { const w = words(sRes[i]); ps[id] = { sqrtP: w[0] || 0n, tick: Number(signed(w[1] || 0n, 24)) }; });
  const fRes = await rpcBatch(rpc, raw.flatMap((p) => [
    call(chain.v4sv, 'getFeeGrowthInside(bytes32,int24,int24)', [p.poolId, p.tl, p.tu]),
    call(chain.v4sv, 'getPositionInfo(bytes32,address,int24,int24,bytes32)', [p.poolId, chain.v4pm, p.tl, p.tu, p.tokenId.toString(16)]),
  ]));
  return raw.map((p, i) => {
    const g = words(fRes[i * 2]), inf = words(fRes[i * 2 + 1]);
    const L = inf[0] ?? p.liq;
    const f0 = g.length && inf.length ? (L * sub256(g[0], inf[1])) / Q128 : 0n;
    const f1 = g.length && inf.length ? (L * sub256(g[1], inf[2])) / Q128 : 0n;
    const pool = ps[p.poolId];
    return { id: `${key}-v4-${p.tokenId}`, chain: key, ver: 'v4', tokenId: p.tokenId.toString(), owner: p.owner,
      t0: meta[p.c0.toLowerCase()], t1: meta[p.c1.toLowerCase()], fee: p.fee, tl: p.tl, tu: p.tu, liq: p.liq,
      sqrtP: pool.sqrtP, tick: pool.tick, fees0: f0, fees1: f1 };
  });
}

// ---------- preços ----------
async function usdPrices(list) {
  const keys = [...new Set(list)];
  const out = {};
  for (let i = 0; i < keys.length; i += 80) {
    try {
      const r = await fetch('https://coins.llama.fi/prices/current/' + keys.slice(i, i + 80).join(','));
      const j = await r.json();
      for (const [k, v] of Object.entries(j.coins || {})) out[k.toLowerCase()] = v.price;
    } catch { /* sem preço: o app mostra — */ }
  }
  return out;
}
const priceKey = (chain, t) => (t.native ? chain.native.llama : `${chain.llama}:${t.addr}`).toLowerCase();

// ---------- derivar o que o cartão mostra ----------
const STABLES = /^(usdc|usdc\.e|usdbc|usdt|usdt0|usd₮0|dai|frax|lusd|gho|pyusd|usds|usde|crvusd|eurc)$/i;
const MAJORS = /^(weth|eth|steth|wsteth|cbeth|reth|weeth)$/i;
const BTCS = /^(wbtc|cbbtc|tbtc|btc\.b)$/i;
const rank = (t) => (STABLES.test(t.symbol) ? 3 : MAJORS.test(t.symbol) ? 2 : BTCS.test(t.symbol) ? 1 : 0);

export function derive(p, prices, alertPct) {
  const chain = CHAINS[p.chain];
  const d0 = p.t0.dec, d1 = p.t1.dec;
  const sp = Number(p.sqrtP) / 2 ** 96;
  const scale = 10 ** (d0 - d1);
  const p01 = sp * sp * scale;
  const pa = 1.0001 ** p.tl * scale, pb = 1.0001 ** p.tu * scale;
  const L = Number(p.liq);
  const sa = 1.0001 ** (p.tl / 2), sb = 1.0001 ** (p.tu / 2);
  let a0 = 0, a1 = 0;
  if (L > 0) {
    if (sp <= sa) a0 = (L * (sb - sa)) / (sa * sb);
    else if (sp >= sb) a1 = L * (sb - sa);
    else { a0 = (L * (sb - sp)) / (sp * sb); a1 = L * (sp - sa); }
  }
  a0 /= 10 ** d0; a1 /= 10 ** d1;
  const fe0 = Number(p.fees0) / 10 ** d0, fe1 = Number(p.fees1) / 10 ** d1;

  const invert = rank(p.t0) > rank(p.t1);
  const base = invert ? p.t1 : p.t0, quote = invert ? p.t0 : p.t1;
  const price = invert ? 1 / p01 : p01;
  const pmin = invert ? 1 / pb : pa, pmax = invert ? 1 / pa : pb;
  const amtBase = invert ? a1 : a0, amtQuote = invert ? a0 : a1;

  let u0 = prices[priceKey(chain, p.t0)], u1 = prices[priceKey(chain, p.t1)];
  if (u0 == null && u1 != null) u0 = u1 * p01;
  if (u1 == null && u0 != null && p01 > 0) u1 = u0 / p01;
  const hasUsd = u0 != null && u1 != null;
  const valueUsd = hasUsd ? a0 * u0 + a1 * u1 : null;
  const feesUsd = hasUsd ? fe0 * u0 + fe1 * u1 : null;

  const inQuote = amtBase * price + amtQuote;
  const compBase = inQuote > 0 ? (amtBase * price) / inQuote : price <= pmin ? 1 : 0;
  const feeBase = invert ? fe1 : fe0, feeQuote = invert ? fe0 : fe1;
  const feeYield = inQuote > 0 ? ((feeBase * price + feeQuote) / inQuote) * 100 : null;

  const closed = p.liq === 0n;
  const inRange = p.tick >= p.tl && p.tick < p.tu;
  let dist, side;
  if (inRange) { const lo = (price - pmin) / price, hi = (pmax - price) / price; dist = Math.min(lo, hi); side = lo < hi ? 'min' : 'max'; }
  else if (price < pmin) { dist = (pmin - price) / price; side = 'abaixo'; }
  else { dist = (price - pmax) / price; side = 'acima'; }
  const status = closed ? 'fechada' : !inRange ? 'fora' : dist * 100 < alertPct ? 'perto' : 'range';
  const frac = Math.max(0, Math.min(1, (price - pmin) / (pmax - pmin)));

  return { ...p, base, quote, price, pmin, pmax, frac, compBase, amtBase, amtQuote,
    valueUsd, feesUsd, feeYield, fees: { [p.t0.symbol]: fe0, [p.t1.symbol]: fe1 }, status, dist, side, alertPct, closed,
    feePct: p.fee / 10000, chainName: chain.name,
    link: `https://app.uniswap.org/positions/${p.ver}/${chain.slug}/${p.tokenId}` };
}

// ---------- ponto de entrada ----------
export async function loadPositions({ wallets, chains, graphKey, rpcOverrides = {}, alertFor = () => 5 }) {
  const owners = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const errors = [], all = [];
  const metaByChain = {};
  await Promise.all(chains.map(async (key) => {
    const chain = CHAINS[key];
    const rpc = rpcOverrides[key] || chain.rpc;
    const meta = (metaByChain[key] = {});
    const jobs = [readV3(key, chain, rpc, owners, meta).catch((e) => { errors.push(`${chain.name} v3: ${e.message}`); return []; })];
    if (graphKey && chain.v4sub) jobs.push(readV4(key, chain, rpc, owners, graphKey, meta).catch((e) => { errors.push(`${chain.name} v4: ${e.message}`); return []; }));
    for (const r of await Promise.all(jobs)) all.push(...r);
  }));
  const prices = await usdPrices(all.flatMap((p) => [priceKey(CHAINS[p.chain], p.t0), priceKey(CHAINS[p.chain], p.t1)]));
  const positions = all.map((p) => derive(p, prices, alertFor(p.id)));
  return { positions, errors, needsGraphKey: !graphKey, updatedAt: Date.now() };
}
