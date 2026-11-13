# oshenwave

## 🌐 網頁版（推薦）

👉 **https://jasminemengting-cpu.github.io/oshenwave/**

1. 按「🔐 用 Threads 帳號登入」
2. 貼上你的貼文網址 → 按「⚡ 抓取留言」
3. 設定條件 → 按「🎲 開始抽獎」

> 第一次使用前需要完成一次性設定，請看 [SETUP.md](SETUP.md)。
> 還沒設定前，也可以用網頁上「其他收集方式」裡的書籤小工具。

所有資料只在你的瀏覽器處理，不會上傳。

---

## 🐍 Python 版 Threads 留言抽獎程式

自動抓取 Threads 貼文的所有留言，存成 CSV，再依規則公平隨機抽出得獎者。

### 安裝

```bash
pip install playwright
playwright install chromium
```

### 使用方式

1. **登入（只需一次）**
   ```bash
   python threads_lottery.py --login
   ```
   在跳出的瀏覽器登入 Threads 後回終端機按 Enter。

2. **抓留言並抽獎**
   ```bash
   python threads_lottery.py "https://www.threads.com/@帳號/post/XXXX" -n 3 --backup 2 -k "+1" --min-tags 2
   ```

3. **用已抓好的 CSV 重抽**
   ```bash
   python threads_lottery.py --from-csv comments.csv -n 3 --author 你的帳號
   ```

### 參數

| 參數 | 說明 |
|---|---|
| `-n` | 抽出幾位（預設 1） |
| `--backup` | 備取人數 |
| `-k` | 留言須包含的關鍵字，可重複指定 |
| `--all-keywords` | 須包含全部關鍵字（預設任一即可） |
| `--min-tags` | 至少標註幾位朋友 |
| `--before` | 截止時間，如 `"2026-11-20 23:59:59"` |
| `--exclude` | 排除的帳號 |
| `--allow-multi` | 允許同一人多則留言增加機率（預設每人一次） |
| `--include-author` | 不排除貼文作者 |
| `--seed` | 亂數種子，用來重現抽獎結果 |
| `--headless` | 不顯示瀏覽器視窗 |

### 公平性

每次抽獎都會印出亂數種子。公布種子與 `comments.csv`，任何人用 `--seed` 都能重現相同結果。

### 注意

`.threads_profile/` 存有你的 Threads 登入狀態，已列入 `.gitignore`，請勿上傳。
