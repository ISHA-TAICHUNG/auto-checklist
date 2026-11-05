# 網頁送出／PDF／Drive 實測完成交接

- task_slug: submission-live-performance-20261104
- writer: Codex root；reviewer: Codex submission_path_audit（隔離方案）及 submission_test_isolation（完成證據）；lease_status: CLOSED
- 本檔為原 submission-live-performance-20261104.md 的最新完成交接，日期2026-11-05；不再持有產品、部署或測試writer lease。
- 原任務檔目前是iCloud dataless placeholder（有metadata，無本地內容）；精準下載及協調唯讀仍等待，沒有把它當不存在，也沒有覆寫未取回的內容。以本完成交接與output/submission-performance-20261104-results.json的CLOSED為本任務最新狀態。

## 完成證據

- 真實瀏覽器／Google服務實測日期：2026-11-04 10:30:24–10:31:41（台灣），11/05只做視覺與live收尾核對，未冒稱重新送出。
- 正式v136來源核心函式＋私人DB/Drive副本；副本保留1122筆歷史，新增TEST設備與TEST簽名，正常項目無照片，真實通知及公開分享刻意阻擋。
- 日檢click-to-success 14.850573s；月檢初送12.837960s（待簽Doc）；測試批准HTTP 9.801871s後最終PDF歸檔。
- 同ID日檢重送7.082746s，回同record/PDF，未建立另一筆紀錄；不把重送時間當新PDF速度。
- Google readback兩筆本輪紀錄、兩份非空私人PDF；日檢簽核略過、月檢已簽核歸檔，兩頁均有明確測試標記與可讀TEST影像。
- PDF頁面全數渲染並視覺檢查通過；pypdf中文逐字空白用正規化驗文字，非PDF內容錯誤；Poppler與PNG亦核對可讀。
- 11/05 live重新核對：兩固定入口v136／health ok；原deploymentConfig與entryPoints一致；HEAD27模組及不可變來源與測前逐位元一致，PerformanceProbe模組及action均不在現行來源。臨時v137不再被入口使用。
- 正式DB與原archive root沒有本輪假填報；所有新檢查／測試批准均在不同ID、owner-only且無具名editor/viewer的私人副本，沒有真LINE群發／主管通知。
- 一般doPost診斷規則已隨原Main還原；僅用過本輪Script Property及票證nonce／共享鎖，未變更LINE密鑰／正式設定／觸發器／權限。
- 正式本地產品與Git dirty保持，無stage／commit／push。22支暫時Main回歸與獨立審閱PASS；本輪沒有新增永久功能。

## 可讀成果

- output/submission-performance-20261104-results.json（safe聚合結果，無token／個資／存取URL）
- output/pdf/submission-performance-20261104-daily.pdf
- output/pdf/submission-performance-20261104-monthly.pdf
- 私有完整中介證據仍在系統暫存isha-submission-live-20261104-zprlocr4，目錄0700／私有檔0600；含Config或管理憑證的檔案不可公開或提交。

## 解讀限制

- 隔離HTTP耗時含管理驗證／資源查核／網路；原ScriptLock與PublicSession cache共用，不稱為獨立runtime或正式站SLA。
- 月檢待主管的真人等待時間未計入；未測真實通知送達、公開分享耗時及多張異常照片。
- 私人測試副本與測試PDF保留作查核；沒有刪正式資料，沒有使用cleanupDate。
- 無需使用者再登入或批准；本輪所需測試與還原已完成。
