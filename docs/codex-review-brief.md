# 自動檢查表電子化系統 — 給 codex 的審查 brief

> 目的：讓 codex 接手審視整體架構決策、找出潛在 bug、評估 trade-offs
>
> **更新狀態（最新 commit v3.0）**：codex 已 review 並指出 3 個 P1/P2 安全問題，全部已修正：
> - ✅ fetchPdf admin endpoint 已移除（避免任意 Drive 檔案下載）
> - ✅ testSubmit admin endpoint 已移除（避免污染 production audit）
> - ✅ ?debug=1 模式已移除（避免未授權 stack trace 洩漏）
>
> 系統目前 production-ready，僅留以下 admin endpoints（皆需 token）：
> - `admin&action=fixWebAppUrl` — 修正 webAppUrl 設定
> - `admin&action=setBranding` — 寫機構名稱 / 承辦 email 到 DB

---

## 1. 系統概況

固定式起重機（天車）安全檢查表電子化系統，掃 QR Code → 平板/手機填表 → 簽名 → 後端產 PDF 上傳 Drive → 場地表整合 → 09:00 寄信提醒未填者。

- **GitHub repo**：`<your-github-username>/auto-checklist` (public)
- **GitHub Pages**：`https://<your-github-username>.github.io/auto-checklist/`
- **Apps Script scriptId**：`1eYLXFv6vy508We5j9ks7-BmO0ui09yPRC_7BoOkfDlRteqW3THA2OPO1`
- **Status endpoint**（無 token 可呼叫看系統狀態）：
  `https://script.google.com/macros/s/AKfycbwrAgEXjxRfvQtpGVFqRrHRmr-i5itZZSH9DmrvVl48YWlxFhdxJvEIwQYpR7rv6SkTrQ/exec?api=status`

## 2. 架構

```
GitHub Pages (靜態前端)            Apps Script Web App (後端 API)
  index.html / daily.html             Main.gs       — doGet/doPost router
  monthly.html                        Config.gs     — 全域設定 + runtime helpers
  css/style.css                       Utils.gs      — 日期/字串/dataURL utils
  js/                                 Templates.gs  — 讀檢查表模板 from DB
   ├─ config.js (API_BASE, API_TOKEN) Submission.gs — 接收填表流程
   ├─ api.js   (fetch + branding)     Pdf.gs        — DocumentApp 產 PDF
   └─ signature.js (canvas + trim)    Drive.gs      — 按年月歸檔
                                      Calendar.gs   — 場地表使用判斷
        │                             Reminder.gs   — 每日 09:00 寄信
        │ fetch JSON                  Setup.gs      — DB 初始化 / OAuth helper
        │ (text/plain content-type)   appsscript.json (Asia/Taipei + 6 scopes)
        ▼
  POST { apiToken, formType, equipmentId, checkDate,
         inspector, items[], signature(dataURL) }
        ▼
  doPost: token 驗證 → handleSubmission_
                          ├─ validateSignature_ (regex 白名單)
                          ├─ sanitize result/risk/methods (白名單)
                          ├─ LockService.tryLock(30s)
                          ├─ buildPdf_ (DocumentApp)
                          ├─ getOrCreateArchiveFolder_ (Drive)
                          ├─ folder.createFile(pdfBlob)
                          └─ writeRecord_ (一次寫入紀錄，含 fileUrl)
        ▼
  Google Sheets DB                    Google Drive 歸檔
   ├─ 系統設定                          自動檢查表-PDF歸檔/
   ├─ 節假日關鍵字                       └─ [類別]/[民國年]/[民國月]/
   ├─ 設備清單                                └─ {YYYMMDD}_{設備}_{日|月}檢.pdf
   ├─ 檢查表模板
   ├─ 檢查項目
   └─ 填報紀錄                         場地使用試算表 (橫式行事曆)
                                       └─ 各機具類別分頁

  每日 09:00 cron → dailyReminderJob
    對每台啟用設備：
      1. 讀場地表該日 (Calendar.gs)
      2. 命中節假日關鍵字 → 跳過
      3. 有使用 + 無對應日檢紀錄 → 寄信給承辦
```

## 3. 關鍵架構決策

