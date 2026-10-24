// 所有金額皆為整數新台幣（元）。

export type Split =
  | { mode: 'equal'; members: string[] }
  | { mode: 'amount'; amounts: Record<string, number> }
  | { mode: 'ratio'; weights: Record<string, number> };

export interface Expense {
  id: string;
  title: string;
  amount: number;
  payers: Record<string, number>; // 成員 ID -> 已付金額
  split: Split;
  createdAt: number;
}

export interface Transfer {
  from: string;
  to: string;
  amount: number;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/** 把分帳方式正規化成「每人應分攤金額」，總和必定等於 amount。 */
export function computeShares(
  amount: number,
  split: Split,
  payers: Record<string, number>,
): Record<string, number> {
  if (split.mode === 'amount') return { ...split.amounts };

  const weights =
    split.mode === 'equal'
      ? Object.fromEntries(split.members.map((id) => [id, 1]))
      : split.weights;
  const ids = Object.keys(weights).filter((id) => weights[id] > 0);
  const total = sum(ids.map((id) => weights[id]));
  if (total === 0) return {};

  const shares: Record<string, number> = {};
  for (const id of ids) shares[id] = Math.floor((amount * weights[id]) / total);
  let rest = amount - sum(Object.values(shares));
  if (rest === 0) return shares;

  if (split.mode === 'equal') {
    // 尾數由第一位有分攤的付款人吸收，否則由第一位分攤者吸收
    const payer = Object.keys(payers).find((id) => payers[id] > 0 && id in shares);
    shares[payer ?? ids[0]] += rest;
    return shares;
  }
  // 比例：最大餘數法
  const byRemainder = [...ids].sort(
    (a, b) => ((amount * weights[b]) % total) - ((amount * weights[a]) % total),
  );
  for (let i = 0; rest > 0; i++, rest--) shares[byRemainder[i % ids.length]] += 1;
  return shares;
}

/** 回傳表單錯誤訊息；空陣列代表可以送出。 */
export function validateExpense(e: Omit<Expense, 'id' | 'createdAt'>): string[] {
  const errors: string[] = [];
  if (!e.title.trim()) errors.push('請輸入品名');
  if (!Number.isInteger(e.amount) || e.amount <= 0) errors.push('金額必須是大於 0 的整數');
  const paid = sum(Object.values(e.payers));
  if (paid !== e.amount) errors.push(`付款合計 ${paid} 元，與總金額差 ${e.amount - paid} 元`);
  const shares = computeShares(e.amount, e.split, e.payers);
  if (Object.keys(shares).length === 0) errors.push('請至少選擇一位分攤對象');
  else {
    const owed = sum(Object.values(shares));
    if (owed !== e.amount) errors.push(`分攤合計 ${owed} 元，與總金額差 ${e.amount - owed} 元`);
  }
  return errors;
}

/** 每人的已付、應付、淨額（正數 = 應收，負數 = 應付）。 */
export function balances(memberIds: string[], expenses: Expense[]) {
  const result: Record<string, { paid: number; owed: number; net: number }> = {};
  for (const id of memberIds) result[id] = { paid: 0, owed: 0, net: 0 };
  for (const e of expenses) {
    for (const [id, v] of Object.entries(e.payers)) if (result[id]) result[id].paid += v;
    for (const [id, v] of Object.entries(computeShares(e.amount, e.split, e.payers)))
      if (result[id]) result[id].owed += v;
  }
  for (const r of Object.values(result)) r.net = r.paid - r.owed;
  return result;
}

/** 貪婪法：每回合讓欠最多的人付給應收最多的人，最多 n−1 筆轉帳。 */
export function settle(net: Record<string, number>): Transfer[] {
  const debtors = Object.entries(net).filter(([, v]) => v < 0).map(([id, v]) => ({ id, v: -v }));
  const creditors = Object.entries(net).filter(([, v]) => v > 0).map(([id, v]) => ({ id, v }));
  const transfers: Transfer[] = [];
  while (debtors.length && creditors.length) {
    debtors.sort((a, b) => b.v - a.v);
    creditors.sort((a, b) => b.v - a.v);
    const d = debtors[0];
    const c = creditors[0];
    const amount = Math.min(d.v, c.v);
    transfers.push({ from: d.id, to: c.id, amount });
    d.v -= amount;
    c.v -= amount;
    if (d.v === 0) debtors.shift();
    if (c.v === 0) creditors.shift();
  }
  return transfers;
}
