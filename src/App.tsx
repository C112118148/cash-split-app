import { useEffect, useState } from 'react';
import { ExpenseForm } from './ExpenseForm';
import { balances, computeShares, settle, type Expense } from './lib/split';
import {
  addExpense, addMember, createRoom, deleteExpense, findRoom, joinRoom, myRooms, removeMember,
  setSettlement, shareInvite, signIn, useRoom, type FoundRoom, type Profile, type Room, type RoomSummary,
} from './lib/store';

const money = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()} 元`;
const errorText = (e: unknown) => `出了點問題：${e instanceof Error ? e.message : String(e)}。請檢查網路後再試一次。`;

export default function App() {
  const [me, setMe] = useState<Profile | null>(null);
  const [loginError, setLoginError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    signIn().then(setMe).catch((e) => setLoginError(errorText(e)));
  }, []);

  if (!me) {
    return (
      <main className="page">
        <header className="brand"><h1>分好帳</h1></header>
        <p className={loginError ? 'error-text' : 'muted'}>{loginError || '正在用 LINE 登入…'}</p>
      </main>
    );
  }
  if (openId) return <RoomView roomId={openId} me={me} onBack={() => setOpenId(null)} />;
  return <Home me={me} onOpen={setOpenId} />;
}

function Home({ me, onOpen }: { me: Profile; onOpen: (id: string) => void }) {
  const [rooms, setRooms] = useState<RoomSummary[] | null>(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    myRooms(me.userId).then(setRooms).catch((e) => setMsg(errorText(e)));
  }, [me.userId]);

  return (
    <main className="page">
      <header className="brand">
        <h1>分好帳</h1>
        <p className="profile">
          {me.picture && <img src={me.picture} alt="" className="avatar" />}
          {me.name}，旅遊、聚餐先墊錢，回家一次結清。
        </p>
      </header>

      <section>
        <h2 className="label">我的房間</h2>
        {msg && <p className="error-text">{msg}</p>}
        <ul className="room-list">
          {rooms?.map((r) => (
            <li key={r.id} className="room-item">
              <button className="room-open" onClick={() => onOpen(r.id)}>
                <span className="room-name">
                  {r.name}
                  {r.settled && <span className="pill done">已結算</span>}
                </span>
                <span className="muted">代碼 {r.code}</span>
              </button>
            </li>
          ))}
          {rooms === null && !msg && <li className="empty">讀取中…</li>}
          {rooms?.length === 0 && <li className="empty">還沒有房間。建立一個新房間，或輸入朋友給你的房間代碼。</li>}
        </ul>
      </section>

      <JoinForm me={me} onJoin={onOpen} />
      <CreateForm me={me} onJoin={onOpen} />
    </main>
  );
}

function JoinForm({ me, onJoin }: { me: Profile; onJoin: (roomId: string) => void }) {
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get('code') ?? '');
  const [found, setFound] = useState<FoundRoom | null>(null);
  const [nickname, setNickname] = useState(me.name);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function lookup(ev?: React.FormEvent) {
    ev?.preventDefault();
    setBusy(true); setMsg('');
    try {
      const r = await findRoom(code);
      if (r) setFound(r); else setMsg('找不到這個代碼的房間，請確認有沒有打錯。');
    } catch (e) { setMsg(errorText(e)); }
    setBusy(false);
  }

  // 從邀請連結（?code=XXXXXX）打開時自動查詢
  useEffect(() => { if (code) lookup(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function join(claimId: string | null) {
    if (!found) return;
    const n = nickname.trim();
    if (!claimId && found.members.some((m) => m.name === n)) {
      setMsg(`房間裡已經有「${n}」，如果是你請直接點選，或換一個暱稱。`);
      return;
    }
    setBusy(true); setMsg('');
    try { onJoin(await joinRoom(found.code, claimId, claimId ? null : n)); }
    catch (e) { setMsg(errorText(e)); setBusy(false); }
  }

  const open = found?.members.filter((m) => !m.claimed) ?? [];

  return (
    <section>
      <h2 className="label">用代碼加入</h2>
      {found ? (
        <div className="card stack">
          <p className="join-title">加入「{found.name}」</p>
          {open.length > 0 && (
            <>
              <p className="muted">主揪先幫你建好名字了嗎？點選你自己：</p>
              <div className="chips">
                {open.map((m) => (
                  <button key={m.id} className="chip" disabled={busy} onClick={() => join(m.id)}>{m.name}</button>
                ))}
              </div>
            </>
          )}
          <form className="add-row" onSubmit={(ev) => { ev.preventDefault(); join(null); }}>
            <input id="join-nickname" value={nickname} onChange={(e) => setNickname(e.target.value)} aria-label="你的暱稱" />
            <button className="primary" disabled={!nickname.trim() || busy}>用這個暱稱加入</button>
          </form>
          {msg && <p className="error-text">{msg}</p>}
          <button className="ghost back" onClick={() => setFound(null)}>‹ 換一個代碼</button>
        </div>
      ) : (
        <form className="card stack" onSubmit={lookup}>
          <div className="add-row">
            <input id="join-code" className="code-input" value={code} maxLength={6} autoCapitalize="characters"
              onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="6 碼房間代碼" aria-label="房間代碼" />
            <button className="primary" disabled={code.trim().length !== 6 || busy}>查詢</button>
          </div>
          {msg && <p className="error-text">{msg}</p>}
        </form>
      )}
    </section>
  );
}

function CreateForm({ me, onJoin }: { me: Profile; onJoin: (roomId: string) => void }) {
  const [name, setName] = useState('');
  const [myName, setMyName] = useState(me.name);
  const [memberText, setMemberText] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const others = [...new Set(memberText.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean))];
  const ok = name.trim() && myName.trim();

  async function create(ev: React.FormEvent) {
    ev.preventDefault();
    if (!ok) return;
    setBusy(true); setMsg('');
    try { onJoin(await createRoom(name.trim(), myName.trim(), others)); }
    catch (e) { setMsg(errorText(e)); setBusy(false); }
  }

  return (
    <section>
      <h2 className="label">建立新房間</h2>
      <form className="card stack" onSubmit={create}>
        <label className="field">
          <span>房間名稱</span>
          <input id="room-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：墾丁三天兩夜" />
        </label>
        <label className="field">
          <span>你在這個房間的暱稱</span>
          <input id="room-me" value={myName} onChange={(e) => setMyName(e.target.value)} />
        </label>
        <label className="field">
          <span>其他成員（選填，用逗號或空白分開；朋友之後用 LINE 加入時可以認領自己的名字）</span>
          <input id="room-members" value={memberText} onChange={(e) => setMemberText(e.target.value)} placeholder="小美, 阿華, 司機" />
        </label>
        {msg && <p className="error-text">{msg}</p>}
        <button className="primary" disabled={!ok || busy}>建立房間</button>
      </form>
    </section>
  );
}

type Tab = 'expenses' | 'ledger' | 'settle';

function RoomView({ roomId, me, onBack }: { roomId: string; me: Profile; onBack: () => void }) {
  const { room, error, reload } = useRoom(roomId);
  const [tab, setTab] = useState<Tab>('expenses');
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState('');
  const [shared, setShared] = useState('');

  // 寫入後立即重讀，不必等即時推播
  async function run(action: () => Promise<unknown>) {
    setMsg('');
    try { await action(); await reload(); return true; }
    catch (e) { setMsg(errorText(e)); return false; }
  }

  if (!room) {
    return (
      <main className="page">
        <button className="ghost back" onClick={onBack}>‹ 房間列表</button>
        <p className="muted">{error ? errorText(error) : '讀取中…'}</p>
      </main>
    );
  }

  const locked = room.settlement !== null;
  const meId = room.members.find((m) => m.userId === me.userId)?.id ?? '';
  const nameOf = (id: string) => room.members.find((m) => m.id === id)?.name ?? '?';

  async function invite() {
    try { setShared((await shareInvite(room!)) === 'shared' ? '已傳送邀請' : '已複製邀請連結'); }
    catch { setMsg(`無法分享，請把房間代碼 ${room!.code} 告訴朋友。`); }
  }

  return (
    <main className="page">
      <header className="room-head">
        <button className="ghost back" onClick={onBack}>‹ 房間列表</button>
        <h1>{room.name}</h1>
        <p className="muted">
          房間代碼 <code className="code">{room.code}</code>
          <button className="ghost small-btn" onClick={invite}>{shared || '用 LINE 邀請朋友'}</button>
          {locked && <span className="pill done">已結算，不能再新增花費</span>}
        </p>
        <Members room={room} locked={locked} meId={meId} run={run} />
      </header>
      {msg && <p className="error-text">{msg}</p>}

      <nav className="tabs" role="tablist">
        {([['expenses', '花費'], ['ledger', '帳本'], ['settle', '結算']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === 'expenses' && (
        adding && !locked ? (
          <ExpenseForm
            members={room.members}
            defaultPayer={meId}
            onCancel={() => setAdding(false)}
            onSave={async (e) => { if (await run(() => addExpense(room.id, e))) setAdding(false); }}
          />
        ) : (
          <ExpenseList room={room} locked={locked} nameOf={nameOf} onAdd={() => setAdding(true)}
            onDelete={(id) => run(() => deleteExpense(id))} />
        )
      )}
      {tab === 'ledger' && <Ledger room={room} nameOf={nameOf} meId={meId} />}
      {tab === 'settle' && <Settle room={room} nameOf={nameOf} onSettle={(s) => run(() => setSettlement(room.id, s))} />}
    </main>
  );
}

function Members({ room, locked, meId, run }: {
  room: Room; locked: boolean; meId: string; run: (a: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const used = new Set(room.expenses.flatMap((e) => [
    ...Object.keys(e.payers), ...Object.keys(computeShares(e.amount, e.split, e.payers)),
  ]));

  async function add(ev: React.FormEvent) {
    ev.preventDefault();
    const n = name.trim();
    if (!n || room.members.some((m) => m.name === n)) return;
    if (await run(() => addMember(room.id, n))) setName('');
  }

  return (
    <div className="members">
      {room.members.map((m) => (
        <span key={m.id} className={`member ${m.id === meId ? 'me' : ''}`}>
          {m.name}{m.id === meId && '（我）'}
          {!locked && !used.has(m.id) && !m.userId && (
            <button className="x" aria-label={`移除 ${m.name}`} onClick={() => run(() => removeMember(m.id))}>×</button>
          )}
        </span>
      ))}
      {!locked && (
        <form onSubmit={add} className="add-member">
          <input id="add-member" value={name} onChange={(e) => setName(e.target.value)} placeholder="新增成員" aria-label="新增成員暱稱" />
          <button className="ghost" disabled={!name.trim()}>加入</button>
        </form>
      )}
    </div>
  );
}

const MODE_LABEL = { equal: '平分', amount: '按金額', ratio: '按比例' } as const;

function ExpenseList({ room, locked, nameOf, onAdd, onDelete }: {
  room: Room; locked: boolean; nameOf: (id: string) => string; onAdd: () => void; onDelete: (id: string) => void;
}) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const list = [...room.expenses].sort((a, b) => b.createdAt - a.createdAt);
  const total = room.expenses.reduce((a, e) => a + e.amount, 0);

  return (
    <section className="stack">
      <div className="summary">
        <span className="muted">總花費</span>
        <strong className="big money">{money(total)}</strong>
        {!locked && <button className="primary" onClick={onAdd}>＋ 新增花費</button>}
      </div>
      <ul className="expense-list">
        {list.map((e) => (
          <li key={e.id} className="expense">
            <div className="expense-main">
              <span className="expense-title">{e.title}</span>
              <span className="muted">
                {Object.entries(e.payers).map(([id, v]) => `${nameOf(id)} 付 ${v.toLocaleString()}`).join('、')} · {MODE_LABEL[e.split.mode]}
              </span>
            </div>
            <span className="money">{money(e.amount)}</span>
            {!locked && (confirmId === e.id ? (
              <span className="confirm">
                <button className="danger" onClick={() => onDelete(e.id)}>刪除</button>
                <button className="ghost" onClick={() => setConfirmId(null)}>取消</button>
              </span>
            ) : (
              <button className="ghost icon" aria-label={`刪除 ${e.title}`} onClick={() => setConfirmId(e.id)}>×</button>
            ))}
          </li>
        ))}
        {list.length === 0 && <li className="empty">還沒有花費，按「新增花費」記下第一筆。</li>}
      </ul>
    </section>
  );
}

function Ledger({ room, nameOf, meId }: { room: Room; nameOf: (id: string) => string; meId: string }) {
  const [me, setMe] = useState(meId);
  const b = balances(room.members.map((m) => m.id), room.expenses);
  const mine = b[me];
  const related: { e: Expense; paid: number; owed: number }[] = room.expenses
    .map((e) => ({ e, paid: e.payers[me] ?? 0, owed: computeShares(e.amount, e.split, e.payers)[me] ?? 0 }))
    .filter((x) => x.paid || x.owed);

  return (
    <section className="stack">
      <label className="field">
        <span>我是</span>
        <select id="ledger-me" value={me} onChange={(e) => setMe(e.target.value)}>
          {room.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>

      {mine && (
        <div className="card ledger-card">
          <div><span className="muted">我付了</span><strong className="money">{money(mine.paid)}</strong></div>
          <div><span className="muted">我應該付</span><strong className="money">{money(mine.owed)}</strong></div>
          <div className={mine.net > 0 ? 'pos' : mine.net < 0 ? 'neg' : ''}>
            <span className="muted">{mine.net > 0 ? '別人要給我' : mine.net < 0 ? '我還要給別人' : '剛好打平'}</span>
            <strong className="money">{money(Math.abs(mine.net))}</strong>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead><tr><th>品名</th><th className="num">我付</th><th className="num">我分攤</th></tr></thead>
          <tbody>
            {related.map(({ e, paid, owed }) => (
              <tr key={e.id}><td>{e.title}</td><td className="num">{paid ? paid.toLocaleString() : '—'}</td><td className="num">{owed ? owed.toLocaleString() : '—'}</td></tr>
            ))}
            {related.length === 0 && <tr><td colSpan={3} className="muted">{nameOf(me)} 還沒有相關的花費。</td></tr>}
          </tbody>
        </table>
      </div>

      <h2 className="label">全員淨額</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>成員</th><th className="num">已付</th><th className="num">應付</th><th className="num">淨額</th></tr></thead>
          <tbody>
            {room.members.map((m) => (
              <tr key={m.id}>
                <td>{m.name}</td>
                <td className="num">{b[m.id].paid.toLocaleString()}</td>
                <td className="num">{b[m.id].owed.toLocaleString()}</td>
                <td className={`num ${b[m.id].net > 0 ? 'pos' : b[m.id].net < 0 ? 'neg' : ''}`}>
                  {b[m.id].net > 0 ? '+' : ''}{money(b[m.id].net)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Settle({ room, nameOf, onSettle }: {
  room: Room; nameOf: (id: string) => string; onSettle: (s: Room['settlement']) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const b = balances(room.members.map((m) => m.id), room.expenses);
  const preview = settle(Object.fromEntries(Object.entries(b).map(([id, x]) => [id, x.net])));
  const s = room.settlement;
  const transfers = s?.transfers ?? preview;
  const left = s ? s.transfers.filter((_, i) => !s.received[i]).length : transfers.length;

  return (
    <section className="stack">
      <p className="muted">
        {s
          ? left === 0 ? '所有款項都收到了，這趟結清！' : `還有 ${left} 筆款項沒收到。收款人收到錢後請按「已收到」。`
          : `目前最少只要 ${preview.length} 筆轉帳就能結清。按下結算後房間會鎖定，不能再新增花費。`}
      </p>

      <ul className="transfers">
        {transfers.map((t, i) => {
          const got = s?.received[i] ?? false;
          return (
            <li key={i} className={`transfer ${got ? 'got' : ''}`}>
              <span className="who">{nameOf(t.from)}</span>
              <span className="arrow" aria-hidden="true"><span className="money">{t.amount.toLocaleString()}</span></span>
              <span className="who">{nameOf(t.to)}</span>
              {s && (
                <button className={got ? 'ghost' : 'primary small-btn'}
                  onClick={() => onSettle({ ...s, received: s.received.map((v, j) => (j === i ? !v : v)) })}>
                  {got ? '已收到 ✓' : '已收到'}
                </button>
              )}
            </li>
          );
        })}
        {transfers.length === 0 && <li className="empty">大家都打平了，不需要轉帳。</li>}
      </ul>

      {!s && (confirming ? (
        <div className="confirm-box">
          <span>確定要結算並鎖定「{room.name}」嗎？</span>
          <div className="actions">
            <button className="ghost" onClick={() => setConfirming(false)}>再想想</button>
            <button className="primary" onClick={() => onSettle({ transfers: preview, received: preview.map(() => false) })}>確定結算</button>
          </div>
        </div>
      ) : (
        <button className="primary" disabled={room.expenses.length === 0} onClick={() => setConfirming(true)}>結算</button>
      ))}
    </section>
  );
}
