# 分好帳

旅遊、聚餐分帳 App（PWA，網頁和手機都能用，也能在 LINE 裡直接打開）。用 LINE 帳號登入，用房間代碼或 LINE 邀請加入，資料透過 Supabase 即時同步。

## 設定

1. **Supabase**：建立專案，在 SQL Editor 執行 `supabase/schema.sql`。
2. **LINE Developers**：建立 LINE Login channel，記下 Channel ID；在同一個 channel 新增 LIFF app（Size 選 Full，Scope 勾 `openid`、`profile`），Endpoint URL 填 App 的網址，記下 LIFF ID。
3. **Edge Function**：部署 `supabase/functions/line-login`（Dashboard → Edge Functions，或 `supabase functions deploy line-login --no-verify-jwt`），並設定密鑰 `LINE_CHANNEL_ID`。關閉這個函式的「Verify JWT」。
4. **環境變數**：本機開發複製 `.env.example` 成 `.env` 填入；正式網站的公開設定在 `.env.production`。

## 開發

```bash
npm install
npm run dev     # 本機開發（LINE 登入需要 LIFF Endpoint 指向可連到的 https 網址）
npm test        # 分帳與結算演算法測試
npm run build   # 產生 dist/
```

推到 `main` 後，`.github/workflows/deploy.yml` 會自動測試並部署到 GitHub Pages。

## 結構

- `src/lib/split.ts`：分攤計算（平分／按金額／按比例）、表單檢查、淨額、最少轉帳結算
- `src/lib/split.test.ts`：演算法測試
- `src/lib/store.ts`：LINE 登入、Supabase 讀寫與即時同步
- `src/App.tsx`、`src/ExpenseForm.tsx`：介面
- `supabase/schema.sql`：資料表、只有房間成員能讀寫的權限、建立／查詢／加入房間的函式
- `supabase/functions/line-login`：驗證 LINE ID token 後發 Supabase 登入憑證

## 權限設計

- 只有房間成員能看到、修改該房間的資料。
- 主揪可以先建好朋友的名字（例如不用 App 的司機），朋友用 LINE 加入時認領自己的名字；已認領的名字別人不能再選、不能刪。
- 房間結算後，資料庫拒絕再新增、修改、刪除花費。
