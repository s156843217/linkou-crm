# 林口 CRM ・ 客戶維護系統

自用的房仲買方客戶管理系統（你跟太太兩人用）。純前端 + Supabase，零建置。

- 手機 / 電腦皆可用、兩人即時同步
- 客戶建檔（基本資料 + 買方需求 + 家庭背景）
- 互動紀錄、帶看紀錄（社區建檔 + 反應）
- 生日提醒、新案比對（評分排序）
- LINE 對話匯入 → AI（Claude Opus 4.8）自動建檔與屬性分析

> ⚠️ 含真實客戶個資。請保持此 repo 為 **private**，勿與公開網站混用。

---

## 一次性設定

### 1. 建 Supabase 專案
到 [supabase.com](https://supabase.com) 建免費專案，記下資料庫密碼。

### 2. 建立資料表
Supabase 後台 → **SQL Editor** → 貼上 `supabase/schema.sql` 全部 → Run。

### 3. 開兩個帳號（你 / 太太）
後台 → **Authentication → Users → Add user**，各建一個 Email + 密碼。
（建議在 Authentication → Providers 關閉開放註冊，只留你倆。）

### 4. 設定前端連線
複製 `config.example.js` 為 `config.js`，填入後台 **Project Settings → API** 的：
- `SUPABASE_URL`（Project URL）
- `SUPABASE_ANON_KEY`（anon public key）

`config.js` 已被 `.gitignore` 排除，不會進版控。

### 5. 部署 LINE 匯入的 Edge Function
需安裝 [Supabase CLI](https://supabase.com/docs/guides/cli)，然後：
```bash
supabase login
supabase link --project-ref <你的專案ref>
# 設定 Anthropic 金鑰（只存後端，瀏覽器看不到）
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
# 部署函式（兩個都要）
supabase functions deploy parse-line      # LINE 對話匯入
supabase functions deploy parse-listing   # 新案網址/文字解析
```
Anthropic 金鑰到 [console.anthropic.com](https://console.anthropic.com) 申請並儲值（US$5 很夠用）。

---

## 開啟方式
直接用瀏覽器開 `index.html` 即可（或丟到任何靜態主機 / 私人 Pages）。

## 檔案結構
```
linkou-crm/
├── index.html        介面外殼（登入 + App）
├── styles.css        設計系統（沿用學區站色票）
├── app.js            主程式（認證/列表/編輯/詳情/比對/匯入）
├── config.example.js 連線設定範本（複製成 config.js 填值）
└── supabase/
    ├── schema.sql               資料表 + 權限(RLS)
    └── functions/
        ├── parse-line/          LINE 對話解析（Claude Opus 4.8）
        └── parse-listing/       新案網址/文字解析（Claude Opus 4.8）
```

## 技術
純 HTML/CSS/原生 JS（無框架、零建置）・ Supabase（DB + Auth + Edge Functions）・ Claude Opus 4.8
