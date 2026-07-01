/**
 * ===== Web App 入口（純 JSON API 模式）=====
 *
 * 部署為 Web App 後（執行身分=自己、存取權=任何人），前端（GitHub Pages）
 * 透過下列 endpoints 呼叫：
 *
 *   GET  ...exec?api=health
 *   GET  ...exec?api=equipments               — 設備清單
 *   GET  ...exec?api=meta&form=...&eqp=...    — 檢查表模板
 *   GET  ...exec?api=branding                  — 機構名稱（前端啟動載入）
 *   GET  ...exec?api=dailyIncidentPeople&token=API_TOKEN — 日常事件人員下拉選項（不含 LINE ID）
 *   GET  ...exec?api=dailyWorkMeta             — 每日作業檢核填寫頁設定
 *   GET  ...exec?api=approval&recordId=...&token=... — 主管簽核頁讀取待簽資料
 *   GET  ...exec?api=status                    — 系統狀態（不含 secret）
 *   GET  ...exec?api=admin&action=...&token=...  — 管理用，需 token
 *
 *   POST ...exec   body={ apiToken, formType, equipmentId, ... }
 *   POST ...exec   body={ apiToken, action:'approveRecord', recordId, token, ... }
 *
 * doPost 強制驗證 apiToken；body 必須是 JSON 字串（前端用 fetch + Content-Type
 * text/plain 送出，避開 Apps Script 對 application/json preflight 的限制）。
 */

