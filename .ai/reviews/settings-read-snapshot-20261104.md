# 設定讀取效能調整：獨立 Codex 審閱

- reviewer: Codex settings_reviewer；產品 writer: settings-read-snapshot-20261104 主代理。
- 審閱結論：**PASS**。在本輪 Config／Main 與既有 bootstrap 補齊範圍內，未發現需要修正的 P0／P1／P2 問題。
- 權限：僅讀產品與測試；只新增本 review 檔，未修改產品、測試、部署副本，未提交、發布或發送外部訊息。
- 本結論是來源與離線測試審閱，不代表已驗證正式環境、LINE 實際回覆或 PDF／Drive 外部操作。

## 審閱依據

1. `apps-script/Config.gs:144` 的設定作用域以 `finally` 清除，巢狀呼叫重用外層作用域；`157` 起只保存成功讀取的原始設定列，未保存呼叫者 fallback，資料庫身分改變時不沿用原資料。
2. 缺少分頁與讀取錯誤維持原本 fallback 行為，讀取失敗不污染後續查詢。日期回傳在作用域內複製，避免呼叫端修改已讀取值；預設值物件仍原樣回傳。
3. `apps-script/Main.gs:26` 將一般 GET 包入作用域，`api=admin` 明確繞過。`1115` 在 webhook 憑證通過後才進入作用域；`1214` 仍先驗證公開票證，再進入檢點表處理。管理 POST、其他 POST 與排程沒有額外作用域。
4. `apps-script/Main.gs:84` 的 checklistBootstrap 每次都呼叫 `getLockedItemsForEquipment_`；模板可快取、異常鎖定狀態不快取。異常讀取失敗時整筆回應為失敗，前端不能取得可填的部分成功結果。
5. `apps-script/Main.gs:1058` 的公開模板快取明確限制 daily／monthly 與設備代號，TTL 為 60 秒。快取讀取、解析或寫入失敗均會保留直接讀取能力。
6. `js/api.js:197` 保留舊後端的 fallback，且 meta 或 lockedItems 任一失敗便回傳失敗。日／月檢頁維持由完整 bootstrap 決定是否顯示可填項目。
7. `apps-script/Submission.gs:172` 與 `183` 仍在共用鎖內重新查詢異常鎖定與最新表單定義，未使用公開模板快取。送出資料驗證、文件／PDF、歸檔、紀錄與通知順序未由本 patch 改動。
8. `apps-script/Main.gs:63` 的 health 只增加 build 欄位，保留 ok、name、version=1.0；健康檢查不讀試算表。

## 獨立執行的驗證

| 驗證 | 結果 |
| --- | --- |
| `node scripts/test-settings-read-snapshot.js` | PASS：20 次設定查詢只讀取 1 次；跨操作、巢狀／拋錯清理、fallback、日期隔離、資料庫身分切換、管理即時讀取、授權拒絕及舊 Config 相容性 |
| `node scripts/test-main-auth-routing.js` | PASS：授權路由、一次性票證、模板快取、異常每次重讀與失敗停止 |
| `node scripts/test-api-client-auth.js` | PASS：前端票證、重試、舊後端 fallback 與並行票證隔離 |
| `node scripts/test-public-session-auth.js` | PASS：公開操作票證驗證 |
| 獨立記憶體快取故障注入 | PASS：TTL=60、模板命中仍重讀異常、異常讀取失敗拒絕、快取 JSON 損壞及讀寫失敗降級、輸入驗證 |

## 行為限制與發布界線

- 公開模板與設備描述的更新最多可能延遲 60 秒顯示；若此期間修改模板，舊畫面送出可能被最新模板驗證拒絕並要求重新載入。這是快取的既定可見性限制，並未讓舊模板繞過送出驗證。
- 模板快取只改善公開載入；不應對使用者保證整個 LINE 或 PDF 流程的固定秒數。
- 本 PASS 不授權從共享工作目錄整包發布。Calendar 與場地測試 fixture 屬另一任務；正式套件應從最新雲端版本建立，只替換本輪已完成審閱的 Config／Main／Reminder，保留其他遠端模組並等待共用部署邊界釋放。
- 發布前仍需由 writer 完成部署副本核對、遠端來源新鮮度／版本確認及回復準備；發布後以 build、bootstrap 回讀及實際量測驗證，不以離線測試取代正式結果。

