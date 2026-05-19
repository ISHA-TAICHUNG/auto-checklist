# 部署指南

完整部署需要 ~30 分鐘。順序很重要，不要跳步驟。

整套系統由三個雲端資源組成：

```
┌──────────────────────┐    HTTPS    ┌──────────────────────┐
│  GitHub Pages       │  ◄────────► │  Apps Script Web App │
│  （前端、靜態）       │   fetch JSON │  （後端 API、排程）  │
│  <your-github-username>/...   │             │  Sheets / Drive       │
└──────────────────────┘             └──────────────────────┘
                                              ▲
                                              │ 讀
                                              │
                                     ┌────────┴────────┐
                                     │ 場地使用試算表   │
                                     │ (<場地使用表名稱>...)  │
                                     └─────────────────┘
```

---

## A. Google 端（用 `<your-gmail@gmail.com>` 登入操作）

### A-1. 建立 DB 試算表（系統資料庫）

1. 開新的 Google Sheets，取名「自動檢查表-DB」
2. 從網址抓 Sheet ID（網址中 `/d/` 後面那串）
   - 例：`https://docs.google.com/spreadsheets/d/1ABCxxxxxxxxxx/edit` → ID 是 `1ABCxxxxxxxxxx`
3. **暫存這個 ID，等等要填到 Config.gs**

### A-2. 建立 PDF 歸檔資料夾

1. 開 Google Drive，建一個資料夾「自動檢查表-PDF歸檔」
2. 進入資料夾，從網址抓 Folder ID（網址中 `/folders/` 後面那串）
3. **暫存這個 ID**

### A-3. 確認場地使用試算表已共用

打開 `<YOUR_VENUE_SHEET_ID>`（<場地使用表名稱>）。
確認右上角已共用給 `<your-gmail@gmail.com>`（檢視者即可）。

### A-4. 建立 Apps Script 專案

1. Google Drive → 右鍵新增 → 更多 → Google Apps Script
   （若沒看到，「連結更多應用程式」搜尋 Apps Script 啟用）
2. 進入後左上角專案名稱改成「自動檢查表-API」
3. **設定時區**：左側「專案設定」→ 勾選「在編輯器中顯示『appsscript.json』資訊清單檔案」
4. 回到編輯器，點開 `appsscript.json`，把內容換成 `apps-script/appsscript.json` 的內容（含 `"timeZone": "Asia/Taipei"`）
5. 把 `apps-script/` 資料夾內**所有 10 個 .gs 檔**逐一貼進去（PDF 已改用 DocumentApp，不再需要 HTML 模板）：

| 在 Apps Script 編輯器點「＋」→ | 選 | 命名 | 貼上對應檔內容 |
|---|---|---|---|
| Config.gs | 指令碼 | `Config` | `apps-script/Config.gs` |
| Utils.gs | 指令碼 | `Utils` | `apps-script/Utils.gs` |
| Main.gs | 指令碼 | `Main` | `apps-script/Main.gs` |
| Templates.gs | 指令碼 | `Templates` | `apps-script/Templates.gs` |
| Submission.gs | 指令碼 | `Submission` | `apps-script/Submission.gs` |
| Drive.gs | 指令碼 | `Drive` | `apps-script/Drive.gs` |
| Pdf.gs | 指令碼 | `Pdf` | `apps-script/Pdf.gs` |
| Calendar.gs | 指令碼 | `Calendar` | `apps-script/Calendar.gs` |
| Reminder.gs | 指令碼 | `Reminder` | `apps-script/Reminder.gs` |
| Setup.gs | 指令碼 | `Setup` | `apps-script/Setup.gs` |

（預設那個 `Code.gs` 可以刪掉）

### A-5. 填入 Config

#### A-5-1. 產生 API_TOKEN

開 Mac 終端機跑這個指令，產一段隨機字串：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
```

或在線上工具（[random.org](https://www.random.org/strings/)）產 32 字以上的英數字串。**這個 token 等等前後端要設定成完全一樣的值**。

#### A-5-2. 改 Config.gs

在 `Config.gs` 找到並修改：

```js
DB_SHEET_ID:            'REPLACE_WITH_YOUR_DB_SHEET_ID',     // ← A-1 的 ID
ARCHIVE_ROOT_FOLDER_ID: 'REPLACE_WITH_YOUR_DRIVE_FOLDER_ID', // ← A-2 的 ID
API_TOKEN:              'REPLACE_WITH_RANDOM_TOKEN_...',     // ← A-5-1 產的 token
```

儲存（`⌘+S`）。**記得 token 是要保密的**，不要分享、不要貼到對話、不要寫進說明文件。

### A-6. 初始化 DB

1. 上方下拉式選單選 `initializeDatabase`
2. 點「執行」
3. 第一次會跳「需要授權」→ 同意（要勾選 Drive、Sheets、Gmail 權限）
4. 執行完打開 A-1 的試算表，會看到 6 個工作表已建好、預設資料已填入

### A-7. 部署為 Web App

1. 右上角「部署」→「新增部署作業」
2. 類型選「網頁應用程式」
3. 設定：
   - 描述：`v1.0`
   - 執行身分：**我自己**
   - 存取權：**任何人**（GitHub Pages 要能匿名呼叫）
4. 點「部署」→ 同意授權
5. 複製出現的「網頁應用程式 URL」（像 `https://script.google.com/macros/s/AKfycb.../exec`）
6. **暫存這個 URL**，等等要填到 GitHub 那邊

