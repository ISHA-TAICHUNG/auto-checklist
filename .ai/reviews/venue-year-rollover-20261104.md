# 115／116 年場地表銜接審閱

- reviewer：獨立 Codex /root/venue_reader；未使用 Claude CLI，未修改產品檔案。
- 程式審閱：PASS。Calendar.gs/.js一致；18組新測試、17項project-health、既有提醒runtime與收件政策回歸均獨立確認通過。
- 已修正P2：cache命中時仍須核對檔名年度；新增同context錯配同ID與正常跨年案例。
- 嚴格設定讀取、年度缺漏／壞JSON、來源／月份／日期錯誤均throw；context不會繞過年度；補充來源錯誤不被其他有課來源掩蓋。
- `used/content/reason` 相容；新增year／sources／version／needsReview為附加資訊。
- 臨時管理遷移：PASS。既有adminToken驗證後dispatch；私有helper；固定兩設定與兩筆分頁；apply先核對後寫入；preview/status唯讀；6組mock含部分寫入重跑通過。
- 部署器補強：guard字串必須存在且位於插點之前；finally移除臨時Main，成功／失敗均核對固定部署與entryPoints。現行基線的guard已人工核對存在。
- 正式完成仍以最終不可變版本、Main完整還原、26個其他模組雜湊及正式預覽／設定讀回為準；來源審閱PASS本身不是部署證據。

## 最終部署核對

- 獨立reviewer重算before／final：v128、27模組符合預期、只有Calendar改變、Main原版、其他26模組原樣，與本機Calendar.gs/.js雜湊一致；7個正式案例及configurationVerified=true，PASS。
- 主代理另做最終網路讀回：HEAD／不可變版本一致、固定entryPoints不變、正確帳號驗證、臨時action已拒絕；驗證完成。
