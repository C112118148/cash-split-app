import { useState } from 'react';
import { computeShares, validateExpense, type Expense, type Split } from './lib/split';
import type { Member } from './lib/store';

type Mode = Split['mode'];
const MODES: { mode: Mode; label: string }[] = [
  { mode: 'equal', label: '平分' },
  { mode: 'amount', label: '按金額' },
  { mode: 'ratio', label: '按比例' },
];

const toInt = (s: string) => (s.trim() === '' ? 0 : Number(s));

const toTexts = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]));

/** initial 有值時是編輯既有花費，表單預先填好它的內容。 */
export function ExpenseForm({ members, defaultPayer, initial, onSave, onCancel }: {
  members: Member[];
  defaultPayer: string;
  initial?: Expense;
  onSave: (e: Omit<Expense, 'id' | 'createdAt'>) => void;
  onCancel: () => void;
}) {
  const s0 = initial?.split;
  const payerIds = Object.keys(initial?.payers ?? {});
  const singlePayer = initial && payerIds.length === 1 && initial.payers[payerIds[0]] === initial.amount ? payerIds[0] : null;
  const [title, setTitle] = useState(initial?.title ?? '');
  const [amountText, setAmountText] = useState(initial ? String(initial.amount) : '');
  const [multiPay, setMultiPay] = useState(!!initial && !singlePayer);
  const [payer, setPayer] = useState(singlePayer ?? defaultPayer);
  const [payAmounts, setPayAmounts] = useState<Record<string, string>>(initial && !singlePayer ? toTexts(initial.payers) : {});
  const [mode, setMode] = useState<Mode>(s0?.mode ?? 'equal');
  const [included, setIncluded] = useState<string[]>(s0?.mode === 'equal' ? s0.members : members.map((m) => m.id));
  const [splitAmounts, setSplitAmounts] = useState<Record<string, string>>(s0?.mode === 'amount' ? toTexts(s0.amounts) : {});
  const [weights, setWeights] = useState<Record<string, string>>(
    s0?.mode === 'ratio' ? toTexts(s0.weights) : Object.fromEntries(members.map((m) => [m.id, '1'])),
  );

  const amount = toInt(amountText);
  const payers: Record<string, number> = multiPay
    ? Object.fromEntries(members.map((m) => [m.id, toInt(payAmounts[m.id] ?? '')]).filter(([, v]) => v !== 0))
    : { [payer]: amount };
  const split: Split =
    mode === 'equal'
      ? { mode, members: included }
      : mode === 'amount'
        ? { mode, amounts: Object.fromEntries(members.map((m) => [m.id, toInt(splitAmounts[m.id] ?? '')]).filter(([, v]) => v !== 0)) }
        : { mode, weights: Object.fromEntries(members.map((m) => [m.id, toInt(weights[m.id] ?? '')])) };

  const draft = { title, amount, payers, split };
  const errors = validateExpense(draft);
  const shares = amount > 0 ? computeShares(amount, split, payers) : {};
  const touched = !!initial || title !== '' || amountText !== '';

  function submit(ev: React.FormEvent) {
    ev.preventDefault();
    if (errors.length) return;
    onSave(draft);
  }

  return (
    <form className="sheet" onSubmit={submit}>
      <h2>{initial ? '編輯花費' : '新增花費'}</h2>

      <div className="row2">
        <label className="field">
          <span>品名</span>
          <input id="exp-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：午餐 牛肉湯" autoFocus={!initial} />
        </label>
        <label className="field">
          <span>總金額（元）</span>
          <input id="exp-amount" inputMode="numeric" value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/\D/g, ''))} placeholder="0" />
        </label>
      </div>

      <fieldset>
        <legend>
          誰先付
          <label className="inline-toggle">
            <input id="exp-multipay" type="checkbox" checked={multiPay} onChange={(e) => setMultiPay(e.target.checked)} />
            多人湊錢
          </label>
        </legend>
        {multiPay ? (
          <div className="amount-grid">
            {members.map((m) => (
              <label key={m.id} className="amount-cell">
                <span>{m.name}</span>
                <input id={`pay-${m.id}`} inputMode="numeric" value={payAmounts[m.id] ?? ''} placeholder="0"
                  onChange={(e) => setPayAmounts({ ...payAmounts, [m.id]: e.target.value.replace(/\D/g, '') })} />
              </label>
            ))}
          </div>
        ) : (
          <div className="chips">
            {members.map((m) => (
              <button type="button" key={m.id} className={`chip ${payer === m.id ? 'on' : ''}`} onClick={() => setPayer(m.id)}>
                {m.name}
              </button>
            ))}
          </div>
        )}
      </fieldset>

      <fieldset>
        <legend>分給誰</legend>
        <div className="segmented" role="tablist">
          {MODES.map((x) => (
            <button type="button" role="tab" aria-selected={mode === x.mode} key={x.mode}
              className={mode === x.mode ? 'on' : ''} onClick={() => setMode(x.mode)}>
              {x.label}
            </button>
          ))}
        </div>

        <div className="split-list">
          {members.map((m) => (
            <div key={m.id} className="split-row">
              {mode === 'equal' ? (
                <label className="check">
                  <input id={`inc-${m.id}`} type="checkbox" checked={included.includes(m.id)}
                    onChange={(e) => setIncluded(e.target.checked ? [...included, m.id] : included.filter((id) => id !== m.id))} />
                  {m.name}
                </label>
              ) : (
                <label className="check">
                  <span>{m.name}</span>
                  <input id={`split-${m.id}`} className="small" inputMode="numeric"
                    value={mode === 'amount' ? splitAmounts[m.id] ?? '' : weights[m.id] ?? ''}
                    placeholder="0"
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '');
                      if (mode === 'amount') setSplitAmounts({ ...splitAmounts, [m.id]: v });
                      else setWeights({ ...weights, [m.id]: v });
                    }} />
                  {mode === 'ratio' && <span className="muted">份</span>}
                </label>
              )}
              <span className="money">{shares[m.id] ? `${shares[m.id].toLocaleString()} 元` : '—'}</span>
            </div>
          ))}
        </div>
      </fieldset>

      {touched && errors.length > 0 && (
        <ul className="errors">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}

      <div className="actions">
        <button type="button" className="ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="primary" disabled={errors.length > 0}>儲存花費</button>
      </div>
    </form>
  );
}
