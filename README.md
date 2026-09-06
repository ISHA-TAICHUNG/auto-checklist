# ISHA 自動檢查表電子化系統

社團法人中華民國工業安全衛生協會附設台中職業訓練中心使用的每日／每月檢點、異常處理與主管簽核系統。

## 功能

- **掃 QR 填表**：每台設備一個 QR Code，操作員手機掃碼直接進入填表頁
- **手寫簽名**：支援平板觸控與滑鼠
- **自動產 PDF**：A4 版型、含設備資訊、勾選結果、異常說明、簽名
- **雲端歸檔**：自動建立 `[機具類別]/[民國年]/[民國月]/` 資料夾，檔名 `民國年月日_設備_類型.pdf`
- **整合場地使用表**：依場地使用狀態判定當日應檢項目，未填時依訂閱欄位通知指定人員
- **LINE 通知分流**：機具日檢、機具月檢、三地教室月檢、場地防護具及異常事件各自套用收件規則
- **異常與簽核流程**：保留處理回報、主管審核、PDF 產製及歸檔紀錄
- **營運中控台**：檢視每日／每月進度、待處理異常、待簽核、通知額度與排程健康狀態
- **節假日自動排除**：場地表命中停班、假日等設定關鍵字時不列為使用
- **無程式擴充**：新增機具種類（堆高機、衝剪機械等）只需在 Sheets 加列，不用改程式

## 架構

```
GitHub Pages (repo root)       Apps Script (apps-script/)
  ├─ index.html                ├─ Main.gs        — doGet/doPost API
  ├─ daily.html                ├─ Submission.gs  — 接收填報
  ├─ monthly.html              ├─ Pdf.gs         — 產 PDF
  └─ js/api.js  ─ fetch ──►    ├─ Drive.gs       — 雲端歸檔
                               ├─ Calendar.gs    — 場地使用判斷
                               ├─ Reminder.gs    — 每日提醒、執行狀態與失敗隔離
                               ├─ LineWebhook.gs — LINE Bot 指令與圖卡入口
                               ├─ AdminDashboard.gs — 營運中控台唯讀狀態與安全操作
                               └─ Setup.gs       — 一鍵初始化
                                         │
                                         ▼
                               Google Sheets（資料庫）
                                + Google Drive（PDF 歸檔）
                                + 場地使用試算表
                                + LINE Messaging API
```

## 部署

完整步驟見 [`docs/deployment-guide.md`](docs/deployment-guide.md)。

簡述：
1. 建 Google Sheets（DB） + Drive 資料夾 + Apps Script 專案
2. 把 `apps-script/` 內容貼進 Apps Script，填好 Config，執行 `initializeDatabase`
3. 部署為 Web App，記下 exec URL
4. 把 exec URL 填到 `js/config.js`
5. Push 到 GitHub，啟用 Pages（branch=`main`，folder=`/`）

## 資料庫規格

見 [`docs/sheets-schema.md`](docs/sheets-schema.md)。

## 使用說明

- **日常使用**（操作員 / 承辦 / 主管）：[`docs/user-guide.md`](docs/user-guide.md)
- **新增機具 / 檢查表**：[`docs/how-to-add-equipment.md`](docs/how-to-add-equipment.md)
  95% 的擴充情境只需要改 Google Sheets，不用改程式、不用重新部署。

## 目錄結構

```
.
├─ apps-script/                # Google Apps Script 後端
│  ├─ appsscript.json          # 專案資訊清單（強制 Asia/Taipei 時區）
│  ├─ Config.gs                # 全域設定（伺服器 token placeholder、TIMEZONE、上限）
│  ├─ PublicSession.gs         # 公開前端短效、動作綁定、一次性票證
│  ├─ Utils.gs                 # 日期、字串工具
│  ├─ Main.gs                  # Web App 入口（doGet/doPost）
│  ├─ Templates.gs             # 檢查表模板讀取
│  ├─ Submission.gs            # 接收前端送出
│  ├─ Drive.gs                 # 雲端歸檔
│  ├─ Pdf.gs                   # PDF 產生
│  ├─ Calendar.gs              # 場地使用判斷
│  ├─ Reminder.gs              # 每日提醒、執行心跳與錯誤隔離
│  ├─ LineNotify.gs            # LINE 推播、收件名單與圖卡
│  ├─ LineWebhook.gs           # LINE Bot 指令路由
│  ├─ AdminDashboard.gs        # 主管營運中控台
│  └─ Setup.gs                 # 一鍵初始化 DB + branding 設定 + OAuth helper
├─ index.html                  # GitHub Pages 入口（設備列表）
├─ daily.html                  # 每日檢點表
├─ monthly.html                # 每月檢查紀錄
├─ incident.html               # 日常異常事件通報
├─ dashboard.html              # 主管營運中控台
├─ css/style.css
├─ js/
│  ├─ config.js                # 公開設定（只含 API_BASE，不含共享密鑰）
│  ├─ api.js                   # 與 Apps Script 溝通
│  └─ signature.js             # 手寫簽名 canvas
└─ docs/
   ├─ deployment-guide.md
   └─ sheets-schema.md
```

## 法規依據

- 職業安全衛生管理辦法 §52 — 每日作業前檢點
- 起重升降機具安全規則 §24, §26 — 每月定期檢查

## 版本

v1.0 — 2026/05 初版（固定式天車）