### A-8. 把 Web App URL 寫回 DB

1. Apps Script 編輯器 → 選 `setWebAppUrlFromCurrent` → 執行
2. 打開 DB 試算表的「系統設定」→ 確認 `webAppUrl` 已填入

### A-9. 安裝每日 09:00 提醒觸發器

1. Apps Script 編輯器 → 選 `installDailyReminderTrigger` → 執行
2. 同意觸發器權限
3. 左側「觸發條件」可以確認有一筆 `dailyReminderJob` 每日 09:00 執行

---

## B. GitHub 端（push 到 <your-github-username> 組織）

### B-1. 建立 repo

在 <your-github-username> 組織開一個新 repo：
- 名稱建議：`auto-checklist`（或你想要的名稱）
- 公開（GitHub Pages 必須公開）

### B-2. 設定 API 位址與 Token

編輯本地 `js/config.js`，把兩個 PASTE_YOUR 換成實際值：

```js
API_BASE:  '<A-7 的 Apps Script exec URL>',
API_TOKEN: '<A-5-1 產的 token，必須與 Config.gs 完全一致>',
```

⚠ **重要**：API_TOKEN 是「半公開」的（前端會看得到），但仍應該保留至少這層防護。不要把這個 token 公開貼到 README、Issues、聊天室。

### B-2-1. 把前端 URL 寫回 DB

GitHub Pages 啟用後（B-4），記得回到 DB 試算表「系統設定」工作表，把 `webFrontendUrl` 那一格填入 `https://<your-github-username>.github.io/auto-checklist`（提醒信中的「前往填寫」按鈕會用這個）。

### B-3. 推上去

⚠ **推送前確認**：`js/config.js` 的 `API_TOKEN` 已填，`Config.gs` 已不在 staging 區（這個檔含敏感 token）— 但 `Config.gs` 是部署到 Apps Script 才有實際值，git 上的版本是 `REPLACE_...`，所以可以 push。

在 `/Users/hao/Desktop/自動檢查表_電子化` 執行：

```bash
git remote add origin git@github.com:<your-github-username>/auto-checklist.git
# 把目前最新狀態 commit 後 push
git add -A
git commit -m "chore: 部署設定"   # 若沒新變更可省略
git push -u origin main
```

> ⚠ **token 進 git 怎麼辦？** 若不小心把含真實 token 的 `config.js` push 上去，立刻：
> 1. 到 Apps Script Config.gs 改 API_TOKEN（馬上失效）
> 2. 改 js/config.js 為新 token
> 3. 重 commit、push（舊 token 已沒用）

### B-4. 啟用 GitHub Pages

1. 進 GitHub repo → Settings → Pages
2. Source：`Deploy from a branch`
3. Branch：`main` / Folder：`/ (root)`
4. 儲存
5. 等 1-2 分鐘，會顯示網址：`https://<your-github-username>.github.io/auto-checklist/`

---

## C. 驗證

### C-1. 開首頁

打開 `https://<your-github-username>.github.io/auto-checklist/`，應該看到一張設備卡「<設備名稱>」。

### C-2. 試填日檢

1. 點「每日檢點」
2. 隨便填、簽名、送出
3. 看到「✓ 檢點表已送出」+ PDF 連結
4. 打開 Drive，到「自動檢查表-PDF歸檔/固定式起重機/115年/05月/」，PDF 應該在裡面，檔名類似 `1150518_<設備名稱>_日檢.pdf`

### C-3. 試提醒信

1. Apps Script 編輯器 → 選 `dailyReminderJob` → 執行
2. 看 `<reminder-recipient@example.com>` 信箱有沒有收到提醒信
3. 如果今天場地表有使用紀錄且你還沒送出日檢 → 應該會收到信
4. 如果已送出日檢、或當日場地表沒人用 → 不會寄信

---

## D. QR Code 產生（給每台天車貼）

打開：https://www.qr-code-generator.com/

把這個網址輸入 → 生成 QR Code → 列印貼在天車上：

```
https://<your-github-username>.github.io/auto-checklist/daily.html?eqp=<設備代號>
```

操作員手機掃 QR Code 就直接進入該台天車的日檢表。

未來新增設備，把 `eqp=` 後面換成新的設備代號就好。

---

## E. 常見問題

### Apps Script 改了程式碼，前端沒更新？
Apps Script 修改後一定要再「部署」→「管理部署作業」→ 編輯版本 → 部署新版本。
否則 Web App URL 還是舊版邏輯。

### 想換場地表（明年 116 年）？
打開 DB「系統設定」工作表，把 `venueSheetId` 那一格的值改成新試算表的 ID。**不用碰程式、不用重新部署。**

### 場地表的「分頁名稱」變了？
進「設備清單」工作表，把那一列的「場地表分頁」改成新名字。

### 想新增節假日關鍵字？
進「節假日關鍵字」工作表，新增一列就好。