function doGet(e) {
  const api = (e && e.parameter && e.parameter.api) || 'health';

  try {
    if (e && e.parameter && e.parameter.page) {
      switch (e.parameter.page) {
        case 'approve':
          return approvalPageResponse_(e);
        case 'incident-update':
          return dailyIncidentUpdatePageResponse_(e);
        case 'incident-comment':
          return dailyIncidentCommentPageResponse_(e);
        case 'incident-approve':
          return dailyIncidentApprovalPageResponse_(e);
        case 'monthly-ppe-confirm':
          return monthlyPpeConfirmPageResponse_(e);
      }
    }

    let result;
    switch (api) {
      case 'health':
        result = { ok: true, name: 'auto-checklist-api', version: '1.0' };
        break;

      case 'equipments':
        result = { ok: true, equipments: getEquipmentList_() };
        break;

      case 'meta': {
        const form = e.parameter.form;
        const eqp = e.parameter.eqp;
        if (!form || !eqp) throw new Error('需提供 form 與 eqp 參數');
        result = { ok: true, meta: getFormMeta_(form, eqp) };
        break;
      }

      case 'lockedItems': {
        // 取「特定設備 + 特定表單類型」尚未處理完成的異常項
        // 前端用此鎖定 row（只能選異常）+ 帶入上次異常說明
        const form = e.parameter.form;
        const eqp = e.parameter.eqp;
        if (!form || !eqp) throw new Error('需提供 form 與 eqp 參數');
        result = { ok: true, locked: getLockedItemsForEquipment_(eqp, form) };
        break;
      }

      case 'status':
        // 公開版只回最小資訊（避免 codex P2: 洩漏內部 ID）
        // 完整診斷請在 Apps Script 編輯器執行 getSystemStatus_() 查看
        result = {
          ok: true,
          version: '1.0',
          timeZone: tz_(),
          name: 'auto-checklist-api',
        };
        break;

      case 'branding':
        result = { ok: true, organizationName: getOrgHeader_() };
        break;

      case 'dailyWorkMeta':
        result = getDailyWorkMeta_();
        break;

      case 'dailyIncidentPeople':
        if (e.parameter.token !== CONFIG.API_TOKEN) throw new Error('未授權');
        result = getDailyIncidentPeopleOptions_();
        break;

      case 'approval': {
        const recordId = e.parameter.recordId;
        const token = e.parameter.token;
        if (!recordId || !token) throw new Error('需提供 recordId 與 token');
        result = getApprovalSummary_(recordId, token);
        break;
      }

      case 'admin': {
        // 維護動作 — 兩層 token：
        //   - admin 入口先過 API_TOKEN 外層檢查，再依 action 要求 ADMIN_TOKEN
        //   - 公開前端 API_TOKEN 不能單獨授權 admin diagnostics
        // 安全分層由 codex review 2026-05-26 觸發加入
        if (e.parameter.token !== CONFIG.API_TOKEN) throw new Error('未授權');
        const action = e.parameter.action;
        // 寫入類 actions 白名單 — 這些必須額外用 ADMIN_TOKEN
        // codex 2026-05-26 round 2 P1.2: fetchPdf 雖唯讀但回 PDF binary（含簽名/姓名）→ 升級成需 ADMIN_TOKEN
        const WRITE_ACTIONS = ['formatSheets', 'runInit', 'applyDropdowns',
                               'setEquipmentField', 'addPpe', 'setLineProps',
                               'testLineIncident', 'markCompleted', 'fetchPdf',
                               'addMonthlySafetyPpeForms', 'addAerialWorkPlatform',
                               'syncSupervisorIds',
                               'syncSubscribers', 'supervisorStatus', 'subscriberStatus',
                               'updateMonthlySettingNotes',
                               'applyProjectResourceNames', 'installRichMenu',
                               'deleteRichMenu', 'richMenuStatus', 'richMenuHealth',
                               'lineWebhookHealth', 'lineTargetStatus', 'lineQuotaStatus',
                               'syncLineWebhookEndpoint',
                               'openIssues', 'reminderStatus',
                               'systemStatus', 'archiveWriteHealth', 'lastPostError',
                               'dailyReminderTriggerStatus',
                               'installDailyReminderTrigger',
                               'installDailyWorkCheckTriggers',
                               'sheetInventory',
                               'generateMonthlyPpeSummary', 'monthlyPpeSummaryReminder',
                               'monthlyPpeConfirmationPreview',
                               'resendApprovalRequest',
                               'pendingApprovalStatus', 'pendingApprovalReminder',
                               'setupOfficialDocumentMonitor',
                               'processOfficialDocumentQueue',
                               'officialDocumentSnapshot',
                               'resendOfficialDocumentSnapshot'];
        // 破壞性 actions — 需 ADMIN_TOKEN + ALLOW_DESTRUCTIVE_HTTP=YES kill switch
        const DESTRUCTIVE_ACTIONS = ['cleanupAll', 'cleanupDate', 'cleanupOfficialDocumentMonitor'];
        if (WRITE_ACTIONS.indexOf(action) >= 0 || DESTRUCTIVE_ACTIONS.indexOf(action) >= 0) {
          if (!checkAdminToken_(e.parameter.adminToken)) {
            throw new Error('未授權：此 action 需 adminToken（Script Properties ADMIN_TOKEN）');
          }
        }
        if (DESTRUCTIVE_ACTIONS.indexOf(action) >= 0 && destructiveActionWillDelete_(action, e.parameter) && !destructiveHttpAllowed_()) {
          throw new Error('未授權：破壞性 action 預設禁止 HTTP 呼叫，請在 Apps Script 編輯器手動執行函式（或設 Script Property ALLOW_DESTRUCTIVE_HTTP=YES）');
        }
        switch (action) {
          case 'formatSheets': {
            // 重新套用欄寬與換行設定（idempotent）
            applyColumnWidthsAndWrap_();
            result = { ok: true, action, message: 'column widths applied' };
            break;
          }
          case 'runInit': {
            // Schema migration helper — 從外部觸發 initializeDatabase
            // 安全性：受 ADMIN_TOKEN 限制 + initializeDatabase 是 idempotent
            // (重複跑不會破壞既有資料，setupSheet_ 對既有表只補缺欄位)
            initializeDatabase();
            result = { ok: true, action, message: 'initializeDatabase 執行完成' };
            break;
          }
          case 'applyDropdowns': {
            // 統一各設定表的選項欄位下拉 + 把 TRUE/FALSE 改成 是/否
            // idempotent，重複跑無害
            const summary = applyChineseSettingsAndDropdowns();
            result = { ok: true, action, summary };
            break;
          }
          case 'setEquipmentField': {
            // 改設備清單某列的某欄位
            // 例：?action=setEquipmentField&eqp=VENUE-CRANE&field=所在位置&value=三樓
            const eqp = e.parameter.eqp;
            const field = e.parameter.field;
            const value = e.parameter.value;
            if (!eqp || !field) throw new Error('需提供 eqp 與 field');
            const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
            const sh = ss.getSheetByName('設備清單');
            const data = sh.getDataRange().getValues();
            const headers = data[0];
            const idCol = headers.indexOf('設備代號');
            const fldCol = headers.indexOf(field);
            if (idCol < 0) throw new Error('設備清單缺「設備代號」欄');
            if (fldCol < 0) throw new Error('找不到欄位：' + field);
            let updated = 0;
            for (let i = 1; i < data.length; i++) {
              if (String(data[i][idCol]) === eqp) {
                sh.getRange(i + 1, fldCol + 1).setValue(value || '');
                updated++;
              }
            }
            result = { ok: true, action, eqp, field, value, updated };
            break;
          }
          case 'addPpe': {
            // 加防護具檢點 template + 2 個項目 + 2 個場地（VENUE-CRANE / VENUE-FORK）
            const summary = addPpeTemplatesAndEquipments();
            result = { ok: true, action, summary };
            break;
          }
          case 'addMonthlySafetyPpeForms': {
            // 加龍井/復興/忠明量測設備及 PPE 月檢；SCBA 併入三張表下方區塊
            const summary = addMonthlySafetyPpeForms();
            result = { ok: true, action, summary };
            break;
          }
          case 'addAerialWorkPlatform': {
            // 加/修高空工作車車載式與自走式日檢模板、設備與場地關鍵字
            const summary = addAerialWorkPlatformTemplatesAndEquipment();
            result = { ok: true, action, summary };
            break;
          }
          case 'setLineProps': {
            // 設 LINE 推播相關 Properties（從 ISHA-bot 那邊複製過來）
            // 用 doPost 傳 JSON body 比較安全（不會在 URL 中曝露 token）
            // 但 admin 一律走 doGet，這裡接受 URL params 也 OK（admin 半公開 trade-off）
            const props = PropertiesService.getScriptProperties();
            const updates = {};
            ['LINE_CHANNEL_ACCESS_TOKEN','LINE_CHANNEL_SECRET',
             'LINE_TARGET_GROUP_ID','LINE_TARGET_USER_IDS','LINE_ADMIN_USER_IDS',
             'SUPERVISOR_USER_IDS',
             'INCIDENT_SHEET_URL'].forEach(k => {
              if (e.parameter[k] !== undefined) updates[k] = e.parameter[k];
            });
            if (Object.keys(updates).length === 0) {
              throw new Error('需提供至少一個 LINE_* property');
            }
            props.setProperties(updates, false);
            result = { ok: true, action, set: Object.keys(updates) };
            break;
          }
          case 'syncSupervisorIds':
          case 'syncSubscribers': {
            result = {
              ok: true,
              action,
              ...syncSupervisorIdsToSheet_(),
            };
            break;
          }
          case 'supervisorStatus':
          case 'subscriberStatus': {
            result = {
              ok: true,
              action,
              ...getSupervisorStatus_(),
            };
            break;
          }
          case 'updateMonthlySettingNotes': {
            result = {
              ok: true,
              action,
              ...updateMonthlySettingNotes_(),
            };
            break;
          }
          case 'applyProjectResourceNames': {
            result = {
              ok: true,
              action,
              ...applyProjectResourceNames(),
            };
            break;
          }
          case 'installRichMenu': {
            result = {
              ok: true,
              action,
              ...installDefaultLineRichMenu(),
            };
            break;
          }
          case 'deleteRichMenu': {
            result = {
              ok: true,
              action,
              ...deleteInstalledLineRichMenu(),
            };
            break;
          }
          case 'richMenuStatus': {
            result = {
              ok: true,
              action,
              ...getLineRichMenuStatus(),
            };
            break;
          }
          case 'richMenuHealth': {
            result = {
              ok: true,
              action,
              ...getLineRichMenuHealth_(),
            };
            break;
          }
          case 'lineWebhookHealth': {
            result = {
              ok: true,
              action,
              ...getLineWebhookHealth_(),
            };
            break;
          }
          case 'lineTargetStatus': {
            const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
            const subscriberIds = (typeof getLineSubscriberUserIds_ === 'function') ? getLineSubscriberUserIds_() : [];
            const legacyTargetUserCount = cfg ? Array.from(new Set(cfg.userIds || [])).length : 0;
            const supervisorIds = (typeof getSupervisorUserIds_ === 'function') ? getSupervisorUserIds_() : [];
            const supervisorTargetCount = Array.from(new Set(supervisorIds || [])).length;
            result = {
              ok: true,
              action,
              hasLineConfig: Boolean(cfg),
              legacyHasGroupTarget: Boolean(cfg && cfg.groupId),
              legacyTargetUserCount,
              subscriberTargetCount: Array.from(new Set(subscriberIds || [])).length,
              supervisorTargetCount,
              notifyMode: 'subscriber-list',
            };
            break;
          }
          case 'lineNotificationTargetStatus': {
            const columns = (typeof LINE_NOTIFICATION_COLUMNS !== 'undefined') ? LINE_NOTIFICATION_COLUMNS : {};
            const targets = {};
            Object.keys(columns).forEach(key => {
              const col = columns[key];
              const ids = (typeof getLineSubscriberUserIds_ === 'function')
                ? getLineSubscriberUserIds_({ notificationColumn: col, forceRefresh: true })
                : [];
              targets[col] = Array.from(new Set(ids || [])).length;
            });
            const allIds = (typeof getLineSubscriberUserIds_ === 'function')
              ? getLineSubscriberUserIds_({ forceRefresh: true })
              : [];
            result = {
              ok: true,
              action,
              notifyMode: 'subscriber-list-explicit-opt-in',
              subscriberTargetCount: Array.from(new Set(allIds || [])).length,
              notificationTargetCounts: targets,
            };
            break;
          }
          case 'lineQuotaStatus': {
            result = {
              ok: true,
              action,
              ...getLineMessageQuotaStatus_(),
            };
            break;
          }
          case 'syncLineWebhookEndpoint': {
            result = {
              ok: true,
              action,
              ...setLineWebhookEndpointToCurrent(),
            };
            break;
          }
          case 'testLineIncident': {
            // 測試異常通報 LINE 是否正常推（內部 try 包，回傳完整錯誤訊息給 admin）
            try {
              const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
              const diagnose = {
                hasGetLineConfig: typeof getLineConfig_ === 'function',
                hasSendIncidentAlert: typeof sendIncidentAlert_ === 'function',
                token: cfg ? (cfg.token ? '✓ ' + cfg.token.substring(0, 8) + '...' : '✗ 缺') : '✗ cfg null',
                groupId: cfg ? (cfg.groupId || '(空)') : '?',
                userIds: cfg ? cfg.userIds : [],
                userIdsCount: cfg ? cfg.userIds.length : 0,
                incidentSheetUrl: PropertiesService.getScriptProperties().getProperty('INCIDENT_SHEET_URL') || '(空)',
              };
              let pushResult = null;
              if (cfg && cfg.token && typeof sendIncidentAlert_ === 'function') {
                pushResult = sendIncidentAlert_({
                  equipmentName: '【測試】堆高機 A 號',
                  category: '堆高機',
                  formType: '每日',
                  order: 3,
                  itemName: '【測試】煞車油是否足夠',
                  result: 'X',
                  description: '這是 testLineIncident 觸發的測試訊息',
                  photoCount: 0,
                  status: '待處理',
                  reportDate: '2026-05-22',
                  fileUrl: 'https://drive.google.com/file/d/test-fileid/view',
                });
              }
              result = { ok: true, action, diagnose, pushResult };
            } catch (innerErr) {
              // 移除 stack 回傳（codex review 2026-05-26）— 避免洩漏內部結構給拿到 ADMIN_TOKEN 的人
              Logger.log('[testLineIncident] 失敗: ' + innerErr + '\n' + (innerErr.stack || ''));
              result = { ok: false, action, error: String(innerErr.message || innerErr) };
            }
            break;
          }
          case 'markCompleted': {
            // 把指定設備所有未完成異常事件 批次改成「已完成」
            // (模擬承辦改狀態，主要 demo 用；實務建議在試算表手動改)
            const eqp = e.parameter.eqp;
            const form = e.parameter.form;  // 選填
            const summary = markIncidentsCompletedForEquipment_(eqp, form);
            result = { ok: true, action, summary };
            break;
          }
          case 'cleanupAll': {
            // 清掉所有填報紀錄 + 異常事件 + Drive PDF
            // ⚠ 不可逆（PDF 可救 30 天）
            // 修 P1.3: dryRun=1 也要 confirm=YES_DRY_RUN，實刪要 confirm=YES_DELETE_ALL
            //         避免 admin token 持有者亂打就能探勘紀錄筆數
            const dryRun = e.parameter.dryRun === '1';
            const confirm = e.parameter.confirm || '';
            if (dryRun && confirm !== 'YES_DRY_RUN' && confirm !== 'YES_DELETE_ALL') {
              throw new Error('cleanupAll dryRun 需帶 confirm=YES_DRY_RUN');
            }
            Logger.log('[cleanupAll] dryRun=' + dryRun + ' at ' + new Date().toISOString());
            const summary = cleanupAllSubmissionsAndIncidents_({ dryRun, confirm });
            result = { ok: true, action, dryRun, summary };
            break;
          }
          case 'cleanupDate': {
            // 清掉指定日期的所有測試資料（填報紀錄 + 異常事件 + Drive PDF）
            // ⚠ 一旦執行不可逆，PDF 進回收桶可救回 30 天
            // 修 codex P2.2 (round 2): 與 cleanupAll 對稱加 confirm 守衛
            //   - dryRun: 需 confirm=YES_DRY_RUN
            //   - 實刪: 需 confirm=YES_DELETE_DATE
            const dateStr = e.parameter.date;
            const dryRun = e.parameter.dryRun === '1';
            const confirm = e.parameter.confirm || '';
            if (!dateStr) throw new Error('需提供 date 參數 (YYYY-MM-DD)');
            if (dryRun && confirm !== 'YES_DRY_RUN' && confirm !== 'YES_DELETE_DATE') {
              throw new Error('cleanupDate dryRun 需帶 confirm=YES_DRY_RUN');
            }
            if (!dryRun && confirm !== 'YES_DELETE_DATE') {
              throw new Error('cleanupDate 實刪需帶 confirm=YES_DELETE_DATE');
            }
            Logger.log('[cleanupDate] date=' + dateStr + ' dryRun=' + dryRun + ' at ' + new Date().toISOString());
            const summary = cleanupTestDataForDate_(dateStr, { dryRun });
            result = { ok: true, action, date: dateStr, dryRun, summary };
            break;
          }
          case 'openIssues': {
            // 唯讀：列出狀態 != 已完成 & != 不處理 的異常事件
            result = { ok: true, ...listOpenIncidents_() };
            break;
          }
          case 'reminderStatus': {
            // 唯讀：跑 dailyReminderJob 的 dry-run，看當日各設備狀態（不寄信）
            const targetDate = e.parameter.date ? parseISODate_(e.parameter.date) : undefined;
            const results = dailyReminderJob({ dryRun: true, today: targetDate });
            result = { ok: true, dryRun: true, count: results.length, results };
            break;
          }
          case 'systemStatus': {
            const status = getSystemStatus_();
            result = {
              ok: true,
              action,
              timeZone: status.timeZone,
              triggers: status.triggers,
              counts: status.counts,
              archive: { ok: status.archive && status.archive.ok },
              venue: { ok: status.venue && status.venue.ok, title: status.venue && status.venue.title },
              settings: {
                webFrontendUrl: status.settings && status.settings.webFrontendUrl,
                webAppUrl: status.settings && status.settings.webAppUrl,
                monthlyCheckWindowStart: status.settings && status.settings.monthlyCheckWindowStart,
                monthlyCheckWindowEnd: status.settings && status.settings.monthlyCheckWindowEnd,
                monthlyReminderStartDay: status.settings && status.settings.monthlyReminderStartDay,
                dailyWorkCheckEnabled: status.settings && status.settings.dailyWorkCheckEnabled,
              },
            };
            break;
          }
          case 'archiveWriteHealth': {
            try {
              const root = getArchiveRootFolder_();
              const blob = Utilities.newBlob(
                'archive write health ' + Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
                'text/plain',
                '_archive_write_health.txt'
              );
              const file = root.createFile(blob);
              const fileId = file.getId();
              file.setTrashed(true);
              result = {
                ok: true,
                action,
                archiveRootName: root.getName(),
                createdAndTrashed: true,
                fileIdMasked: String(fileId).substring(0, 6) + '...',
              };
            } catch (innerErr) {
              result = { ok: false, action, error: String(innerErr.message || innerErr) };
            }
            break;
          }
          case 'lastPostError': {
            let parsed = null;
            try {
              const raw = PropertiesService.getScriptProperties().getProperty('LAST_POST_ERROR_JSON') || '';
              parsed = raw ? JSON.parse(raw) : null;
            } catch (_) {}
            result = { ok: true, action, lastPostError: parsed };
            break;
          }
          case 'dailyReminderTriggerStatus': {
            const triggers = ScriptApp.getProjectTriggers()
              .filter(t => t.getHandlerFunction() === 'dailyReminderJob')
              .map(t => ({
                handler: t.getHandlerFunction(),
                type: String(t.getEventType()),
              }));
            result = {
              ok: true,
              action,
              expectedHour: CONFIG.REMINDER_TRIGGER_HOUR,
              count: triggers.length,
              triggers,
            };
            break;
          }
          case 'installDailyReminderTrigger': {
            installDailyReminderTrigger();
            const triggers = ScriptApp.getProjectTriggers()
              .filter(t => t.getHandlerFunction() === 'dailyReminderJob')
              .map(t => ({
                handler: t.getHandlerFunction(),
                type: String(t.getEventType()),
              }));
            result = {
              ok: true,
              action,
              expectedHour: CONFIG.REMINDER_TRIGGER_HOUR,
              count: triggers.length,
              triggers,
            };
            break;
          }
          case 'installDailyWorkCheckTriggers': {
            result = installDailyWorkCheckTriggers();
            break;
          }
          case 'sheetInventory': {
            result = {
              ok: true,
              action,
              ...getDatabaseSheetInventory_(),
            };
            break;
          }
          case 'generateMonthlyPpeSummary': {
            result = {
              ok: true,
              action,
              ...generateMonthlyPpeSummary_({
                year: e.parameter.year,
                month: e.parameter.month,
                rocYear: e.parameter.rocYear,
              }),
            };
            break;
          }
          case 'monthlyPpeSummaryReminder': {
            const targetDate = e.parameter.date ? parseISODate_(e.parameter.date) : undefined;
            result = {
              ok: true,
              action,
              dryRun: String(e.parameter.dryRun || '').toLowerCase() === 'true' || e.parameter.dryRun === '1',
              ...monthlyPpeSummaryReminderJob({
                dryRun: String(e.parameter.dryRun || '').toLowerCase() === 'true' || e.parameter.dryRun === '1',
                today: targetDate,
              }),
            };
            break;
          }
          case 'monthlyPpeConfirmationPreview': {
            const month = monthlyPpeResolveMonth_({
              year: e.parameter.year,
              month: e.parameter.month,
              rocYear: e.parameter.rocYear,
            });
            result = {
              ok: true,
              action,
              ...getMonthlyPpeConfirmationPageData_({
                year: month.year,
                month: month.month,
                token: monthlyPpeConfirmationToken_(month),
              }),
            };
            break;
          }
          case 'setupOfficialDocumentMonitor': {
            const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
            setupOfficialDocumentMonitorSheets_(ss);
            applyColumnWidthsAndWrap_();
            applyChineseSettingsAndDropdowns();
            result = {
              ok: true,
              action,
              sheetNames: [OFFICIAL_DOC_QUEUE_SHEET_NAME, OFFICIAL_DOC_RUN_LOG_SHEET_NAME],
            };
            break;
          }
          case 'processOfficialDocumentQueue': {
            result = {
              ok: true,
              action,
              ...processOfficialDocumentQueue_({
                date: e.parameter.date,
                slot: e.parameter.slot,
              }),
            };
            break;
          }
          case 'officialDocumentSnapshot': {
            result = {
              ok: true,
              action,
              ...getOfficialDocumentSnapshot_({
                date: e.parameter.date,
                slot: e.parameter.slot,
              }),
            };
            break;
          }
          case 'resendOfficialDocumentSnapshot': {
            result = {
              ok: true,
              action,
              ...resendOfficialDocumentSnapshot_({
                date: e.parameter.date,
                slot: e.parameter.slot,
                to: e.parameter.to,
                target: e.parameter.target,
                toName: e.parameter.toName,
                name: e.parameter.name,
                recipientName: e.parameter.recipientName,
                toUserId: e.parameter.toUserId,
                lineUserId: e.parameter.lineUserId,
                userId: e.parameter.userId,
              }),
            };
            break;
          }
          case 'resendApprovalRequest': {
            result = {
              ok: true,
              action,
              ...resendSupervisorApprovalRequest_({
                recordId: e.parameter.recordId,
                date: e.parameter.date || e.parameter.checkDate,
                equipmentId: e.parameter.equipmentId,
                equipmentName: e.parameter.equipmentName,
                inspector: e.parameter.inspector,
                latest: String(e.parameter.latest || '').toLowerCase() === 'true' || e.parameter.latest === '1',
                dryRun: String(e.parameter.dryRun || '').toLowerCase() === 'true' || e.parameter.dryRun === '1',
              }),
            };
            break;
          }
          case 'pendingApprovalStatus': {
            const minAgeHours = e.parameter.minAgeHours ? Number(e.parameter.minAgeHours) : 0;
            const records = listPendingApprovalRecords_({
              includeApprovalUrl: false,
              minAgeHours,
            });
            result = {
              ok: true,
              action,
              pendingCount: records.length,
              minAgeHours,
              records: records.slice(0, 50).map(pendingApprovalSafeRecord_),
            };
            break;
          }
          case 'pendingApprovalReminder': {
            result = Object.assign({ action }, pendingApprovalReminderJob_({
              dryRun: String(e.parameter.dryRun || '').toLowerCase() !== 'false',
              force: String(e.parameter.force || '').toLowerCase() === 'true' || e.parameter.force === '1',
              minAgeHours: e.parameter.minAgeHours ? Number(e.parameter.minAgeHours) : undefined,
              today: e.parameter.date ? parseISODate_(e.parameter.date) : undefined,
            }));
            break;
          }
          case 'cleanupOfficialDocumentMonitor': {
            result = {
              ok: true,
              action,
              ...cleanupOfficialDocumentMonitorSheets_({
                dryRun: String(e.parameter.dryRun || '').toLowerCase() !== 'false',
              }),
            };
            break;
          }
          case 'fetchPdf': {
            // 唯讀，且只允許讀「archive root 之下 + mimeType=PDF」的檔案
            // 雙重限制（codex P1 + DB Sheet 移入歸檔資料夾後的延伸保護）：
            //   - isUnderArchiveRoot_：限制範圍只能歸檔資料夾
            //   - mimeType 檢查：避免下載 DB Sheet / 其他非 PDF 檔
            const fid = e.parameter.fileId;
            if (!fid) throw new Error('需要 fileId');
            if (!isUnderArchiveRoot_(fid)) throw new Error('該檔案非系統歸檔範圍');
            const file = DriveApp.getFileById(fid);
            if (file.getMimeType() !== 'application/pdf') {
              throw new Error('該檔案非 PDF（mimeType: ' + file.getMimeType() + '）');
            }
            const blob = file.getBlob();
            result = { ok: true, base64: Utilities.base64Encode(blob.getBytes()) };
            break;
          }
          default:
            throw new Error('未知 admin action: ' + action);
        }
        break;
      }

      default:
        throw new Error('未知的 api: ' + api);
    }
    return jsonResponse_(result);
  } catch (err) {
    Logger.log('doGet 失敗：' + err + '\n' + (err.stack || ''));
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '';
    if (!raw) throw new Error('空白 payload');
    if (raw.length > CONFIG.MAX_PAYLOAD_BYTES) {
      throw new Error('payload 過大');
    }

    // === LINE Webhook 偵測 ===
    // Apps Script 讀不到 X-Line-Signature header（codex 2026-05-26 P1）
    // 改用 URL query token 驗證：Webhook URL 在 LINE Console 設成 exec_url?lineWebhookToken=XXX
    // - LINE_WEBHOOK_QUERY_TOKEN 未設 → fail-closed 直接拒絕（避免匿名觸發完成異常等指令）
    // - 設了 → 嚴格比對
    if (typeof handleLineWebhook_ === 'function' && raw.indexOf('"events"') >= 0 && raw.indexOf('"destination"') >= 0) {
      const expected = getLineWebhookQueryToken_();
      const provided = (e.parameter && e.parameter.lineWebhookToken) || '';
      if (!expected || expected.length < 32) {
        Logger.log('[LINE webhook] LINE_WEBHOOK_QUERY_TOKEN 未設置，拒絕 webhook');
        return jsonResponse_({ ok: false, error: 'webhook_token_not_configured' });
      }
      if (provided !== expected) {
        Logger.log('[LINE webhook] query token 不符，拒絕');
        return jsonResponse_({ ok: false, error: 'invalid_webhook_token' });
      }
      const r = handleLineWebhook_(raw);
      return jsonResponse_(r);
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (_) {
      throw new Error('payload 不是合法 JSON');
    }

    if (!CONFIG.API_TOKEN || CONFIG.API_TOKEN.indexOf('REPLACE_') === 0) {
      throw new Error('系統未設定 API_TOKEN');
    }
    if (payload.apiToken !== CONFIG.API_TOKEN) {
      throw new Error('未授權');
    }
    delete payload.apiToken;
    // 移除 payload._debug stack 回傳（codex 2026-05-26 P1）— 避免任何拿到 API_TOKEN 的人能拉到 stack
    delete payload._debug;

    let result;
    switch (payload.action || '') {
      case 'enqueueOfficialDocuments':
        if (!checkAdminToken_(payload.adminToken)) {
          throw new Error('未授權：此 action 需 adminToken（Script Properties ADMIN_TOKEN）');
        }
        delete payload.adminToken;
        result = enqueueOfficialDocumentDispatches_(payload);
        break;
      case 'processOfficialDocumentQueue':
        if (!checkAdminToken_(payload.adminToken)) {
          throw new Error('未授權：此 action 需 adminToken（Script Properties ADMIN_TOKEN）');
        }
        delete payload.adminToken;
        result = processOfficialDocumentQueue_(payload);
        break;
      case 'approveRecord':
        result = handleApprovalSubmission_(payload);
        break;
      case 'submitDailyIncident':
        result = handleDailyIncidentSubmission_(payload);
        break;
      case 'updateDailyIncident':
        result = updateDailyIncident_(payload);
        break;
      case 'submitDailyIncidentForApproval':
        result = submitDailyIncidentForApproval_(payload);
        break;
      case 'approveDailyIncident':
        result = approveDailyIncident_(payload);
        break;
      case 'commentDailyIncident':
        result = submitDailyIncidentSupervisorComment_(payload);
        break;
      case 'submitDailyWorkCheck':
        result = submitDailyWorkCheck_(payload);
        break;
      default:
        result = handleSubmission_(payload);
    }
    return jsonResponse_(result);

  } catch (err) {
    Logger.log('doPost 失敗：' + err + '\n' + (err.stack || ''));
    try {
      PropertiesService.getScriptProperties().setProperty('LAST_POST_ERROR_JSON', JSON.stringify({
        at: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
        message: String((err && err.message) || err).substring(0, 1000),
        stack: String((err && err.stack) || '').substring(0, 3000),
      }));
    } catch (_) {}
    return jsonResponse_({ ok: false, error: friendlyError_(err) });
  }
}

/**
 * 將內部錯誤包成對前端較友善的訊息（不洩漏 stack）
 */
function friendlyError_(err) {
  const msg = String((err && err.message) || err);
  const businessErrors = ['未授權', 'payload 過大', 'payload 不是合法 JSON',
    '簽名格式錯誤', '簽名圖太大', '空白 payload', '系統忙碌，請稍後再試',
    '找不到設備', '需提供', '缺少',
    '簽核連結無效', '找不到待簽核紀錄', '待簽核草稿不存在', '不可簽核',
    '無法建立主管簽核連結', '主管簽名格式錯誤',
    // 業務驗證錯誤（v8.10 加）
    '標為異常但未填', '仍有未處理異常', '無法標為',
    // 修 P2.2: 補白名單（讓使用者看到真因而非「請聯絡管理員」）
    '結果值不合法', '風險值不合法', '照片超過', '照片過大', '照片格式錯誤',
    '設備已停用', '找不到模板', '檢查表模板缺必要欄位',
    '日期格式', '處理狀況', '日常事件', '更新連結', '審核連結',
    '處理完成後才能陳核', '缺少陳核主管', '請填寫陳核主管', '審核決定不合法',
    '主管處理意見', '只有處理中事件', '已送主管正式審核',
    '每日作業檢核', '同仁姓名',
    '公文待發文', '待發文佇列',
    'cleanupAll dryRun 需帶', 'cleanupDate dryRun 需帶', 'cleanupDate 實刪需帶',
    // admin 用錯誤訊息
    '該檔案非', '需要 fileId', '未知 admin action', '未知的 api',
    'LINE_CHANNEL_ACCESS_TOKEN', 'LINE Rich Menu', '圖文選單圖片',
    // 新增安全分層相關 (codex 2026-05-26)
    'adminToken', '此 action 需 adminToken', '破壞性 action', 'ADMIN_TOKEN', 'ALLOW_DESTRUCTIVE_HTTP',
    'webhook_token', 'invalid_webhook_token'];
  if (businessErrors.some(k => msg.indexOf(k) >= 0)) return msg;
  return '系統處理失敗，請聯絡管理員';
}

function destructiveActionWillDelete_(action, params) {
  params = params || {};
  switch (String(action || '')) {
    case 'cleanupAll':
    case 'cleanupDate':
      return String(params.dryRun || '') !== '1';
    case 'cleanupOfficialDocumentMonitor':
      return String(params.dryRun || '').toLowerCase() === 'false';
    default:
      return false;
  }
}

function approvalPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('ApprovalPage');
  tpl.approvalRecordIdJson = scriptSafeJson_(params.recordId);
  tpl.approvalTokenJson = scriptSafeJson_(params.token);
  return tpl.evaluate()
    .setTitle('主管簽核')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function dailyIncidentUpdatePageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('IncidentUpdatePage');
  tpl.incidentIdJson = scriptSafeJson_(params.incidentId);
  tpl.incidentTokenJson = scriptSafeJson_(params.token);
  return tpl.evaluate()
    .setTitle('日常事件處理回報')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function dailyIncidentApprovalPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('IncidentApprovalPage');
  tpl.incidentIdJson = scriptSafeJson_(params.incidentId);
  tpl.incidentTokenJson = scriptSafeJson_(params.token);
  return tpl.evaluate()
    .setTitle('日常事件主管審核')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function dailyIncidentCommentPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('IncidentCommentPage');
  tpl.incidentIdJson = scriptSafeJson_(params.incidentId);
  tpl.incidentTokenJson = scriptSafeJson_(params.token);
  return tpl.evaluate()
    .setTitle('日常事件主管處理意見')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function scriptSafeJson_(value) {
  return JSON.stringify(String(value || ''))
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function getApprovalForPage(recordId, token) {
  try {
    return getApprovalSummary_(recordId, token);
  } catch (err) {
    Logger.log('getApprovalForPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function approveRecordFromPage(payload) {
  try {
    return handleApprovalSubmission_(payload);
  } catch (err) {
    Logger.log('approveRecordFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
