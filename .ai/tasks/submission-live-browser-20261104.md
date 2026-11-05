# 隔離實測瀏覽器harness

- task_slug: submission-live-browser-20261104
- writer: Codex probe_browser_driver子代理；reviewer: root；lease_status: CLOSED（root已審閱接受並接手執行）（root P2送出前request ID補強完成）
- allowed_paths: 系統暫存isha-submission-live-20261104-zprlocr4/browser_probe.cjs；本任務檔。
- forbidden_actions: 不改workspace產品／測試、不能部署或執行任何Google寫入，不讀credentials或private-admin／完整sources；僅建立未執行的harness由root審查執行，不發訊息。
- 驗收：實際daily/monthly頁、私密context從runtime環境讀、攔截只把API呼叫轉送受admin保護的隔離probe，真實HTTP response，TEST marker簽名、正常項目，分別記錄submit及月檢approval，取得safe結果；不印token／URL／個資。
- stop_condition: 提交腳本語法與設計，RELEASED給root；不得自行用實際context執行。

## 交付

- 僅建立指定系統暫存browser_probe.cjs；未讀任何真context或credentials、未執行瀏覽器／Google請求。node --check PASS。
- 真daily/monthly Pages，GAS bootstrap／submit由Node攔截轉送受admin保護probe，正常publicSession GET仍走實際服務；候選不mock回覆、不加cache-control extra headers。
- 真radio／方法checkbox操作、inspector明示效能測試、滑鼠筆劃TEST簽名；日檢／月檢load與送出、HTTP與handler時段分開；月檢先pendingDoc，再用approveRecord票證與TEST標記批准。
- 增加日檢同clientSubmissionId＋同payload的新票證重送，要求原recordId及fileUrl相同，單獨記duplicateReplaySeconds，不列為新PDF速度。verify要求本run兩列、兩個非空private PDF、均在test root，月檢readback已簽核歸檔。
- 只寫whitelist safe JSON和自畫TEST canvas PNG，不把token／URL／原payload／錯誤stack寫入輸出；管理token僅Node request body，沒有放page JS或localStorage。
- 不自動重送不確定的submit／approve；若outputDir已有browser-results.json，啟動即停止並保留舊證據，須由root先讀回調和後再決定重跑。
- 使用：PROBE_CONTEXT_FILE=<由root建立的私有context.json> node <指定browser_probe.cjs>；CHROME_BIN可選，預設系統Chrome。

- root P2補正：取得真實clientSubmissionId後立即存入metrics.clientSubmissionId並checkpoint，位於首次await route.fetch之前。即使網路不確定，仍有發出前確切ID可調和；不保存票證／原payload。node --check再PASS，未執行真請求。
