# 課表使用者字詞定義審閱

- reviewer：獨立Codex /root/venue_reader；主代理唯一writer；未使用Claude CLI，未修改產品檔。
- 程式PASS：27組課表／年度測試、17項project-health、提醒runtime及8項收件政策回歸獨立通過，.gs/.js相同、目標diff格式檢查通過。
- 逐格非操作／占空間優先；固定式總與吊掛保留專頁判定；正常簡寫、預暫及跨日重名不形成停用；未回答混合活動／工程邊界保留。
- 已補P2一致性：獨立高空分頁也排除沒有高空字樣的高機／堆高機；對照混合課程和明確高空仍可用。
- 唯讀preview helper PASS：schema與日期先驗、1至4例／3類別限制、無寫入／通知／觸發器；私有helper在既有admin驗證後dispatch；記憶體正反例及同類設備重用確認。
- 部署器PASS：以最新v129保留Config/Main/Reminder效能改動；兩固定入口scope gate；首個PUT前核HEAD與各config／entryPoints；每入口版本讀回；finally完整還原Main，最終只有Calendar可不同；health及臨時action拒絕逐URL驗證。
- 審閱是來源與方案證據；正式完成另以本輪不可變版本、27模組雜湊及實際唯讀案例／網路讀回為準。

## 發布後獨立驗收

- reviewer重新計算before／rollout：PASS。最終v131以v129為基線，Actual=Expected共27模組，僅Calendar變動；其餘26模組相同，Main／Config／Reminder完整保留。
- Calendar與本機.gs/.js一致；15正式指定日期案例、2固定入口、success及finalNetworkVerified均核對為成功。
- 主代理網路驗證含兩入口個別版本／entryPoints、health、臨時action拒絕；臨時Main已移除。無原課表或通知設定寫入。
