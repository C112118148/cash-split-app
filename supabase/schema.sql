-- 分好帳：在 Supabase 的 SQL Editor 貼上整段後按 Run。
-- 登入方式是 LINE（見 supabase/functions/line-login），只有房間成員能讀寫該房間。

create table rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  name text not null,
  settlement jsonb,               -- 結算後的轉帳清單與收款標記，null = 進行中
  created_at timestamptz not null default now()
);

create table members (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  name text not null,
  user_id uuid references auth.users(id) on delete set null,  -- null = 還沒有人用 LINE 認領（例如不用 App 的司機）
  created_at timestamptz not null default now(),
  unique (room_id, name),
  unique (room_id, user_id)
);

create table expenses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references rooms(id) on delete cascade,
  title text not null,
  amount integer not null check (amount > 0),
  payers jsonb not null,          -- {成員ID: 已付金額}
  split jsonb not null,           -- {mode: equal|amount|ratio, ...}
  created_at timestamptz not null default now()
);

-- ---- 權限：只有房間成員能讀寫 ----

create function is_member(room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where room_id = room and user_id = auth.uid());
$$;

alter table rooms enable row level security;
alter table members enable row level security;
alter table expenses enable row level security;
create policy "read" on rooms for select to authenticated using (is_member(id));
create policy "update" on rooms for update to authenticated using (is_member(id));
create policy "members only" on members for select to authenticated using (is_member(room_id));
-- 只能新增、移除還沒人認領的成員；認領只能透過 join_room，避免冒充別人
create policy "add placeholder" on members for insert to authenticated with check (is_member(room_id) and user_id is null);
create policy "remove placeholder" on members for delete to authenticated using (is_member(room_id) and user_id is null);
create policy "members only" on expenses for all to authenticated using (is_member(room_id)) with check (is_member(room_id));

-- ---- 建立與加入房間（還不是成員時也要能做，所以用 security definer 函式） ----

create function create_room(room_name text, my_name text, other_names text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  n text;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  loop
    begin
      -- 6 碼代碼，去掉易混淆的 0/O、1/I
      insert into rooms (name, code)
      values (room_name, (select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
                          from generate_series(1, 6)))
      returning id into rid;
      exit;
    exception when unique_violation then
      -- 代碼撞到就重抽
    end;
  end loop;
  insert into members (room_id, name, user_id) values (rid, my_name, auth.uid());
  foreach n in array other_names loop
    if n <> my_name then insert into members (room_id, name) values (rid, n) on conflict do nothing; end if;
  end loop;
  return rid;
end $$;

-- 用代碼查房間：只回傳名稱和成員（含是否已被認領），不含花費
create function find_room(room_code text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'id', r.id, 'name', r.name, 'code', r.code,
    'members', coalesce((select json_agg(json_build_object('id', m.id, 'name', m.name, 'claimed', m.user_id is not null) order by m.created_at)
                         from members m where m.room_id = r.id), '[]'::json))
  from rooms r where r.code = upper(trim(room_code)) and auth.uid() is not null;
$$;

-- 加入房間：認領一位還沒人認領的成員，或用新暱稱加入；已經是成員就直接回傳
create function join_room(room_code text, claim_member uuid, new_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  select id into rid from rooms where code = upper(trim(room_code));
  if rid is null then raise exception '找不到這個代碼的房間'; end if;
  if is_member(rid) then return rid; end if;
  if claim_member is not null then
    update members set user_id = auth.uid() where id = claim_member and room_id = rid and user_id is null;
    if not found then raise exception '這位成員已經被別人認領了'; end if;
  else
    insert into members (room_id, name, user_id) values (rid, new_name, auth.uid());
  end if;
  return rid;
end $$;

revoke execute on function create_room, find_room, join_room, is_member from public, anon;
grant execute on function create_room, find_room, join_room, is_member to authenticated;

-- ---- 即時同步 ----

alter publication supabase_realtime add table rooms, members, expenses;
-- 讓刪除事件也能依房間過濾，別的裝置刪掉花費時才會同步
alter table expenses replica identity full;
alter table members replica identity full;

-- ---- 結算後，資料庫拒絕新增、修改或刪除花費（不只擋在畫面上） ----

create function reject_if_settled() returns trigger language plpgsql as $$
begin
  if exists (select 1 from rooms where id = coalesce(new.room_id, old.room_id) and settlement is not null) then
    raise exception '這個房間已經結算，不能再修改花費';
  end if;
  return coalesce(new, old);
end $$;
create trigger expenses_locked before insert or update or delete on expenses
  for each row execute function reject_if_settled();