## 補充前台審閱

- `js/api.js`、`daily.html`、`monthly.html` 已與 GitHub 目前來源逐項比較；本地既存差異限於唯讀 GET timeout/options、checklistBootstrap 與舊後端 fallback、日／月檢安全載入和重試按鈕，以及 `v=2026110401` 資產版本。審閱結論：**PASS**，未發現需要修正的 P0／P1／P2。
- 正式前台目前尚未使用 bootstrap；不能將目前正式延遲歸因為「正式前台先呼叫未知 bootstrap 再 fallback」。發布時應讓上述三個前台來源與後端一起對齊，並分別驗證部署結果。
- 日／月檢現在要求 `ok`、`meta` 及陣列型別的 `locked` 全部成立後才顯示表單。舊後端 fallback 仍要求 meta／lockedItems 都成功；沒有把異常讀取失敗轉為空鎖定清單。
- 15 秒單次上限及兩次唯讀嘗試失敗後顯示重試，沒有自動重送填報 POST；既有無 options 呼叫仍維持三次嘗試。`test-api-client-auth.js` 與 `test-main-auth-routing.js` 已再次通過。
- 獨立執行 `test-checklist-loading.js` 通過，日／月檢的異常讀取失敗、停止顯示可填選項、重試及鎖定狀態均通過。另核對 writer 的完整 bundle，三個前台檔案與當前來源一致（僅資產 query 版本差異）。

## 補充 Reminder 正式兩行修改審閱

- 結論：**PASS**。未發現需要修正的 P0／P1／P2；原 Config／Main 與前台審閱結論不變。
- `apps-script/Reminder.gs:150` 在單次 `dailyReminderJob_` 函式內建立 `venueReadContext = {}`，`167` 把同一物件傳給每台設備的場地查詢。物件不在全域、opts 或其他跨次容器，下一次 job 必定建立新 context。
- 以移除該宣告整行（含註解）及第三參數後的內容，逐位元核對已保存的發布前 Reminder，完全一致；沒有其他控制流程或通知政策變動。Reminder.gs／Reminder.js 也完全相同。
- `scripts/test-reminder-read-context.js:101` 直接讀取正式 Reminder，`107` 將 `candidateReminder` 原樣設為實際內容，`121` 真正執行它；只有 baseline 移除兩行，不會在候選端偷偷補 patch。場地 fixture 已自包含，沒有匯入另一任務的測試程式。
- 六台讀取計數、LINE 回傳結果、下一次課表／年度設定更新、設定與矩形讀取失敗後復原、不同類別關鍵字隔離及 dry-run 都有實際斷言。`208` 起另用通知 stub 驗證六台同類設備仍只寄送一次，下一次課表清空便不再寄送。
- 獨立記憶體 mutation 檢查：分別移除兩行、只移除 context 宣告、只移除第三參數，正式整合測試均會失敗，確認它能偵測候選實作遺漏，而非只驗證測試內的替代實作。

### 本次獨立執行

| 命令／檢查 | 結果 |
| --- | --- |
| `node scripts/test-reminder-read-context.js` | PASS：6／6／12 → 1／1／2、狀態一致、跨操作更新、失敗復原、分類隔離與通知去重 |
| `node scripts/test-daily-reminder-runtime.js` | PASS：正式專案 guard、來源隔離、收件人解析、執行狀態錯誤與後續提醒隔離 |
| `node scripts/test-daily-recipient-policy.js` | PASS：8 組通知政策案例，無網路或真實收件者 |
| `node scripts/test-venue-year-rollover.js` | PASS：18 組 Calendar 行為案例；僅執行，不修改該任務的來源或測試 |
| `node scripts/test-project-health.js` | PASS：17 組整體健康回歸；僅執行，不修改 fixture |
| `node scripts/check-apps-script-sync.js` | PASS（Config 正式值按既有規則排除） |
| 候選遺漏 mutation 三分支 | PASS：三種遺漏均被正式測試拒絕 |

