# 網頁送出／PDF／Drive完整實測

- task_slug: submission-live-performance-20261104
- writer: Codex本對話；reviewers: Codex只讀探索／獨立審閱；lease_status: CLOSED（2026-11-05 依 -completion.md 完成交接結案；實測與審閱證據見該檔）
- 使用者授權：依建議補完整實測，涵蓋網頁送出、PDF產生與Drive保存；延續全權處理。
- 目標：實際計時完整前後端流程，確認PDF與Drive實體存在，報告測試環境、成功定義及限制，不以表單載入秒數代替。
- allowed_paths: 本檔、對應review、必要的scripts內獨立實測harness與系統暫存證據；尚不允許修改正式產品或共享設定。新增隔離Google測試資源須明確標示，只用專案帳號，保持私人／既有授權，不擴張存取、不建立觸發器。
- forbidden_actions: 不寫虛構正式檢查紀錄、不模擬使用者簽名、不通知真實主管／群組、不刪正式資料或文件、不改權限、不動他人dirty或部署lease；不Claude CLI與舊AGENT_LOG。
- 探索：先查來源是否已有test／dry-run入口、通知與簽核副作用、PDF與Drive邊界；缺少隔離能力時優先採正式來源的測試副本，而非改正式規則。
- 必跑驗證：當前固定版本與來源核對；精準鎖定同一requestId；實際後端處理與客戶端等待計時；成功回應、PDF非空／可讀與Drive實體readback；證據遮蔽token／個資，分清正式與隔離測試。
- stop_condition: 權限／登入缺失或無法隔離真實通知時，先完成可審查方案與無副作用部分，再說明具體阻礙；不得以mock秒數代替實測。

## 隔離執行決策

- 現有兩固定入口同為正式專案，無可用sandbox。Drive connector非專案帳號，改用已存在isha263命名授權；live userinfo符合專案帳號、兩固定入口v136、GCP現有admin憑證與Config SHA256 verifier符合；不登入新帳號／不擴張scope。
- allowed_paths追加：系統暫存中產生的獨立PerformanceProbe模組及暫時Main受admin保護POST橋接；只替換雲端Main及新增probe模組，正式本地產品不改，測完還原27模組HEAD與原v136前台部署。LINE既有部署全程不切版本。只有root可改雲端與執行Google寫入。
- prepare只建立私人獨立DB副本及私人archive root，保留正式歷史資料量以接近掃描成本；先清空副本訂閱名單，增加唯一PERF設備與TEST標記，原DB／根資料夾不改。
- 同runtime隔離必須揭露：共享ScriptLock與PublicSession nonce cache；不改正式ScriptProperties既有鍵。probe本身所有失敗在專用route捕捉並回傳，不落入doPost正式LAST_POST_ERROR_JSON。
- 每次只在已驗證probe state的專屬DB／root中執行，CONFIG暫存指向以finally還原；不允許任意caller傳資源ID。分享／主管通知由當次guard阻擋並統計；核心Submission／Pdf／Drive資料寫入與匯出函式保留真服務。
- 需清楚報告HTTP瀏覽器端到端與handler／文件／PDF階段，不將隔離實測稱作正式合規紀錄或正式站SLA；月檢送出及隔離測試批准分開。產出保留私人測試證據、不刪正式資料，不使用cleanupDate。

- 暫時候選已建：雲端Main新增專用admin驗證POST分支＋PerformanceProbe，保留26原模組；90分鐘到期、runId固定、測試DB/root只能由server建立並驗證私人／marker／不同正式ID。prepare只持短鎖保存初始化狀態，建立copy時不長占正式鎖。
- 原生PDF／Drive／主紀錄函式不換成mock；僅當次攔截分享與通知並以finally恢復。日檢及月檢採真PublicSession票證與正常模板項目；月檢批准只從本輪隔離clientID查token，不接受任意ID。verify/download只讀本輪唯一test紀錄與私人root下的PDF。
- reviewer P2已補正候選：admin驗證器移入probe catch；同時標記probeRequest，連ContentService等外層失敗也不寫正式LAST_POST_ERROR_JSON。私人資源檢查追加named editors/viewers都為0（只斷言、不修改ACL）。正式一般doPost錯誤診斷保留。
- 最終候選SHA256與獨立review一致；22支既有測試以實際暫時Main代理全過。Browser worker P2（外送前先checkpoint clientSubmissionId）已補正，root讀審並接受，語法通過。
