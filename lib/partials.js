// TP parciais: junta as saídas já executadas e os TPs que faltam num "escalonamento" único.
// Trade da Hyperliquid: qty = o que sobrou; parts = saídas executadas; tps = ordens de TP abertas.
// Trade manual: qty = tamanho original; tps = [{ px, pct }] (% do tamanho original); parts = saídas registradas.
const sgn = (t) => (t.dir === 'baixa' ? -1 : 1);
const ok = (v) => v != null && isFinite(v) && v > 0;

export const isManual = (t) => t.source !== 'hl';
export const partsOf = (t) => t.parts || [];
// quanto ainda está aberto
export const restQty = (t) => (t.status === 'closed' ? 0 : isManual(t) ? Math.max(0, t.qty - partsOf(t).reduce((a, p) => a + p.sz, 0)) : t.qty);
// tamanho original (trade fechado da HL: qty já é o tamanho máximo)
export const origQty = (t) => (isManual(t) || t.status === 'closed' ? t.qty : Math.max(t.origQty || 0, t.qty + partsOf(t).reduce((a, p) => a + p.sz, 0)));
// resultado das parciais (HL: líquido da taxa de saída; manual: bruto)
export const partPl = (t, p) => (p.pnl != null ? p.pnl : sgn(t) * (p.px - t.entry) * p.sz);
export const realizedParts = (t) => partsOf(t).reduce((a, p) => a + partPl(t, p), 0);

// TPs que ainda faltam, do mais perto ao mais longe, com o tamanho limitado ao que sobrou
export function pendingTps(t) {
  const s = sgn(t), rest = restQty(t);
  let list;
  if (isManual(t)) {
    const orig = origQty(t);
    const tps = (t.tps || []).filter((x) => ok(x.px));
    // TPs já executados ficam marcados na saída (tp = índice); saídas feitas à mão não consomem TP
    const used = new Set(partsOf(t).map((p) => p.tp).filter((i) => i != null));
    list = tps.length ? tps.map((x, i) => ({ px: x.px, sz: (x.pct || 0) / 100 * orig, i })).filter((x) => !used.has(x.i)) : ok(t.target) ? [{ px: t.target, sz: rest }] : [];
    // o último TP leva o que sobrar
    if (list.length) list[list.length - 1].sz = Math.max(list[list.length - 1].sz, rest - list.slice(0, -1).reduce((a, x) => a + x.sz, 0));
  } else {
    list = (t.tps || []).length ? t.tps.map((x) => ({ px: x.px, sz: x.sz || rest })) : ok(t.tp) ? [{ px: t.tp, sz: rest }] : [];
  }
  list.sort((a, b) => s * (a.px - b.px));
  let left = rest;
  return list.map((x) => { const sz = Math.max(0, Math.min(x.sz, left)); left -= sz; return { ...x, sz }; }).filter((x) => x.sz > 1e-12);
}

// Escalonamento completo: executadas (por hora) + pendentes, numeradas TP1, TP2…
export function ladder(t, rate = 0.00045) {
  const s = sgn(t), rest = restQty(t), orig = origQty(t);
  const sl = (t.source === 'hl' ? t.sl : t.stop) ?? null;
  const done = [...partsOf(t)].sort((a, b) => a.time - b.time).map((p) => ({ ...p, done: true, net: partPl(t, p), win: s * (p.px - t.entry) > 0 }));
  const fee = (px, sz) => (isManual(t) ? 0 : px * sz * rate);
  const pend = pendingTps(t).map((x) => ({ ...x, done: false, net: s * (x.px - t.entry) * x.sz - fee(x.px, x.sz) }));
  const levels = [...done, ...pend].map((x, i) => ({ ...x, n: i + 1, pctOrig: orig ? x.sz / orig : 0 }));
  done.splice(0, done.length, ...levels.filter((x) => x.done));
  pend.splice(0, pend.length, ...levels.filter((x) => !x.done));
  const realized = done.reduce((a, x) => a + x.net, 0);
  const slLeg = ok(sl) ? s * (sl - t.entry) * rest - fee(sl, rest) : null;
  const ifSl = slLeg != null ? realized + slLeg : null;
  const covered = pend.reduce((a, x) => a + x.sz, 0);
  const ifAll = pend.length ? realized + pend.reduce((a, x) => a + x.net, 0) : null;
  const risk0 = ok(sl) ? Math.abs(sl - t.entry) * orig : null;
  const next = pend[0] || null;
  return {
    levels, done, pend, next, rest, orig, sl, realized, ifSl, ifAll,
    uncovered: Math.max(0, rest - covered), // parte sem TP
    rrAvg: ifAll != null && risk0 ? ifAll / risk0 : null,
    // R/R da entrada com o SL de agora: ganho se todos os TPs baterem ÷ perda se o SL bater (SL na entrada ou no lucro = Infinity, sem risco)
    rr: ifAll == null || !ok(sl) ? null : s * (sl - t.entry) >= 0 ? Infinity : risk0 ? ifAll / risk0 : null,
    partial: levels.length > 1 || done.length > 0,
    // TP executado e o SL ainda do lado do prejuízo: dá para travar o lucro levando o SL para a entrada
    lockHint: done.some((x) => x.win) && ok(sl) && s * (sl - t.entry) < -t.entry * 0.003 && rest > 0, // SL a até 0,3% da entrada já conta como na entrada
  };
}
