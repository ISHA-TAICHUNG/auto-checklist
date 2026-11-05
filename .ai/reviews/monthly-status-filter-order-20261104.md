# 月檢紀錄篩選順序：獨立 Codex 審閱

- task_slug: monthly-status-filter-order-20261104。
- reviewer: Codex settings_reviewer；產品及正式測試唯一 writer 為父代理。
- 結論：**PASS**。未發現需要修正的 P0／P1／P2；等價性限於下述正常資料與已揭露的例外邊界。
- 本 reviewer 只新增此檔，未改產品或正式測試、未改 CLOSED review、未部署、未發送訊息、未寫正式資料。

## 來源與安全性

1. 與公開基線 `63312914a10d4fe420102e3caefc22708a21da17` 比對，MonthlySafetyPpe.gs 的產品差異確實只有同一 if 條件的移序；.gs／.js 逐位元相同。
2. `MonthlySafetyPpe.gs:549` 的必要欄位檢查、targetMonth、迴圈範圍及變數初值未動。`570`–`572` 先用原本相同的 String／trim 型別與類別條件，再呼叫原月份 helper。
3. 對一般 Google Sheets 回傳值與有效日期／時區，月份 helper 只計算月份、不寫資料；略過已確定不相關的列不影響相關紀錄的順序或內容。
4. `574`–`583` 的 submitted、核准證據、完成早退及最後符合列的 pendingStatus 保留。沒有改月份歸屬、實際檢查日期、批准證據、提醒去重或通知政策。
5. 沒有新 cache、跨操作狀態或新的資料讀取方式。測試中舊／新 job 均只讀取一次填報紀錄。

## 等價邊界與故障注入

- 這不是「任意例外下完全等價」：非每月或其他類別列的獨立月份 Date 現在不會呼叫格式化。該不相關列原本若引發格式化服務例外，現在會在格式化前被排除；此差異已由任務明確揭露。
- reviewer 另以記憶體故障注入確認：針對特定不相關月份 Date 強制格式化拋錯，舊順序會拋錯、新順序直接略過；相關每月／同類別列的相同例外仍會拋出。
- 同一故障注入也確認實際試算表 IO 拋錯在兩版本都維持失敗；沒有把讀取錯誤當成空資料或已完成。六個必要欄位缺失仍在篩選前失敗。
- 舊日期 fallback 與無效日期的既有 helper 行為未改；候選仍使用原 helper，沒有額外猜測或修補紀錄。

## 測試是否執行真正候選

- `scripts/test-monthly-status-filter-order.js:24` 直接把實際來源設為 candidate，沒有為候選補 patch；只有 baseline 在記憶體還原舊順序。
- 正式新測試使用真實 monthlyReminderJob_ 與 checklistStatusCategorySummary_。900 筆日檢、100 筆月檢、5 類別、3 個月份的結果及狀態摘要 JSON 完全相同，維持 18 個 job 結果與 15 個摘要。
- 月份解析計數為 15000→300，日期格式化為 21791→341。狀態 JSON SHA-256：`1fcd353c81c969997c31e375a5271feed92fe24b40defd2254765f261baa0e72`。
- 另外的正常／舊版資料案例涵蓋字串與 Date 月份、缺少獨立月份欄位的舊日期 fallback、無效日期，以及六個必要欄位缺失。

## 獨立執行

| 驗證 | 結果 |
| --- | --- |
| `node scripts/test-monthly-status-filter-order.js` | PASS，計數與 JSON 一致 |
| `node scripts/test-monthly-inspection-policy.js` | PASS，17 組月檢、跨月歸屬、批准與升級案例 |
| `node scripts/test-daily-recipient-policy.js` | PASS，8 組通知政策，無真實傳輸 |
| `node scripts/test-project-health.js` | PASS，17 組健康回歸 |
| `node scripts/check-apps-script-sync.js` | PASS，Config 正式值按既有規則排除 |
| 不相關格式化／相關格式化／IO 錯誤故障注入 | PASS，邊界與任務描述一致 |

### 記憶體 mutation

- 移除表單型別條件：新測試拒絕，來源結構 guard 要求重新審閱未知條件形狀。
- 移除類別條件：新測試拒絕，來源結構 guard 同上。
- 恢復月份先解析的舊順序：來源 guard 允許作為已知形狀，但候選實際仍解析 15000 次，因此被 300 次斷言拒絕，證明測試沒有偷偷替候選補上新順序。

## 發布與效能表述

- 可在最新雲端來源與固定部署版本重新核對後，只替換 MonthlySafetyPpe，保留其餘 26 個模組；不從共享目錄整包覆寫。
- 98% 是合成 fixture 的月份解析次數減少，不是正式 LINE 整體耗時的減少比例，也不保證固定回覆秒數。
- 本輪未做原生 LINE 操作、正式提醒、填報或 PDF／Drive 外部驗證；發布後仍需由 writer 核對實際狀態內容與回覆時間。
