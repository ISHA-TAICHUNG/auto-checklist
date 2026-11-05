# 網頁送出／PDF／Drive 隔離實測：獨立 Codex 審閱

- task_slug: submission-live-performance-20261104。
- reviewer: Codex submission_path_audit；產品／候選唯一 writer 為父代理 root。
- 最終結論：**PASS（初審兩項必要補強已完成）**。未發現這個限定隔離實測方案尚須修正的 P0／P1／P2。
- 本 reviewer 只新增本檔；未改產品、候選、正式測試或任務檔，未讀 private-admin.json／完整正式 Config，未接觸認證、Google API、部署或外送訊息。

## 審閱對象

- 已讀更新 task contract、實際暫存 Main-probe.gs／PerformanceProbe.gs，以及需要核對的公開 Main、Submission、Pdf、Drive、PublicSession、Config helper 與通知直連來源。
- Main 相對 workspace 差異限於專用 probe 分支與該分支的正式診斷防護；正常 POST 的既有分流保留。
- 最終候選 SHA-256：
  - Main-probe.gs：`1a8c30dce263bfbfe4252e1ead241ea0a9da18fd6a550a1bf43a95f5533c82f2`。
  - PerformanceProbe.gs：`f46ad4a59431ef2fb76a8ffc595aff89e4b1bf7e693f5299ec5e598499d77f46`。
- 發布時仍須由 writer 核對此候選與新鮮正式來源；本 PASS 不等同已發布或已完成 Google 實測。

## 初審必要補強及關閉證據

1. **P2：admin 驗證器在 probe catch 外，可能覆寫正式錯誤診斷。** 原候選的 checkAdminToken_ 在內層 try 之前，驗證服務例外可進入 doPost 原 catch。Writer 已將驗證及 delete 放到 probe try，並以每次 doPost 的 submissionPerfRequest 旗標保護外層 LAST_POST_ERROR_JSON 寫入。獨立注入驗證器例外、連續輸出層例外均不再寫正式診斷；一般 POST 失敗仍照原行為寫入。
2. **P2：私人分享模式不足以單獨證明沒有具名編輯者／檢視者。** Writer 已新增 submissionPerfIsPrivate_，要求 Access.PRIVATE 且 getEditors／getViewers 皆為空；prepare、新操作前檢查與 PDF readback 均使用同一斷言。獨立具名 editor／viewer 注入均被拒絕，只有 owner 的 fixture 通過。沒有為了通過而修改 ACL。

## 已確認的安全邊界

1. 專用 POST 先通過既有 checkAdminToken_；未授權即回覆失敗。全部 probe 函式以下劃線結尾，沒有新增匿名一般 submit 的 test 參數或公開 RPC。
2. runId 固定且有 90 分鐘到期門檻；錯誤 runId／過期在 prepare 之前拒絕。caller 不能指定 DB、archive root 或任意待批准 record。
3. prepare 僅依 server CONFIG 的原 DB 建副本，另建新 archive root；先檢查新 root 的私人條件，再 copy DB 並檢查。清空的是副本訂閱表，新增的是副本 PERF 設備／TEST 抬頭；不改原 DB。
4. 每次使用前檢查 state ready／runId、測試資源 ID 與原／目前正式 ID 不同、資源名稱 marker 及私人斷言。bootstrap 直接 getFormMeta_，避免正式 public meta cache 的 DB key 缺口。
5. submissionPerfWithResources_ 僅當次置換 CONFIG DB／root；拒絕承接現成 settings scope，並在 finally 恢復 CONFIG 與全部通知、分享、計時 wrapper。沒有修改正式 LINE token／既有 Script Properties 鍵。
6. 正常模板、signature 格式、PublicSession 真票證、鎖內模板／異常鎖定、原 handleSubmission_／handleApprovalSubmission_ 仍執行。只接受測試設備、效能測試標記、指定 form 與正常結果／無照片。
7. 分享及主管通知由當次 guard 回傳未執行並計數；LINE 原始 push／multicast／reply guard 拒絕並記錄。即使內層函式吞掉外送例外，scope 結束的 rawTransportAttempts 仍令 probe 失敗。
8. 月檢批准僅從本輪 PERF 設備及 clientSubmissionId 的唯一紀錄取 recordId／token，不採用 caller 的任意批准目標。核心批准仍檢查狀態與簽核 token。
9. verify／download 僅取本輪唯一紀錄的 PDF，檢查檔案未 trash、PDF MIME、私人條件及父系位於 test root。verify 另讀真 blob，要求非空且以 `%PDF-` 起始；download 有大小上限。
10. 主動建立的 Script Property 僅使用本輪專屬 state key。既有共享 ScriptLock／PublicSession nonce cache 沒有被宣稱成獨立 runtime，這項差異已記錄在 task。

## 獨立執行結果

以下全部在 Node 記憶體 mock／來源代理執行，沒有真正 Google 寫入或外送：

| 驗證 | 結果 |
| --- | --- |
| 未授權 probe | PASS，沒有 state 或正式診斷寫入 |
| admin 驗證器拋錯 | PASS，沒有 LAST_POST_ERROR_JSON 寫入 |
| ContentService 輸出層在內外 catch 持續拋錯 | PASS，正式診斷未寫入 |
| 一般非 probe POST 失敗 | PASS，保留原正式診斷寫入 |
| 成功 callback 的 DB／root、分享／通知 guard、計數 | PASS，finally 恢復全部原值／函式 |
| callback 例外及吞掉原始 transport 拒絕 | PASS，仍失敗並恢復全部原值／函式 |
| 已存在 settings scope | PASS，在切換資源前拒絕並恢復 |
| 具名 editor／viewer、正式 DB ID | PASS，全部拒絕 |
| 無效 submit PublicSession 票證 | PASS，真 handler 呼叫為零，只有 probe 專屬 state key 可寫 |
| 錯誤 runId／過期 | PASS，prepare 前拒絕且無寫入 |
| 現有 test-main-auth-routing.js 載入真正 Main 候選 | PASS |
| 現有 test-project-health.js 載入真正 Main 候選 | PASS，17 組 |

### 記憶體 mutation

- 移除外層正式診斷 guard 後，輸出層故障會寫 LAST_POST_ERROR_JSON，故障注入能辨識該回歸。
- 移除 editor／viewer 斷言後，具名 editor fixture 會被接受，故障注入能辨識該回歸。
- 候選未被這些 mutation 改寫；全部替換只存在於各次 VM 字串。

## 實測與收尾仍須由 writer 完成

- 本 PASS 只核可候選與隔離邊界。尚未用此 probe 建資源、送表單、匯 PDF 或讀真 Drive，不能據此聲稱實測成功。
- browser HTTP 端到端包括 admin／隔離身分檢查、額外正常值檢查；handlerMs 也包括 callback 內票證與驗證。因此應標示隔離測試時間，不能當成正式站 SLA 或純 handleSubmission_ 時間。
- documentCreateMs／pdfExportMs／recordAppendMs 來自真函式 wrapper；分享與通知被刻意抑制，不能把 suppressed 計數視為通知已送出，也不能宣稱正式連結分享路徑經實送驗證。
- 月檢初次成功只有待簽 Doc；取得隔離批准後真 PDF／Drive readback 才能報月檢完整歸檔完成。測試簽名圖應是明示非人工簽名的 TEST 標記。
- 測完應核對／還原原 27 模組 HEAD 與前台原 v136 部署，LINE 固定入口維持原版本；發生正式來源漂移時，先查明再還原，不覆蓋別人的接續變更。