- 此新增 context 只重用場地原始讀取資料，不重用分類結果、填報紀錄、收件人或通知結果。分類去重、單一類別通知失敗隔離及後續月檢／主管待簽核的控制流程仍保留。
- 審閱只涵蓋來源與離線證據。發布仍須等待共用部署 lease，取得最新雲端內容後只更新 Config／Main／Reminder；不得將另一任務尚未發布的 Calendar 一併帶上。

## 補充新舊 Calendar 測試相容性

- 結論：**PASS**。這項調整只增加正式測試的 capability 分支，沒有新增產品改動；Reminder.gs／Reminder.js 保持一致，原產品審閱結論不變。
- `scripts/test-reminder-read-context.js:101` 仍直接讀取實際 Reminder；舊分支在 `111` 原樣執行該來源，沒有為候選注入宣告或第三參數。
- 沒有 `getVenueReadState_` 的舊 Calendar 分支，以離線場地 query port 驗證六台設備收到同次 context、下一 job 使用不同物件及相同結果。它不宣稱測得舊 Calendar 的 6→1 讀取改善；console 也明示完整計數屬新版 Calendar。
- 有新版 Calendar 時不會進入舊分支，仍執行真實 Calendar／Reminder／LINE 呼叫鏈的完整計數、跨次更新、失敗復原、分類隔離及通知去重測試。本機新版分支已獨立再次執行通過。
- 以保存的正式舊 Calendar 來源做記憶體 overlay，真實 Reminder 的舊分支獨立執行通過。再分別移除兩行、只移除宣告、只移除第三參數，三種缺漏均被舊分支拒絕，沒有因 capability 分支掩蓋 Reminder 實作遺漏。
- 此相容性設計允許單獨發布本輪 Reminder／測試，而不需要把另一任務禁止 Git push 的 Calendar 來源一併發布；實際新版 Calendar 的性能改善仍須依該模組正式發布與整合結果判定。

## 正式發布後的獨立唯讀驗收

- 結論：**PASS（本節列出的公開 API、GitHub 及 Pages 回讀範圍）**。未修改產品或正式資料、未部署、未發送 LINE／Email，也未輸出票證、完整 API 網址、人員或 Config.js 正式設定。
- 父代理提供後端部署 v129、兩個固定入口、執行／存取設定及其餘 24 個模組保留 v128 的發布證據；本 reviewer 本輪獨立核對的是下列公開入口與資產，沒有把公開 API 的 `version=1.0` 當成 Apps Script 部署版號 129。

| 獨立回讀項目 | 結果 |
| --- | --- |
| health | ok=true；API version=1.0；build=`2026-11-04-settings-read-snapshot` |
| equipments | ok=true；14 筆設備，其中 11 筆支援日檢 |
| 有效日檢樣本 checklistBootstrap | ok=true；meta.equipment／meta.template／meta.items／locked 基本 schema 正確；9 個檢查項目，該樣本 0 個鎖定項 |
| GitHub 指定 commit | `306bb3271757a55e544e074b1cfc31826338809b` 存在，11 個限定來源／測試檔案符合預期 |
| GitHub main HEAD | 與上述 commit 完全一致 |
| Pages latest build | built，commit 與上述 commit 完全一致 |
| 日／月檢 API 資產版本 | 兩頁均為 `2026110401` |
| api helper | getChecklistBootstrap 宣告、匯出及 15000ms／2 次唯讀嘗試設定均存在 |
| GitHub commit／公開 Pages／本機來源 | daily.html、monthly.html、js/api.js 三者各自逐位元相同 |

| 正式資產 | SHA-256 |
| --- | --- |
| daily.html | `22fb321c2eb461f83adc8e203da845d54f5f04fa31b55923b51ffa29267d4b50` |
| monthly.html | `c3caa1800f3014928d203182647a954c87b52ded2b83c42a718f84903bdf64fe` |
| js/api.js | `f1ab3c5d69baee9467f7f8165d946a1d05c62607f1b4709891662837fe14a29e` |

