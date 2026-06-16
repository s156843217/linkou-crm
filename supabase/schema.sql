-- ═══════════════════════════════════════════════════════════════
-- 林口 CRM 客戶維護系統 — 資料表結構
--
-- 用法：到 Supabase 後台 → SQL Editor → 貼上整份 → Run
-- 只有你跟太太兩個登入帳號能讀寫（靠最底部的 RLS 權限）
--
-- 設計原則：買方需求欄位「直接放在 customers 表」，
-- 這樣「新案比對」就是單表查詢，最單純、最快。
-- ═══════════════════════════════════════════════════════════════

-- ── 1. 使用者顯示名稱（你 / 太太）─────────────────────────────
-- Supabase Auth 已管理登入帳號(auth.users)，這張表只補「顯示名稱」
-- 用來標示客戶的負責人 / 建立者
create table if not exists profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at  timestamptz not null default now()
);

-- 新帳號註冊時，自動建立一筆 profile
-- 注意：security definer + set search_path = public + 完整表名 public.profiles
-- 三者缺一，建立使用者時可能因 search_path 受限而找不到 profiles 表，
-- 導致 Supabase 報「Database error creating new user」。
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ── 2. 客戶主表（含買方需求 + 家庭背景）──────────────────────
create table if not exists customers (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id),
  owner_id      uuid references auth.users(id),   -- 負責人(你/太太)
  last_contact  date,                              -- 最後聯絡日

  -- 基本資料
  name          text not null,
  nickname      text,
  phone         text,
  line_id       text,
  source        text,                              -- 來源：網路/轉介/洗街…
  birthday      date,
  grade         text default 'B',                  -- 分級 A熱 / B溫 / C冷
  status        text default '進行中',             -- 進行中 / 已成交 / 已流失
  intent        text default '買',                 -- 買 / 租

  -- 買方需求（比對用）
  budget_min    int,                               -- 總價下限(萬元)
  budget_max    int,                               -- 總價上限(萬元)
  areas         text[] default '{}',               -- 區域/路段
  communities   text[] default '{}',               -- 偏好社區
  room_min      int,                               -- 房數下限
  room_max      int,                               -- 房數上限
  ping_min      numeric,                           -- 坪數下限
  ping_max      numeric,                           -- 坪數上限
  floor_pref    text,                              -- 樓層偏好
  need_parking  boolean default false,             -- 需車位
  school_need   text,                              -- 學區需求
  age_max       int,                               -- 屋齡上限(年)
  orientation   text,                              -- 朝向
  purpose       text,                              -- 自住 / 投資
  urgency       text,                              -- 急迫度

  -- 家庭 / 背景
  family_members text,                             -- 家庭成員
  kids          text,                              -- 小孩年齡
  occupation    text,                              -- 職業
  interests     text,                              -- 興趣/嗜好
  pets          text,
  note          text                               -- 綜合備註 / AI 屬性分析
);

create index if not exists idx_customers_status   on customers(status);
create index if not exists idx_customers_grade     on customers(grade);
create index if not exists idx_customers_birthday  on customers(birthday);

-- ── 3. 互動紀錄（一個客戶多筆）────────────────────────────────
create table if not exists interactions (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  happened_on date not null default current_date,
  channel     text default 'LINE',                 -- LINE/電話/面談/其他
  summary     text not null
);
create index if not exists idx_interactions_customer on interactions(customer_id);

-- ── 4. 帶看紀錄（一個客戶多筆）────────────────────────────────
create table if not exists viewings (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  viewed_on   date not null default current_date,
  community   text,                                -- 社區/物件名稱
  address     text,
  reaction    text,                                -- 喜歡 / 普通 / 不喜歡
  pros        text,                                -- 客戶說的優點
  cons        text,                                -- 客戶說的缺點
  note        text
);
create index if not exists idx_viewings_customer on viewings(customer_id);

-- ── 5. updated_at 自動更新 ────────────────────────────────────
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists trg_customers_touch on customers;
create trigger trg_customers_touch
  before update on customers
  for each row execute function touch_updated_at();

-- ═══════════════════════════════════════════════════════════════
-- 6. RLS 權限：只有「已登入」的帳號(你跟太太)能存取
--    因為這個系統只開兩個帳號，兩人都完全信任，
--    所以政策是：任何已登入帳號可讀寫全部資料。
-- ═══════════════════════════════════════════════════════════════
alter table profiles     enable row level security;
alter table customers    enable row level security;
alter table interactions enable row level security;
alter table viewings     enable row level security;

-- profiles：登入者可看全部、只能改/建自己那筆
drop policy if exists p_profiles_read   on profiles;
drop policy if exists p_profiles_write  on profiles;
drop policy if exists p_profiles_insert on profiles;
create policy p_profiles_read   on profiles for select to authenticated using (true);
create policy p_profiles_write  on profiles for update to authenticated using (auth.uid() = id);
create policy p_profiles_insert on profiles for insert to authenticated with check (auth.uid() = id);

-- customers / interactions / viewings：登入者可完全存取
drop policy if exists p_customers_all    on customers;
drop policy if exists p_interactions_all on interactions;
drop policy if exists p_viewings_all     on viewings;
create policy p_customers_all    on customers    for all to authenticated using (true) with check (true);
create policy p_interactions_all on interactions for all to authenticated using (true) with check (true);
create policy p_viewings_all     on viewings     for all to authenticated using (true) with check (true);
