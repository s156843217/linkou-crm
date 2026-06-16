// ─────────────────────────────────────────────────────────────
// Supabase 連線設定範本
//
// 使用方式：
//   1. 把這個檔案複製一份，改名為  config.js
//   2. 到 Supabase 後台 → Project Settings → API 找到下面兩個值貼進去
//   3. config.js 已被 .gitignore 排除，不會進版控（安全）
//
// 這兩個值放在前端是安全的：
//   - URL 是公開的專案網址
//   - anon key 是「公開金鑰」，搭配資料表的 RLS 權限保護資料
//   （真正的祕密是 service_role key 與 Anthropic 金鑰，那些只放後端，絕不放這裡）
// ─────────────────────────────────────────────────────────────
window.CRM_CONFIG = {
  SUPABASE_URL: "https://你的專案代號.supabase.co",
  SUPABASE_ANON_KEY: "貼上 anon public key",
};