- 11 檔發布範圍集合 SHA-256：`60a006934f238d910d81c7a7d1513401ce6957e6b1e753ec44cb4606f17f9689`；集合精確限定 Config.gs／Main.gs／Reminder.gs、三個前台檔案及五個相應測試，未把另一任務的 Calendar 源碼放進本次 GitHub commit。
- 本輪公開 API GET 沒有加入額外 Cache-Control 等自訂標頭；本輪也沒有因驗收工具的 CORS 設定而修改產品。
- `locked_count=0` 只代表所選日檢樣本的此次回應，不能推論全系統沒有異常或待辦。
- 本節沒有驗證實際 LINE 聊天室回覆秒數、正式表單送出或 PDF／Drive 成果，不將它們列為通過；父代理的正常 Chrome 量測另由父代理保存並回報。

## 附錄：單次 Reminder context 的記憶體比較程式

這段程式不改產品或正式測試。它借用現有 `test-venue-year-rollover.js` 第一個測試前的場地 fixture，執行真實 `cmdStatus_ → dailyReminderJob_ → getVenueUsage_`；通知、排程執行紀錄與其他狀態子模組則用離線 stub 隔離。baseline 與 candidate 僅在記憶體相差本地 context 宣告及第三參數，不會寫入來源。

正式回歸應由 writer 改成直接測試實際候選 Reminder，並維持下方輸出、更新與失敗斷言；不能永遠在測試裡自行補上候選 patch，以免掩蓋正式實作遺漏。

下列附錄已獨立抽出以 `node -` 執行，exit 0；未寫入產品或正式測試。