| # | 決策 | 替代方案 | 為什麼選 | 風險 |
|---|---|---|---|---|
| A | GitHub Pages 公開 + API_TOKEN 半公開 | OAuth Google Sign-In / Private repo with paid GitHub Pages | 零成本、上線快 | token 可被看見，依賴後端 size/format/whitelist 防護 |
| B | PDF 用 DocumentApp | HtmlService.getAs(PDF) / Slides / 第三方 lib | HtmlService 對 inline image 支援不穩；Slides 過度設計 | 版面控制不如 HTML 細緻；Doc 自動分頁可能 break 表格 |
| C | 機構名稱 runtime fetch `/branding` | 寫死前端 / build-time injection | source code 乾淨、可重用 | 首屏載入有閃爍 |
| D | 簽名 `trimmedDataURL()` 裁切空白 | 直接送整張 / fixed crop | 解決 fullscreen canvas 大量留白問題 | trim 用 alpha=0 偵測，PNG 必須是透明背景 |
| E | DB 6 個工作表 + runtime 動態讀 | 寫死 in code / NoSQL | 管理員自助維護、年度換場地表只改一格 | Sheets 寫入有 quota（每 user 每天 ~20k 次） |
| F | 歸檔結構 `[類別]/[民國年]/[民國月]/` | 扁平 / 按設備分 | 使用者明確要求 | 跨類別查詢要多層導覽 |
| G | `LockService.tryLock(30s)` 序列化 | 樂觀鎖 / 無鎖 | 防 race 寫入 Sheet | 高並發時 30s timeout |
| H | 同步 doPost 內產 PDF + 上傳 + 寫紀錄 | 非同步 queue | 簡單；fail 不留髒資料（先 PDF 再 record） | PDF 大或網路慢時可能 6 分鐘 timeout |

## 4. 已踩過並修正的 bug（給 codex 看歷史）

| # | 錯誤訊息 | 根因 | 修法 |
|---|---|---|---|
| 1 | `HtmlService.getAs(PDF)` 不顯示 base64 signature 圖 | Apps Script HTML→PDF 引擎已知限制 | 改用 DocumentApp.appendImage(blob) |
| 2 | `指定的權限不足，無法呼叫 DocumentApp.create` | appsscript.json 缺 `auth/documents` scope | 加 scope + triggerScopesConsent helper |
| 3 | `cell.setHorizontalAlignment is not a function` | TableCell API 無此方法 | 透過 `cell.getChild(0).asParagraph().setAlignment()` |
| 4 | `Cannot read properties of undefined (reading 'substring')` | `buildPdf_` 用 `ctx.rocDateStr` 但 `handleSubmission_` 沒傳 | buildPdf_ 自己用 `formatROCDate_(ctx.checkDate)` 算 |
| 5 | `dataUrlToBlob_ is not defined` | 中間重寫 Utils.gs 時誤刪此函數 | 加回去 |
| 6 | 測試 PDF 誤推上 GitHub repo（洩漏機構資訊） | `.gitignore` 沒包含 `*.pdf` | filter-branch 改寫 history + force push |
| 7 | 提醒信「前往填寫」按鈕點下去顯示 raw JSON | fallback 跳到 `?api=meta` JSON endpoint | 改為「DB webFrontendUrl → Config.DEFAULT_WEB_FRONTEND_URL」兩層 |

## 5. 待驗證 / 待 codex 看的點

### 5.1 我端到端驗證過的
- ✅ doPost 收到完整 7 項 + 簽名 → 成功
- ✅ PDF 產出，下載後 Read 工具讀內容，**簽名手寫筆跡正常顯示**
- ✅ 異常欄第 7 項 X 紅字 + 異常說明
- ✅ 日期 `115/05/18` 不含「（民國）」
- ✅ dailyReminderJob 邏輯（場地表「<課程名稱>」→ 寄信）
- ✅ DB 6 個工作表初始化、機構資訊 runtime 載入

### 5.2 未驗證（使用者尚未實測手機端）
- ⏳ 手機 portrait 簽名 + orientation 動態提示切換
- ⏳ landscape 旋轉時筆跡保留（等比例 fit 置中）
- ⏳ 月檢表 PDF（我只測 daily）
- ⏳ 異常 textarea 高度（100px min-height）實際是否夠寬
- ⏳ payload size 接近 500KB 上限的行為
- ⏳ 同時多人填表（LockService 表現）
- ⏳ 場地表 116 年新表（明年）結構若略變的相容性

### 5.3 已知 limitation
1. `API_TOKEN` 寫在 GitHub Pages 的 `js/config.js`，等同半公開
2. PDF 大小 = DocumentApp 產出 ~95KB（含簽名 PNG embed）
3. Apps Script 單次 execution 上限 6 分鐘
4. Apps Script Web App 不支援 CORS preflight，前端必須用 `text/plain` content-type
5. Sheets API 沒在 clasp GCP project 啟用（用 SpreadsheetApp 直接 read/write 不受影響）

## 6. 給 codex 的具體提問

