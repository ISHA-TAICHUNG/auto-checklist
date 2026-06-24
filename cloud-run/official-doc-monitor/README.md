# ISHA 公文待發文 Cloud Run 試行版

這個 Job 於 16:30、17:00 登入 Vital OD，抓取「待發文」清單，寫回 Apps Script 的 `公文待發文佇列`。LINE 通知仍由 Apps Script 依 `訂閱者清單` 的 `是否為同仁=是` 對應承辦人推播。

## 安全邊界

- Vital OD 帳密放 Secret Manager，不寫入 repo。
- Apps Script `apiToken` / `adminToken` 放 Secret Manager，不寫入 repo。
- Cloud Run 不持有 LINE Channel Access Token，也不直接發 LINE。
- 佇列只保存公文文號、發文字號、承辦人、限辦日期等最小資訊，不保存完整主旨與密碼/cookie。
- `DRY_RUN=true` 時只寫執行紀錄，不寫佇列、不發通知。
- `NOTIFY=false` 時只寫佇列，不立即通知；確認穩定後再設 `NOTIFY=true`。

## 本機 mock 測試

```bash
cd cloud-run/official-doc-monitor
npm test
MOCK_HTML_PATH=fixtures/wait-for-publish.html DRY_RUN=true npm start
```

## Cloud Run Job 建置概念

1. 在 Secret Manager 建立：
   - `vital-od-username`
   - `vital-od-password`
   - `isha-apps-script-api-token`
   - `isha-apps-script-admin-token`
2. 建置並推送容器到 Artifact Registry。
3. 建立 Cloud Run Job，設定 `TARGET_URL`、`APPS_SCRIPT_URL`、`*_SECRET`、`DRY_RUN=true`、`NOTIFY=false`。
4. 先手動執行 dry-run，確認 Apps Script `公文待發文執行紀錄` 有資料。
5. 改 `DRY_RUN=false`、`NOTIFY=false`，確認 `公文待發文佇列` 正確寫入。
6. 最後改 `NOTIFY=true`，再由 Cloud Scheduler 排 16:30 / 17:00 觸發。

## 重要提醒

正式啟用前請先確認 Vital OD 的使用條款、登入風控、是否有 2FA/CAPTCHA，以及貴單位是否允許以機器人方式查詢待發文清單。