```javascript
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const vm = require('vm');

const fixturePath = path.resolve('scripts/test-venue-year-rollover.js');
const fixtureSource = fs.readFileSync(fixturePath, 'utf8');
const firstTest = fixtureSource.indexOf("\ntest('115/12/31");
assert(firstTest > 0, '場地 fixture 的邊界已變動，需重新核對');
const fixtureModule = new Module(fixturePath, module);
fixtureModule.filename = fixturePath;
fixtureModule.paths = Module._nodeModulePaths(path.dirname(fixturePath));
fixtureModule._compile(fixtureSource.slice(0, firstTest) +
  '\nmodule.exports = { runtime, MAIN };', fixturePath);
const { runtime, MAIN } = fixtureModule.exports;

const actualReminder = fs.readFileSync('apps-script/Reminder.gs', 'utf8');
const baselineReminder = actualReminder
  .replace(/^\s*const venueReadContext = \{\};\r?\n/m, '\n')
  .replace('getVenueUsage_(full, today, venueReadContext)',
    'getVenueUsage_(full, today)');
assert(baselineReminder.includes('getVenueUsage_(full, today);'));
const candidateReminder = baselineReminder
  .replace('const cyclesByCategory = getTemplateCyclesByCategory_();',
    'const cyclesByCategory = getTemplateCyclesByCategory_();\n' +
    '    const venueReadContext = {};')
  .replace('getVenueUsage_(full, today)',
    'getVenueUsage_(full, today, venueReadContext)');
assert.notEqual(candidateReminder, baselineReminder);
const lineSource = fs.readFileSync('apps-script/LineWebhook.gs', 'utf8');
const configSource = fs.readFileSync('apps-script/Config.gs', 'utf8');
const settingStart = configSource.indexOf('let settingsReadSnapshot_');
const settingEnd = configSource.indexOf('/**\n * 取得場地表 ID', settingStart);
assert(settingStart >= 0 && settingEnd > settingStart);

function makeStatusRuntime(useContext, suppliedEquipment) {
  const r = runtime();
  const equipment = suppliedEquipment || Array.from({ length: 6 }, (_, i) => ({
    equipmentId: 'TEST-' + i, category: '堆高機', active: true, venueSheetTab: MAIN,
  }));
  vm.runInContext(configSource.slice(settingStart, settingEnd), r.context);
  vm.runInContext(useContext ? candidateReminder : baselineReminder, r.context);
  vm.runInContext(lineSource, r.context);
  let sendCalls = 0;
  Object.assign(r.context, {
    Logger: { log() {} },
    skipNonPrimaryDailyReminderRuntime_: () => null,
    beginDailyReminderRun_: () => ({}),
    finishDailyReminderRun_: () => {},
    todayStart_: () => new Date('2027-05-18T04:00:00Z'),
    getEquipmentList_: () => equipment,
    getEquipmentById_: id => equipment.find(e => e.equipmentId === id),
    getTemplateCyclesByCategory_: () => Object.fromEntries(
      equipment.map(e => [e.category, ['每日']])),
    hasDailyRecordInCategory_: () => false,
    sendUnfilledReminder_: () => { sendCalls += 1; },
    buildChecklistStatusFlex_: rows => rows,
    withQuickReply_: x => x,
    lineReply_: (token, messages) => messages,
  });
  r.run = () => r.context.withSettingsReadSnapshot_(() =>
    r.context.cmdStatus_('test-reply-token', 'test-user', {}))[0];
  r.counts = () => ({
    settingsReads: r.state.settingsReads,
    venueOpens: r.state.opens.filter(id => id === 'new2027').length,
    monthRangeReads: r.books.new2027.sheets[0].reads,
  });
  r.sendCalls = () => sendCalls;
  return r;
}

const before = makeStatusRuntime(false);
const after = makeStatusRuntime(true);
assert.equal(JSON.stringify(after.run()), JSON.stringify(before.run()));
assert.deepEqual(before.counts(), {
  settingsReads: 6, venueOpens: 6, monthRangeReads: 12,
});
assert.deepEqual(after.counts(), {
  settingsReads: 1, venueOpens: 1, monthRangeReads: 2,
});

// 第二次 LINE 操作必須取得新課表與新年度設定。
after.books.new2027.sheets[0].set(5, 18, 0, '新增堆高機課程');
const updated = after.run();
assert.equal(updated.filter(row => row.action === 'wouldMail').length, 1);
assert.equal(updated.find(row => row.action === 'wouldMail').usage, '新增堆高機課程');
assert.equal(after.state.settingsReads, 2);
after.state.settings.venueSheetsByYear = '{}';
assert(after.run().every(row => row.action === 'failed'));
assert.equal(after.state.settingsReads, 3);
assert.equal(after.sendCalls(), 0, '狀態查詢 dry-run 不可寄送');

// 失敗讀取不能成為「無使用」或成功快取，後續操作可復原。
const settingsFailure = makeStatusRuntime(true);
settingsFailure.state.failSettings = true;
assert(settingsFailure.run().every(row => row.action === 'failed'));
assert.equal(settingsFailure.state.settingsReads, 6,
  '設定服務讀取失敗時，每設備重試，不可保存失敗的空設定');
settingsFailure.state.failSettings = false;
assert(settingsFailure.run().every(row => row.action === 'skip'));
assert.equal(settingsFailure.sendCalls(), 0);

const monthFailure = makeStatusRuntime(true);
monthFailure.books.new2027.sheets[0].fail = true;
assert(monthFailure.run().every(row => row.action === 'failed'));
assert.equal(monthFailure.state.settingsReads, 1);
monthFailure.books.new2027.sheets[0].fail = false;
monthFailure.books.new2027.sheets[0].set(5, 18, 0, '恢復堆高機課程');
assert.equal(monthFailure.run().filter(row => row.action === 'wouldMail').length, 1);
assert.equal(monthFailure.sendCalls(), 0);

// 同一月份 raw data 可以重用，但各設備類別仍各自套用關鍵字。
const mixed = makeStatusRuntime(true, Array.from({ length: 6 }, (_, i) => ({
  equipmentId: 'MIXED-' + i, active: true, venueSheetTab: MAIN,
  category: i % 2 ? '高空工作車' : '堆高機',
})));
// 明確指定不重疊的測試關鍵字，避免「高」也命中「堆高機」的字詞歧義。
mixed.state.settings.venueUsageRequiredKeywords = '堆高機=堆高機;高空工作車=高空車';
mixed.books.new2027.sheets[0].set(5, 18, 0, '堆高機課程');
mixed.books.new2027.sheets[0].set(5, 18, 4, '高空車課程');
const notices = mixed.run().filter(row => row.action === 'wouldMail');
assert.equal(notices.length, 2);
assert.equal(notices.find(row => row.category === '堆高機').usage, '堆高機課程');
assert.equal(notices.find(row => row.category === '高空工作車').usage, '高空車課程');
assert.equal(mixed.state.settingsReads, 1);
assert.equal(mixed.books.new2027.sheets[0].reads, 2);
assert.equal(mixed.sendCalls(), 0);
console.log('context 比較通過：讀取次數、輸出一致、跨操作更新、失敗復原、類別隔離及 dry-run。');
```