1. **安全**：GitHub Pages 公開 + token 模式，除了現有的「payload size limit + signature regex + result/risk/methods 白名單 + LockService」，還有什麼可加？
2. **可擴展性**：未來新增機具（堆高機、衝剪機械）時，場地表分頁結構若不同（不是「每月 2 欄」），`Calendar.gs` 怎麼設計才能容易插入新解析器？
3. **PDF 版面**：DocumentApp 版面控制有限（無精確 margin/padding/column-span），是否該改用 Slides 或保留 HTML→PDF（再想辦法解 image）？
4. **失敗恢復**：handleSubmission_ 任何步驟失敗會 throw，但 DocumentApp.create 已經在 Drive 留下暫時 Doc — finally 區會刪，但若 Apps Script 中途崩潰（很少見）會留垃圾。是否值得加 GC job？
5. **時區處理**：`parseISODate_` 強制 `+08:00` suffix；若部署到非台灣分校，可否改成讀 `CONFIG.TIMEZONE` 動態組？
6. **OAuth scope 增加流程**：scope 變更後必須 user 在編輯器手動同意；有沒有更乾淨的部署流程？

## 7. 完整檔案清單

```
/Users/hao/Desktop/自動檢查表_電子化/
├─ apps-script/        ← Google Apps Script 後端（10 .gs + 2 .html + appsscript.json）
│  ├─ Main.gs          ← doGet/doPost router + admin endpoints
│  ├─ Config.gs        ← 設定與 helpers (getOrgHeader_ / getReminderEmail_)
│  ├─ Utils.gs         ← 日期/字串/dataUrlToBlob_/sanitize
│  ├─ Templates.gs     ← getFormMeta_ / getEquipmentList_
│  ├─ Submission.gs    ← handleSubmission_ (核心流程)
│  ├─ Pdf.gs           ← buildPdf_ via DocumentApp
│  ├─ Drive.gs         ← getOrCreateArchiveFolder_
│  ├─ Calendar.gs      ← getVenueUsage_ (橫式行事曆解析)
│  ├─ Reminder.gs      ← dailyReminderJob
│  ├─ Setup.gs         ← initializeDatabase / setBranding / triggerScopesConsent
│  ├─ pdf-daily.html   ← 已棄用（保留作為 future fallback）
│  ├─ pdf-monthly.html ← 同上
│  └─ appsscript.json  ← timezone + oauthScopes
├─ index.html          ← 設備列表入口
├─ daily.html          ← 每日檢查表
├─ monthly.html        ← 每月檢查表
├─ css/style.css       ← 老花友善版 UI
├─ js/
│  ├─ config.js        ← API_BASE + API_TOKEN
│  ├─ api.js           ← fetch wrapper + 自動 fetch branding
│  └─ signature.js     ← SignaturePad class + orientation hint + trimmedDataURL
└─ docs/
   ├─ deployment-guide.md
   ├─ sheets-schema.md
   ├─ how-to-add-equipment.md
   └─ codex-review-brief.md  ← 此檔
```

## 8. 連續 commit 摘要（給 codex 看演進）

```
591dabc  fix(critical): 4 個真實踩到的 PDF 簽名 bug   ← 最新，e2e 通過
a36a777  refactor: 簡化簽名 — 拿掉 fullscreen overlay 改用 orientation hint
aa3476a  fix: PDF 簽名根本性修正 + 全螢幕簽名裁切空白
d40d901  feat: 移除送出後的「在 Drive 開啟 PDF」按鈕
...
```

完整 history：`git log --oneline` in `/Users/hao/Desktop/自動檢查表_電子化`

## 9. 怎麼讓 codex 真實測試

如果 codex 有 Apps Script Web App 呼叫能力：
1. `GET ...exec?api=status` — 不需 token，看整個系統狀態
2. `GET ...exec?api=admin&action=testSubmit&token=<API_TOKEN>` — 全流程測試（1x1 base64 簽名）
3. `GET ...exec?api=admin&action=fetchPdf&token=<API_TOKEN>&fileId=<ID>` — 下載 PDF base64

API_TOKEN 在本機 `.env`（git ignored），可從 `js/config.js` 讀到（半公開）。

## 10. 已知 architectural debt

- `apps-script/pdf-daily.html` 與 `apps-script/pdf-monthly.html` 已不使用（改 DocumentApp），可刪
- `Pdf.gs` 內早期版本 `getOrCreateSignatureTempFolder_` 已被新版取代但函數定義可能還在某處
- `Setup.gs` 內 `setWebAppUrlFromCurrent` 從編輯器跑會抓到 /dev URL（已用 admin/fixWebAppUrl 修正過但函數本身仍 misleading）
