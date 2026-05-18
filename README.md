# 自動檢查表電子化系統

> <機構名稱>

固定式天車與其他機具的每日 / 每月安全檢查表電子化系統，包含手寫簽名、自動產 PDF、雲端歸檔、未填提醒。

## 功能

- **掃 QR 填表**：每台設備一個 QR Code，操作員手機掃碼直接進入填表頁
- **手寫簽名**：支援平板觸控與滑鼠
- **自動產 PDF**：A4 版型、含設備資訊、勾選結果、異常說明、簽名
- **雲端歸檔**：自動建立 `[機具類別]/[民國年]/[民國月]/` 資料夾，檔名 `民國年月日_設備_類型.pdf`
- **整合場地使用表**：當日場地有使用但未填日檢，**早上 9:00 自動寄信給承辦人**
- **節假日自動排除**：場地表寫「元旦、春節、連假...」等關鍵字會跳過不寄信
- **無程式擴充**：新增機具種類（堆高機、衝剪機械等）只需在 Sheets 加列，不用改程式

## 架構

```
GitHub Pages (web/)            Apps Script (apps-script/)
  ├─ index.html                ├─ Main.gs        — doGet/doPost API
  ├─ daily.html                ├─ Submission.gs  — 接收填報
  ├─ monthly.html              ├─ Pdf.gs         — 產 PDF
  └─ js/api.js  ─ fetch ──►    ├─ Drive.gs       — 雲端歸檔
                               ├─ Calendar.gs    — 場地使用判斷
                               ├─ Reminder.gs    — 每日提醒信
                               └─ Setup.gs       — 一鍵初始化
                                         │
                                         ▼
                               Google Sheets（資料庫）
                                + Google Drive（PDF 歸檔）
                                + 場地使用試算表
```

## 部署

完整步驟見 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

簡述：
1. 建 Google Sheets（DB） + Drive 資料夾 + Apps Script 專案
2. 把 `apps-script/` 內容貼進 Apps Script，填好 Config，執行 `initializeDatabase`
3. 部署為 Web App，記下 exec URL
4. 把 exec URL 填到 `web/js/config.js`
5. Push 到 GitHub，啟用 Pages（`/web` 資料夾）

## 資料庫規格

見 [`docs/sheets-schema.md`](docs/sheets-schema.md)。

## 目錄結構

```
.
├─ apps-script/                # Google Apps Script 後端
│  ├─ appsscript.json          # 專案資訊清單（強制 Asia/Taipei 時區）
│  ├─ Config.gs                # 全域設定（API_TOKEN, TIMEZONE, 上限）
│  ├─ Utils.gs                 # 日期、字串工具
│  ├─ Main.gs                  # Web App 入口（doGet/doPost）
│  ├─ Templates.gs             # 檢查表模板讀取
│  ├─ Submission.gs            # 接收前端送出
│  ├─ Drive.gs                 # 雲端歸檔
│  ├─ Pdf.gs                   # PDF 產生
│  ├─ Calendar.gs              # 場地使用判斷
│  ├─ Reminder.gs              # 每日 09:00 提醒信
│  ├─ Setup.gs                 # 一鍵初始化 DB
│  ├─ pdf-daily.html           # 日檢 PDF 模板
│  └─ pdf-monthly.html         # 月檢 PDF 模板
├─ web/                        # GitHub Pages 前端
│  ├─ index.html               # 設備列表入口
│  ├─ daily.html               # 每日檢點表
│  ├─ monthly.html             # 每月檢查紀錄
│  ├─ css/style.css
│  └─ js/
│     ├─ config.js             # ⚠ 部署後要填 API_BASE
│     ├─ api.js                # 與 Apps Script 溝通
│     └─ signature.js          # 手寫簽名 canvas
└─ docs/
   ├─ deployment-guide.md
   └─ sheets-schema.md
```

## 法規依據

- 職業安全衛生管理辦法 §52 — 每日作業前檢點
- 起重升降機具安全規則 §24, §26 — 每月定期檢查

## 版本

v1.0 — 2026/05 初版（固定式天車）
