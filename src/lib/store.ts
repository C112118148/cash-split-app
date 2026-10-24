import liff from '@line/liff';
import { createClient } from '@supabase/supabase-js';
import { useCallback, useEffect, useState } from 'react';
import type { Expense, Transfer } from './split';

export interface Member { id: string; name: string; userId: string | null }

export interface Room {
  id: string;
  name: string;
  code: string;
  members: Member[];
  expenses: Expense[];
  settlement: { transfers: Transfer[]; received: boolean[] } | null;
}

export interface RoomSummary { id: string; name: string; code: string; settled: boolean }
export interface Profile { userId: string; name: string; picture: string }

const db = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);
const LIFF_ID = import.meta.env.VITE_LIFF_ID;

function check<T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> {
  if (error) throw new Error(error.message);
  return data as NonNullable<T>;
}

// ---- LINE 登入 ----

/** 初始化 LIFF 並登入 Supabase。尚未登入 LINE 時會跳到 LINE 登入頁，回來後再執行一次。 */
export async function signIn(): Promise<Profile | null> {
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return null;
  }
  const lineSub = liff.getDecodedIDToken()?.sub;
  let { data: { session } } = await db.auth.getSession();

  if (!session || session.user.user_metadata.line_sub !== lineSub) {
    const { data, error } = await db.functions.invoke('line-login', { body: { idToken: liff.getIDToken() } });
    if (error) {
      // ID token 過期時重新登入 LINE 一次；再失敗就顯示錯誤，避免無限重複登入
      if (!sessionStorage.getItem('relogin')) {
        sessionStorage.setItem('relogin', '1');
        liff.logout();
        liff.login({ redirectUri: location.href });
        return null;
      }
      sessionStorage.removeItem('relogin');
      const detail = await error.context?.json?.().catch(() => null);
      throw new Error(`登入失敗：${detail?.error ?? error.message}`);
    }
    sessionStorage.removeItem('relogin');
    session = check(await db.auth.verifyOtp({ token_hash: data.tokenHash, type: 'magiclink' })).session;
  }
  const meta = session!.user.user_metadata;
  return { userId: session!.user.id, name: meta.name, picture: meta.picture };
}

/** 邀請朋友：在 LINE 裡直接選群組傳送，否則複製連結。回傳 'shared' | 'copied'。 */
export async function shareInvite(room: { name: string; code: string }) {
  const url = `https://liff.line.me/${LIFF_ID}?code=${room.code}`;
  const text = `一起來記帳「${room.name}」，點連結加入（代碼 ${room.code}）：${url}`;
  if (liff.isApiAvailable('shareTargetPicker')) {
    const res = await liff.shareTargetPicker([{ type: 'text', text }]);
    if (res) return 'shared';
  }
  await navigator.clipboard.writeText(text);
  return 'copied';
}

export async function myRooms(userId: string): Promise<RoomSummary[]> {
  const rows = check(await db.from('members').select('rooms(id, name, code, settlement, created_at)').eq('user_id', userId));
  return rows
    .map((r) => r.rooms as unknown as { id: string; name: string; code: string; settlement: unknown; created_at: string })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((r) => ({ id: r.id, name: r.name, code: r.code, settled: r.settlement !== null }));
}

// ---- 讀取與即時同步 ----

export function useRoom(roomId: string) {
  const [room, setRoom] = useState<Room | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [r, members, expenses] = await Promise.all([
        db.from('rooms').select('*').eq('id', roomId).single().then(check),
        db.from('members').select('id, name, userId:user_id').eq('room_id', roomId).order('created_at').then(check),
        db.from('expenses').select('*').eq('room_id', roomId).order('created_at').then(check),
      ]);
      setRoom({
        id: r.id, name: r.name, code: r.code, settlement: r.settlement, members,
        expenses: expenses.map((e) => ({ ...e, createdAt: Date.parse(e.created_at) })),
      });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [roomId]);

  useEffect(() => {
    reload();
    // 房間內任何人改了資料，就重新讀一次整個房間
    const channel = db
      .channel(`room-${roomId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: `room_id=eq.${roomId}` }, reload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `room_id=eq.${roomId}` }, reload)
      .subscribe();
    return () => { db.removeChannel(channel); };
  }, [roomId, reload]);

  return { room, error, reload };
}

// ---- 寫入 ----

export async function createRoom(name: string, myName: string, others: string[]): Promise<string> {
  return check(await db.rpc('create_room', { room_name: name, my_name: myName, other_names: others }));
}

export interface FoundRoom { id: string; name: string; code: string; members: { id: string; name: string; claimed: boolean }[] }

export async function findRoom(code: string): Promise<FoundRoom | null> {
  const { data, error } = await db.rpc('find_room', { room_code: code });
  if (error) throw new Error(error.message);
  return data;
}

/** 認領一位成員（claimId），或用新暱稱加入（newName）。回傳房間 ID。 */
export async function joinRoom(code: string, claimId: string | null, newName: string | null): Promise<string> {
  return check(await db.rpc('join_room', { room_code: code, claim_member: claimId, new_name: newName }));
}

export async function addMember(roomId: string, name: string) {
  check(await db.from('members').insert({ room_id: roomId, name }));
}

export async function removeMember(id: string) {
  check(await db.from('members').delete().eq('id', id));
}

export async function addExpense(roomId: string, e: Omit<Expense, 'id' | 'createdAt'>) {
  check(await db.from('expenses').insert({ room_id: roomId, title: e.title, amount: e.amount, payers: e.payers, split: e.split }));
}

export async function updateExpense(id: string, e: Omit<Expense, 'id' | 'createdAt'>) {
  check(await db.from('expenses').update({ title: e.title, amount: e.amount, payers: e.payers, split: e.split }).eq('id', id));
}

export async function deleteExpense(id: string) {
  check(await db.from('expenses').delete().eq('id', id));
}

export async function setSettlement(roomId: string, settlement: Room['settlement']) {
  check(await db.from('rooms').update({ settlement }).eq('id', roomId));
}
