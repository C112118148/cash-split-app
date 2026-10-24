import { describe, expect, it } from 'vitest';
import { balances, computeShares, settle, validateExpense, type Expense } from './split';

const exp = (p: Partial<Expense> & Pick<Expense, 'amount' | 'payers' | 'split'>): Expense => ({
  id: Math.random().toString(36), title: 't', createdAt: 0, ...p,
});
const total = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

describe('computeShares', () => {
  it('平分 1000 元給 3 人，尾數由付款人吸收', () => {
    const s = computeShares(1000, { mode: 'equal', members: ['A', 'B', 'C'] }, { B: 1000 });
    expect(s).toEqual({ A: 333, B: 334, C: 333 });
  });
  it('付款人不在分攤名單時，尾數給第一位分攤者', () => {
    const s = computeShares(100, { mode: 'equal', members: ['A', 'B', 'C'] }, { D: 100 });
    expect(s).toEqual({ A: 34, B: 33, C: 33 });
  });
  it('按比例：司機比例 0 不分攤', () => {
    const s = computeShares(900, { mode: 'ratio', weights: { 司機: 0, A: 1, B: 1, C: 1 } }, { A: 900 });
    expect(s).toEqual({ A: 300, B: 300, C: 300 });
  });
  it('按比例有尾數時總和仍正確', () => {
    const s = computeShares(1000, { mode: 'ratio', weights: { A: 1, B: 2, C: 4 } }, { A: 1000 });
    expect(total(s)).toBe(1000);
    expect(s).toEqual({ A: 143, B: 286, C: 571 });
  });
});

describe('validateExpense', () => {
  it('多人湊錢付：A 付 500、B 付 300 湊足 800', () => {
    const e = { title: '晚餐', amount: 800, payers: { A: 500, B: 300 }, split: { mode: 'equal' as const, members: ['A', 'B'] } };
    expect(validateExpense(e)).toEqual([]);
  });
  it('付款與分攤總和不符時提示差額', () => {
    const e = { title: '午餐', amount: 800, payers: { A: 500 }, split: { mode: 'amount' as const, amounts: { A: 300, B: 250 } } };
    expect(validateExpense(e)).toEqual(['付款合計 500 元，與總金額差 300 元', '分攤合計 550 元，與總金額差 250 元']);
  });
  it('沒有分攤對象時提示', () => {
    const e = { title: 'x', amount: 100, payers: { A: 100 }, split: { mode: 'equal' as const, members: [] } };
    expect(validateExpense(e)).toContain('請至少選擇一位分攤對象');
  });
});

describe('settle', () => {
  it('文件範例：A 各轉 200 給 B 和 C', () => {
    const t = settle({ A: -400, B: 200, C: 200 });
    expect(t).toHaveLength(2);
    expect(t.every((x) => x.from === 'A' && x.amount === 200)).toBe(true);
  });
  it('A 欠 B 200、B 欠 C 200 化簡成 A 給 C 200', () => {
    expect(settle({ A: -200, B: 0, C: 200 })).toEqual([{ from: 'A', to: 'C', amount: 200 }]);
  });
  it('n 人最多 n−1 筆，且轉完後每人歸零', () => {
    const net = { A: -1234, B: -566, C: 300, D: 1000, E: 500 };
    const t = settle(net);
    expect(t.length).toBeLessThanOrEqual(4);
    const after: Record<string, number> = { ...net };
    for (const x of t) { after[x.from] += x.amount; after[x.to] -= x.amount; }
    expect(Object.values(after).every((v) => v === 0)).toBe(true);
  });
});

describe('台南遊情境', () => {
  it('住宿、午餐、湊錢晚餐、司機不分油錢，淨額加總為 0', () => {
    const m = ['小明', '小軒', '小美', '小華', '小強'];
    const b = balances(m, [
      exp({ amount: 6000, payers: { 小明: 6000 }, split: { mode: 'equal', members: m } }),
      exp({ amount: 1200, payers: { 小軒: 1200 }, split: { mode: 'equal', members: m } }),
      exp({ amount: 1500, payers: { 小美: 800, 小華: 700 }, split: { mode: 'amount', amounts: { 小明: 300, 小軒: 250, 小美: 350, 小華: 300, 小強: 300 } } }),
      exp({ amount: 1000, payers: { 小強: 1000 }, split: { mode: 'ratio', weights: { 小明: 1, 小軒: 1, 小美: 1, 小華: 1, 小強: 0 } } }),
    ]);
    expect(b.小明).toEqual({ paid: 6000, owed: 1200 + 240 + 300 + 250, net: 4010 });
    expect(b.小強.net).toBe(1000 - 1440 - 300);
    expect(total(Object.fromEntries(m.map((id) => [id, b[id].net])))).toBe(0);
    expect(settle(Object.fromEntries(m.map((id) => [id, b[id].net]))).length).toBeLessThanOrEqual(4);
  });
});
