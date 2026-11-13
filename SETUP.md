# 設定「用 Threads 登入」功能

整個設定大約 15 分鐘，**只需要做一次**，全部免費。

架構：

```
抽獎網頁 (GitHub Pages)  ──登入/抓留言──▶  小後端 (Cloudflare Worker)  ──▶  Threads 官方 API
```

後端的作用是保管 Threads App 密鑰。這組密鑰不能放在公開網頁上，所以需要後端。

---

## 步驟 A：建立 Cloudflare Worker（先拿到後端網址）

1. 到 https://dash.cloudflare.com 註冊並登入
2. 左側選單選 **Workers & Pages**，按 **Create**，再選 **Create Worker**（Hello World 範本）
3. 名稱填 `oshenwave`，按 **Deploy**
4. 記下網址，例如 `https://oshenwave.你的名稱.workers.dev`，後面會用到
5. 按 **Edit code**，把 [`worker/worker.js`](worker/worker.js) 的全部內容貼上，取代原本的程式碼，按 **Deploy**

## 步驟 B：建立 Threads 應用程式

1. 到 https://developers.facebook.com 登入，在 **我的應用程式** 按 **建立應用程式**
2. 使用案例選 **「存取 Threads API」**（Access the Threads API），然後完成建立
3. 進入應用程式的 **使用案例 → 自訂（Customize）**：
   - **權限**：確認有 `threads_basic`，並**新增 `threads_read_replies`**
   - **設定**：以下三個欄位都填入步驟 A 的網址：
     - 重新導向回呼網址（Redirect Callback URLs）：`https://oshenwave.你的名稱.workers.dev/callback`
     - 解除安裝回呼網址：`https://oshenwave.你的名稱.workers.dev/`
     - 刪除回呼網址：`https://oshenwave.你的名稱.workers.dev/`
4. **應用程式角色 → 角色 → 新增人員**，選 **Threads 測試人員**，輸入你的 Threads 帳號
5. 打開 Threads，到 **設定 → 帳號 → 網站權限 → 邀請**，**接受**這個邀請
6. 到 **應用程式設定 → 基本資料**，複製 **Threads 應用程式編號** 和 **Threads 應用程式密鑰**

> 應用程式在「開發模式」下，只有加入成測試人員的帳號可以登入。這剛好符合需求，因為你只需要抓自己貼文的留言。

## 步驟 C：把密鑰填進 Cloudflare

回到 Cloudflare 的 Worker，打開 **Settings → Variables and Secrets**，新增以下三個變數：

| 名稱 | 類型 | 值 |
|---|---|---|
| `THREADS_APP_ID` | Text | Threads 應用程式編號 |
| `THREADS_APP_SECRET` | **Secret** | Threads 應用程式密鑰 |
| `FRONTEND_URL` | Text | `https://jasminemengting-cpu.github.io/oshenwave/` |

填完按 **Deploy** 儲存。

## 步驟 D：告訴網頁後端在哪

編輯這個 repo 的 [`config.js`](config.js)，填入步驟 A 的網址：

```js
window.OSHENWAVE_API_BASE = 'https://oshenwave.你的名稱.workers.dev';
```

存檔後等 1 分鐘，打開抽獎網頁，就會出現「🔐 用 Threads 帳號登入」按鈕。

---

## 常見問題

- **登入後顯示「找不到這則貼文」**：Threads 官方只允許讀取登入帳號**自己發的**貼文留言。
- **按登入後出現錯誤頁面**：通常是回呼網址填錯，或是還沒接受測試人員邀請。
- **登入有效期**：60 天。過期後網頁會請你重新登入。
- **安全性**：密鑰只存在 Cloudflare。登入憑證只存在你自己的瀏覽器，不會存在任何伺服器上。
