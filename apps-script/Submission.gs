/**
 * ===== 接收前端送出的檢查表 =====
 *
 * 流程（嚴格順序，避免髒資料）：
 *   1. 驗證 payload（含 signature 格式、欄位長度）
 *   2. 取 LockService 序列化（避免 race condition）
 *   3. 先產 PDF
 *   4. 上傳 Drive 取得 URL
 *   5. 最後一次 appendRow 寫入紀錄（含 PDF URL）
 *   6. 任何一步失敗都不會留下髒資料（沒寫 Sheet）
 *
 * payload 範例（daily）：
 *   {
 *     formType: 'daily',
 *     equipmentId: '<設備代號>',
 *     checkDate: '2026-05-18',            // 必填，daily 也要
 *     inspector: '張三',
 *     items: [{ order, name, result, note }, ...],
 *     signature: 'data:image/png;base64,...', // 每日場地防護具可留空，改以 inspector 姓名留痕
 *   }
 *
 * payload 範例（monthly）：
 *   {
 *     formType: 'monthly',
 *     equipmentId: '<設備代號>',
 *     checkDate: '2026-05-31',
 *     inspector: '李四',
 *     items: [{ order, name, methods, result, abnormalDesc, risk, action, review }, ...],
 *     signature: 'data:image/png;base64,...',
 *   }
 */

function handleSubmission_(payload) {
  // 這層不 catch — 讓 doPost 用 friendlyError 統一包裝
  if (!payload || !payload.formType) throw new Error('缺少 formType');
    if (!payload.equipmentId) throw new Error('缺少 equipmentId');
    if (!payload.checkDate) throw new Error('缺少 checkDate');
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error('缺少 items');
    }

    // 文字欄位 sanitize（控制字元、長度）
    payload.inspector = sanitizeText_(payload.inspector);
    if (!payload.inspector) throw new Error('缺少 inspector');

    // result / risk / methods 白名單
    // 先取得這張表的 template，從 template.resultOptions 動態決定 result 白名單
    // 找不到 template → fallback 到舊的 hard-coded 白名單
    const equipmentForTpl = getEquipmentById_(payload.equipmentId);
    const isDailyPpeTypedSignature = payload.formType === 'daily' &&
      equipmentForTpl &&
      String(equipmentForTpl.category || '').trim() === '防護具檢點';
    // 簽名格式驗證（一般檢點仍必填；每日場地防護具改以檢點人員姓名留痕）
    if (!isDailyPpeTypedSignature) validateSignature_(payload.signature);

    let tplForValidation = null;
    if (equipmentForTpl) {
      tplForValidation = getTemplateForCategoryCycle_(equipmentForTpl.category, payload.formType, equipmentForTpl);
      if (!tplForValidation) {
        throw new Error('找不到模板：' + equipmentForTpl.category + ' - ' + payload.formType);
      }
    }
    // 順序按「第一個=良好、中間=N/A、最後=不良」的前端慣例
    // （前端 daily.html / monthly.html 用 resultOptions[length-1] 判斷 bad）
    const fallbackResult = {
      daily: ['V', '/', 'X'],
      monthly: ['normal', 'abnormal'],
    };
    const allowedResults = (tplForValidation && tplForValidation.resultOptions && tplForValidation.resultOptions.length)
      ? tplForValidation.resultOptions
      : (fallbackResult[payload.formType] || []);
    const RISK_WHITELIST = ['', 'severe', 'possible', 'none'];
    const METHODS_WHITELIST = ['目視', '測試', '檢點'];  // 堆高機月檢用「檢點」

    payload.items = payload.items.map((it, idx) => {
      const result = sanitizeText_(it.result, 30);
      if (allowedResults.indexOf(result) < 0) {
        throw new Error(`第 ${idx + 1} 項結果值不合法：${result}`);
      }
      const risk = sanitizeText_(it.risk, 30);
      if (RISK_WHITELIST.indexOf(risk) < 0) {
        throw new Error(`第 ${idx + 1} 項風險值不合法：${risk}`);
      }
      let methods;
      if (Array.isArray(it.methods)) {
        methods = it.methods
          .map(m => sanitizeText_(m, 20))
          .filter(m => METHODS_WHITELIST.indexOf(m) >= 0);
      }
      // 異常照片：驗證 + 限制數量
      let photos = [];
      if (Array.isArray(it.photos)) {
        if (it.photos.length > CONFIG.MAX_PHOTOS_PER_ITEM) {
          throw new Error(`第 ${idx + 1} 項照片超過 ${CONFIG.MAX_PHOTOS_PER_ITEM} 張上限`);
        }
        photos = it.photos.filter(p => p && typeof p === 'string').map((p, pi) => {
          if (p.length > CONFIG.MAX_PHOTO_BYTES) {
            throw new Error(`第 ${idx + 1} 項第 ${pi + 1} 張照片過大`);
          }
          if (!/^data:image\/(jpeg|jpg|png);base64,[A-Za-z0-9+/=]+$/.test(p)) {
            throw new Error(`第 ${idx + 1} 項第 ${pi + 1} 張照片格式錯誤`);
          }
          return p;
        });
      }

      return {
        order: Number(it.order) || 0,
        name: sanitizeText_(it.name, 200),
        section: sanitizeText_(it.section, 80),
        result,
        note: sanitizeText_(it.note),
        methods,
        method: sanitizeText_(it.method, 40),                 // simple schema 用
        checkResults: sanitizeCheckResults_(it.checkResults),
        abnormalDesc: sanitizeText_(it.abnormalDesc),
        risk,
        action: sanitizeText_(it.action),
        review: sanitizeText_(it.review),
        photos,
      };
    });

    const equipment = getEquipmentById_(payload.equipmentId);
    if (!equipment) throw new Error('找不到設備：' + payload.equipmentId);
    // codex P1: 拒絕停用設備
    if (!equipment.active) throw new Error('設備已停用：' + payload.equipmentId);

    // ===== 雙重驗證：異常必填 + 鎖定項必須仍標異常 =====
    // 找出 bad value（最後一個 result option）
    const badValue = allowedResults[allowedResults.length - 1];
    // a) 對所有 result === bad 的項目，異常說明 / 記事不能空
    payload.items.forEach((it, idx) => {
      if (it.result === badValue) {
        const desc = (it.abnormalDesc || it.note || '').trim();
        if (!desc) {
          throw new Error(`第 ${idx + 1} 項標為異常但未填異常說明 / 記事`);
        }
      }
    });
    // b) 鎖定項驗證：「機具設備異常事件」未完成的 order，本次 result 必須仍為 bad
    //    (避免使用者繞過前端鎖定送出「良好」)
    const lockedItems = getLockedItemsForEquipment_(payload.equipmentId, payload.formType);
    if (lockedItems.length > 0) {
      const lockedOrders = new Set(lockedItems.map(l => l.order));
      payload.items.forEach(it => {
        if (lockedOrders.has(Number(it.order)) && it.result !== badValue) {
          throw new Error(`第 ${it.order} 項目「${it.name}」仍有未處理異常，無法標為「${it.result}」，需先在『機具設備異常事件』表把狀態改為「已完成」才能解鎖`);
        }
      });
    }

    // 鎖：避免同設備同日重複寫 / 並發 race
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('系統忙碌，請稍後再試');

    try {
      // codex P1: idempotency — 若前端帶 clientSubmissionId 且已存在 → 回原紀錄
      if (payload.clientSubmissionId) {
        const existing = findRecordByClientId_(payload.clientSubmissionId);
        if (existing) {
          return Object.assign({ ok: true, idempotent: true }, existing);
        }
      }

      const recordId = uuid_();
      const submittedAt = new Date();
      const checkDate = parseISODate_(payload.checkDate);

      // 取對應檢查表模板（codex P2: PDF 動態抓 templateName / legalBasis / rule）
      const tplMeta = getTemplateForCategoryCycle_(equipment.category, payload.formType, equipment);
      if (!tplMeta) throw new Error('找不到模板：' + equipment.category + ' - ' + payload.formType);

      const needsApproval = requiresSupervisorApproval_(payload.formType, equipment);
      let approvalToken = '';
      let approvalUrl = '';
      let docInfo = null;
      let draftDocUrl = '';
      let fileUrl = '';

      if (needsApproval) {
        approvalToken = createApprovalToken_();
        approvalUrl = buildApprovalUrl_(recordId, approvalToken);
        if (!approvalUrl) throw new Error('系統設定 webAppUrl 未填，無法建立主管簽核連結');

        // 主管簽核表單：先產「待簽核 Google Doc」，主管簽完後才匯出 PDF 歸檔。
        docInfo = createChecklistDoc_(payload.formType, {
          recordId, submittedAt, checkDate, equipment, payload, template: tplMeta,
        });
        const draftFile = DriveApp.getFileById(docInfo.docId);
        draftFile.setName(buildDraftDocFilename_(payload.formType, checkDate, equipment));
        const pendingFolder = getOrCreatePendingApprovalFolder_();
        draftFile.moveTo(pendingFolder);
        draftDocUrl = draftFile.getUrl();
      } else {
        // 一般日檢 / 機具月檢 / 每日場地防護具檢點：檢查人簽名後直接正式歸檔，不走主管簽核。
        const pdfBlob = buildPdf_(payload.formType, {
          recordId, submittedAt, checkDate, equipment, payload, template: tplMeta,
        });
        pdfBlob.setName(buildPdfFilename_(payload.formType, checkDate, equipment));
        const folder = getOrCreateArchiveFolderForSubmission_(payload.formType, equipment, checkDate);
        const file = folder.createFile(pdfBlob);
        fileUrl = file.getUrl();
      }

      // 3-4. 寫紀錄 + 異常事件
      //
      // 寫入順序與失敗策略（codex P1 + Claude review partial failure）：
      //   a) writeRecord_ 是主紀錄（audit trail），必須成功
      //   b) writeIncidents_ 是輔助追蹤，失敗不阻塞主流程
      //      (異常項目可從「填報紀錄.完整資料JSON」事後重建)
      //
      // 失敗情境：
      //   - writeRecord 失敗 → 整個流程 fail，setTrashed PDF（孤兒清理）
      //   - writeRecord 成功 + writeIncidents 失敗 → log 後仍回 ok（避免主紀錄與 PDF 已寫但回錯誤的 partial state）
      // 修 P1.1: 傳 allowedResults 給 countIncidents_ 動態判定 bad（避免硬編碼漂移）
      const incidentCount = countIncidents_(payload, allowedResults);
      try {
        writeRecord_({ recordId, submittedAt, checkDate, formType: payload.formType,
                       equipment, payload, fileUrl, incidentCount,
                       approval: needsApproval
                         ? {
                           status: '待主管簽核',
                           token: approvalToken,
                           draftDocId: docInfo.docId,
                           draftDocUrl,
                         }
                         : { status: '簽核略過' } });
      } catch (writeErr) {
        // 主紀錄寫失敗 → 清理孤兒檔案
        Logger.log('writeRecord_ 失敗，清理孤兒檔案: ' + writeErr + '\n' + (writeErr.stack || ''));
        if (docInfo && docInfo.docId) trashChecklistDoc_(docInfo.docId);
        if (fileUrl) {
          try {
            const idMatch = String(fileUrl).match(/\/d\/([^/]+)/);
            if (idMatch && idMatch[1]) DriveApp.getFileById(idMatch[1]).setTrashed(true);
          } catch (cleanupErr) {
            Logger.log('清理孤兒 PDF 失敗: ' + cleanupErr);
          }
        }
        throw writeErr;
      }
      // 主紀錄已成功，異常追蹤失敗時只 log（不影響使用者結果）
      try {
        // tplMeta 帶下去，writeIncidents_ 內部會從 tplMeta.resultOptions 算 allowedResults
        writeIncidents_({ recordId, submittedAt, checkDate, formType: payload.formType,
                          equipment, payload, fileUrl, tplMeta });
      } catch (incidentErr) {
        Logger.log('writeIncidents_ 失敗（主紀錄已寫，異常追蹤可從 JSON 重建）: ' +
                   incidentErr + '\n' + (incidentErr.stack || ''));
      }
      // 異常通報仍維持「檢查人送出當下即時推播」；正式 PDF 連結待主管簽核後回填到 Sheet。
      if (incidentCount > 0) {
        try { notifyLineIncidents_(recordId, submittedAt, checkDate, payload, equipment, fileUrl, allowedResults); }
        catch (lineErr) { Logger.log('[LINE incident push] 失敗: ' + lineErr + '\n' + (lineErr.stack || '')); }
      }

      let approvalNotice = null;
      if (needsApproval) {
        try {
          approvalNotice = notifySupervisorApprovalRequest_({
            recordId,
            submittedAt,
            checkDate,
            formType: payload.formType,
            equipment,
            inspector: payload.inspector,
            incidentCount,
            approvalUrl,
          });
        } catch (lineErr) {
          Logger.log('[LINE approval push] 失敗: ' + lineErr + '\n' + (lineErr.stack || ''));
          approvalNotice = { ok: false, reason: 'line_error' };
        }
      }

      return {
        ok: true,
        recordId,
        fileUrl,
        approvalPending: needsApproval,
        approvalNotice,
        incidentCount,
      };

    } finally {
      lock.releaseLock();
    }
}

/**
 * 將紀錄寫入「填報紀錄」工作表（一次寫入完整列）
 *
 * 為避免單 cell 超過 50000 字元上限，這裡不存 signature dataURL，
 * 只存 payload 結構（items, inspector）。簽名仍隨 PDF 一起存到 Drive。
 */
function writeRecord_({ recordId, submittedAt, checkDate, formType, equipment, payload, fileUrl, incidentCount, approval }) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');

  // 用 headers 動態定位欄位，不依賴順序
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = new Array(headers.length).fill('');

  const setCol = (name, value) => {
    const idx = headers.indexOf(name);
    if (idx >= 0) row[idx] = value;
  };

  setCol('紀錄ID', recordId);
  setCol('送出時間', Utilities.formatDate(submittedAt, tz_(), 'yyyy-MM-dd HH:mm:ss'));
  setCol('檢查日期', formatISODate_(checkDate));
  setCol('表單類型', formType === 'daily' ? '每日' : '每月');
  setCol('設備代號', equipment.equipmentId);
  setCol('設備名稱', equipment.equipmentName);
  setCol('設備類別', equipment.category);
  setCol('檢點人員', payload.inspector || '');
  setCol('異常事件數', typeof incidentCount === 'number' ? incidentCount : 0);

  // payload 不含 signature dataURL，photos 也改成只記數量（避免 cell 超 50000）
  const payloadForLog = Object.assign({}, payload, {
    signature: payload.signature ? '[stored in PDF]' : '[typed inspector name]',
  });
  if (Array.isArray(payloadForLog.items)) {
    payloadForLog.items = payloadForLog.items.map(it => Object.assign({}, it, {
      photos: Array.isArray(it.photos) ? `[${it.photos.length} 張照片，已嵌入 PDF]` : undefined,
    }));
  }
  let jsonStr = JSON.stringify(payloadForLog);
  if (jsonStr.length > 49000) {
    jsonStr = jsonStr.substring(0, 49000) + '...[truncated]';
  }
  setCol('完整資料JSON', jsonStr);

  setCol('PDF連結', fileUrl);
  if (approval) {
    setCol('簽核狀態', approval.status || '待主管簽核');
    setCol('主管簽核Token', approval.token || '');
    setCol('草稿DocID', approval.draftDocId || '');
    setCol('草稿Doc連結', approval.draftDocUrl || '');
  } else {
    setCol('簽核狀態', '已簽核歸檔');
  }
  // codex P1: idempotency 用
  setCol('clientSubmissionId', payload.clientSubmissionId || '');

  sheet.appendRow(row);
}

function createApprovalToken_() {
  return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
}

function requiresSupervisorApproval_(formType, equipment) {
  if (formType !== 'monthly' || !equipment) return false;
  const equipmentId = String(equipment.equipmentId || '').trim().toUpperCase();
  if ([
    'CLASSROOM-LJ-MEAS-PPE',
    'CLASSROOM-FX-MEAS-PPE',
    'CLASSROOM-ZM-MEAS-PPE',
  ].indexOf(equipmentId) >= 0) {
    return true;
  }
  return ['堆高機', '固定式起重機'].indexOf(String(equipment.category || '').trim()) >= 0;
}

function buildApprovalUrl_(recordId, token) {
  const base = getWebAppBaseUrl_();
  if (!base || !/^https?:\/\//.test(base)) return '';
  return base +
    '?page=approve&recordId=' + encodeURIComponent(recordId) +
    '&token=' + encodeURIComponent(token);
}

function buildDraftDocFilename_(formType, checkDate, equipment) {
  return buildPdfFilename_(formType, checkDate, equipment).replace(/\.pdf$/i, '_待主管簽核');
}

function notifySupervisorApprovalRequest_(record) {
  if (typeof sendApprovalRequest_ !== 'function') return { ok: false, reason: 'missing_sendApprovalRequest' };
  return sendApprovalRequest_(record);
}

function resendSupervisorApprovalRequest_(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const targetRecordId = sanitizeText_(opts.recordId, 80);
  const targetEquipmentId = sanitizeText_(opts.equipmentId, 80);
  const targetEquipmentName = sanitizeText_(opts.equipmentName, 200);
  const targetInspector = sanitizeText_(opts.inspector, 80);
  let targetDate = '';
  if (opts.date) {
    targetDate = formatISODate_(parseISODate_(opts.date));
  }

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, reason: 'no_records' };
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tokenIdx = headers.indexOf('主管簽核Token');
  if (tokenIdx < 0) throw new Error('填報紀錄缺主管簽核Token欄位');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const parsedRows = data.map((row, i) => approvalRecordFromRow_(sheet, headers, row, i + 2));
  const archivedBatchMap = buildArchivedApprovalBatchMap_(parsedRows);
  const matches = [];

  for (let i = parsedRows.length - 1; i >= 0; i--) {
    const row = data[i];
    const rec = parsedRows[i];
    const token = String(row[tokenIdx] || '').trim();
    if (!token) continue;
    if (!approvalStatusIsPending_(rec.status)) continue;
    if (approvalHasArchivedSibling_(rec, archivedBatchMap)) continue;
    if (targetRecordId && rec.recordId !== targetRecordId) continue;
    if (targetEquipmentId && rec.equipmentId !== targetEquipmentId) continue;
    if (targetEquipmentName && rec.equipmentName.indexOf(targetEquipmentName) < 0) continue;
    if (targetInspector && rec.inspector !== targetInspector) continue;
    if (targetDate && rec.checkDate !== targetDate) continue;
    matches.push({ rec, token, rowNo: rec.rowNo });
  }

  if (!matches.length) {
    return {
      ok: false,
      reason: 'no_matching_pending_approval',
      filters: approvalResendSafeFilters_(opts),
    };
  }
  if (matches.length > 1 && !opts.latest && !targetRecordId) {
    return {
      ok: false,
      reason: 'ambiguous_pending_approval',
      matchCount: matches.length,
      matches: matches.slice(0, 10).map(m => approvalResendSafeRecord_(m.rec)),
    };
  }

  const match = matches[0];
  const rec = match.rec;
  const equipment = getEquipmentById_(rec.equipmentId) || {
    equipmentId: rec.equipmentId,
    equipmentName: rec.equipmentName,
    category: rec.category,
  };
  const approvalUrl = buildApprovalUrl_(rec.recordId, match.token);
  const noticeRecord = {
    recordId: rec.recordId,
    submittedAt: rec.submittedAt,
    checkDate: parseISODate_(rec.checkDate),
    formType: rec.formType,
    equipment,
    inspector: rec.inspector,
    incidentCount: rec.incidentCount,
    approvalUrl,
  };
  const supervisorIds = (typeof getSupervisorUserIds_ === 'function') ? getSupervisorUserIds_() : [];
  if (dryRun) {
    return {
      ok: true,
      action: 'wouldResendApprovalRequest',
      record: approvalResendSafeRecord_(rec),
      targetMode: 'supervisors',
      targetCount: Array.from(new Set(supervisorIds || [])).length,
      hasApprovalUrl: Boolean(approvalUrl),
    };
  }

  const notice = notifySupervisorApprovalRequest_(noticeRecord);
  return Object.assign({
    ok: !!(notice && notice.ok),
    action: 'resentApprovalRequest',
    record: approvalResendSafeRecord_(rec),
    hasApprovalUrl: Boolean(approvalUrl),
  }, notice || {});
}

function listPendingApprovalRecords_(opts) {
  opts = opts || {};
  const includeApprovalUrl = opts.includeApprovalUrl !== false;
  const inspectorName = sanitizeText_(opts.inspectorName, 80);
  const minAgeHours = Math.max(0, Number(opts.minAgeHours || 0));
  const now = opts.now instanceof Date ? opts.now : new Date();

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const tokenIdx = headers.indexOf('主管簽核Token');
  const submittedIdx = headers.indexOf('送出時間');
  if (tokenIdx < 0) throw new Error('填報紀錄缺主管簽核Token欄位');

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const parsedRows = data.map((row, i) => approvalRecordFromRow_(sheet, headers, row, i + 2));
  const archivedBatchMap = buildArchivedApprovalBatchMap_(parsedRows);
  const records = [];
  for (let i = 0; i < parsedRows.length; i++) {
    const row = data[i];
    const rec = parsedRows[i];
    const token = String(row[tokenIdx] || '').trim();
    if (!token) continue;
    if (!approvalStatusIsPending_(rec.status)) continue;
    if (approvalHasArchivedSibling_(rec, archivedBatchMap)) continue;
    if (inspectorName && rec.inspector !== inspectorName) continue;

    const submittedRaw = submittedIdx >= 0 ? row[submittedIdx] : rec.submittedAt;
    const submittedAt = approvalParseDateTime_(submittedRaw || rec.submittedAt);
    const ageHours = submittedAt
      ? Math.max(0, Math.floor((now.getTime() - submittedAt.getTime()) / 3600000))
      : null;
    if (minAgeHours > 0 && (ageHours == null || ageHours < minAgeHours)) continue;

    let checkDateLabel = rec.checkDate || '';
    try { checkDateLabel = formatROCDate_(parseISODate_(rec.checkDate)); } catch (_) {}
    records.push({
      recordId: rec.recordId,
      checkDate: rec.checkDate,
      checkDateLabel,
      formType: rec.formType,
      formTypeZh: rec.formTypeZh,
      equipmentId: rec.equipmentId,
      equipmentName: rec.equipmentName,
      category: rec.category,
      inspector: rec.inspector,
      incidentCount: rec.incidentCount,
      status: rec.status,
      submittedAt: rec.submittedAt,
      submittedAtLabel: formatDisplayDateTime_(submittedRaw || rec.submittedAt),
      submittedAtMs: submittedAt ? submittedAt.getTime() : 0,
      ageHours,
      ageDays: ageHours == null ? null : Math.floor(ageHours / 24),
      approvalUrl: includeApprovalUrl ? buildApprovalUrl_(rec.recordId, token) : '',
    });
  }

  records.sort((a, b) => {
    const diff = (a.submittedAtMs || 0) - (b.submittedAtMs || 0);
    if (diff !== 0) return diff;
    return String(a.equipmentName || '').localeCompare(String(b.equipmentName || ''), 'zh-Hant');
  });
  return records;
}

function approvalStatusIsPending_(status) {
  return String(status || '').trim() === '待主管簽核';
}

function approvalStatusIsArchived_(status) {
  return String(status || '').trim() === '已簽核歸檔';
}

function approvalBatchKey_(rec) {
  if (!rec) return '';
  return [
    String(rec.checkDate || '').trim(),
    String(rec.formType || rec.formTypeZh || '').trim(),
    String(rec.equipmentId || rec.equipmentName || '').trim(),
  ].join('|');
}

function buildArchivedApprovalBatchMap_(records) {
  const map = {};
  (records || []).forEach(rec => {
    if (!approvalStatusIsArchived_(rec && rec.status)) return;
    const key = approvalBatchKey_(rec);
    if (key) map[key] = rec;
  });
  return map;
}

function approvalHasArchivedSibling_(rec, archivedBatchMap) {
  const key = approvalBatchKey_(rec);
  const archived = key && archivedBatchMap ? archivedBatchMap[key] : null;
  return !!(archived && archived.recordId !== rec.recordId);
}

function findArchivedApprovalSibling_(rec) {
  if (!rec) return null;
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const key = approvalBatchKey_(rec);
  if (!key) return null;
  for (let i = data.length - 1; i >= 0; i--) {
    const other = approvalRecordFromRow_(sheet, headers, data[i], i + 2);
    if (other.recordId === rec.recordId) continue;
    if (!approvalStatusIsArchived_(other.status)) continue;
    if (approvalBatchKey_(other) === key) return other;
  }
  return null;
}

function diagnoseApprovalBatch_(opts) {
  opts = opts || {};
  const targetRecordId = sanitizeText_(opts.recordId, 80);
  const targetEquipmentId = sanitizeText_(opts.equipmentId, 80);
  const targetEquipmentName = sanitizeText_(opts.equipmentName, 200);
  const targetDate = opts.date ? formatISODate_(parseISODate_(opts.date)) : '';

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) {
    return { found: false, reason: 'no_records', records: [] };
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const records = data.map((row, i) => approvalRecordFromRow_(sheet, headers, row, i + 2));
  const anchor = targetRecordId
    ? records.find(rec => rec.recordId === targetRecordId)
    : records.find(rec => {
        if (targetDate && rec.checkDate !== targetDate) return false;
        if (targetEquipmentId && rec.equipmentId !== targetEquipmentId) return false;
        if (targetEquipmentName && rec.equipmentName.indexOf(targetEquipmentName) < 0) return false;
        return true;
      });
  const key = anchor ? approvalBatchKey_(anchor) : [
    targetDate,
    'monthly',
    targetEquipmentId || targetEquipmentName,
  ].join('|');
  const batchRecords = records.filter(rec => approvalBatchKey_(rec) === key);
  const archivedMap = buildArchivedApprovalBatchMap_(records);
  return {
    found: !!anchor,
    batchKey: key,
    anchor: anchor ? approvalDiagnosticSafeRecord_(anchor, archivedMap) : null,
    records: batchRecords.map(rec => approvalDiagnosticSafeRecord_(rec, archivedMap)),
  };
}

function approvalDiagnosticSafeRecord_(rec, archivedBatchMap) {
  return {
    recordId: rec.recordId,
    rowNo: rec.rowNo,
    checkDate: rec.checkDate,
    formType: rec.formTypeZh,
    equipmentId: rec.equipmentId,
    equipmentName: rec.equipmentName,
    inspector: rec.inspector,
    status: rec.status,
    incidentCount: rec.incidentCount,
    hasFileUrl: !!rec.fileUrl,
    hasDraftDoc: !!rec.draftDocId,
    supersededBySignedBatch: approvalHasArchivedSibling_(rec, archivedBatchMap),
  };
}

function approvalParseDateTime_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = String(value || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const y = m[1];
    const mo = String(m[2]).padStart(2, '0');
    const d = String(m[3]).padStart(2, '0');
    const hh = String(m[4] || '0').padStart(2, '0');
    const mm = String(m[5] || '0').padStart(2, '0');
    const ss = String(m[6] || '0').padStart(2, '0');
    const parsed = new Date(`${y}-${mo}-${d}T${hh}:${mm}:${ss}+08:00`);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(s);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function pendingApprovalSafeRecord_(rec) {
  return {
    recordId: rec.recordId,
    checkDate: rec.checkDate,
    formType: rec.formTypeZh,
    equipmentId: rec.equipmentId,
    equipmentName: rec.equipmentName,
    inspector: rec.inspector,
    incidentCount: rec.incidentCount,
    submittedAt: rec.submittedAtLabel || rec.submittedAt,
    ageHours: rec.ageHours,
    ageDays: rec.ageDays,
    status: rec.status,
  };
}

function getPendingApprovalRecordsForLineUser_(userId) {
  const profile = (typeof getLineSubscriberProfileByUserId_ === 'function')
    ? getLineSubscriberProfileByUserId_(userId)
    : null;
  if (!profile) {
    return { ok: false, reason: 'not_subscriber', records: [], isSupervisor: false, viewerName: '' };
  }
  const isSupervisor = !!profile.isSupervisor;
  if (!isSupervisor && !profile.name) {
    return { ok: true, records: [], isSupervisor: false, viewerName: '' };
  }
  const records = listPendingApprovalRecords_({
    includeApprovalUrl: isSupervisor,
    inspectorName: isSupervisor ? '' : profile.name,
  });
  return {
    ok: true,
    records,
    isSupervisor,
    viewerName: profile.name,
  };
}

function pendingApprovalReminderJob_(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const force = !!opts.force;
  const today = opts.today || todayStart_();
  const minAgeHours = Math.max(1, Number(opts.minAgeHours || getSetting_('pendingApprovalReminderMinAgeHours', '24') || 24));
  const todayIso = formatISODate_(today);
  const records = listPendingApprovalRecords_({
    includeApprovalUrl: false,
    minAgeHours,
    now: opts.now instanceof Date ? opts.now : new Date(),
  });
  const resultBase = {
    ok: true,
    type: 'pendingApprovalReminder',
    category: '主管待簽核',
    action: 'skip',
    reason: records.length ? '待簽核提醒另行處理' : '目前沒有逾期待簽核',
    pendingCount: records.length,
    minAgeHours,
  };
  if (!records.length) return rememberPendingApprovalReminderRun_(resultBase, { dryRun, force });

  const props = PropertiesService.getScriptProperties();
  const sentKey = `PENDING_APPROVAL_REMINDER_SENT_${todayIso}`;
  if (!force && props.getProperty(sentKey) === 'YES') {
    return rememberPendingApprovalReminderRun_(Object.assign({}, resultBase, {
      action: 'skip',
      reason: '今日已提醒主管待簽核',
    }), { dryRun, force });
  }
  if (dryRun) {
    const supervisorIds = (typeof getSupervisorUserIds_ === 'function') ? getSupervisorUserIds_() : [];
    return rememberPendingApprovalReminderRun_(Object.assign({}, resultBase, {
      action: 'wouldPush',
      targetMode: 'supervisors',
      targetCount: Array.from(new Set(supervisorIds || [])).length,
      records: records.slice(0, 10).map(pendingApprovalSafeRecord_),
    }), { dryRun, force });
  }

  const pushed = (typeof sendPendingApprovalReminder_ === 'function')
    ? sendPendingApprovalReminder_(records, { minAgeHours })
    : { ok: false, reason: 'missing_sendPendingApprovalReminder' };
  if (pushed && pushed.ok) props.setProperty(sentKey, 'YES');
  return rememberPendingApprovalReminderRun_(Object.assign({}, resultBase, pushed || {}, {
    action: pushed && pushed.ok ? 'pushed' : 'failed',
    records: records.slice(0, 10).map(pendingApprovalSafeRecord_),
  }), { dryRun, force });
}

function rememberPendingApprovalReminderRun_(result, opts) {
  opts = opts || {};
  const key = opts.dryRun ? 'PENDING_APPROVAL_REMINDER_LAST_DRY_RUN' : 'PENDING_APPROVAL_REMINDER_LAST_RUN';
  const payload = {
    recordedAt: Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss'),
    dryRun: !!opts.dryRun,
    force: !!opts.force,
    ok: result && result.ok !== false,
    action: result ? result.action : '',
    reason: result ? result.reason : '',
    pendingCount: result ? Number(result.pendingCount || 0) : 0,
    minAgeHours: result ? Number(result.minAgeHours || 0) : 0,
    targetMode: result ? (result.targetMode || '') : '',
    targetCount: result ? Number(result.targetCount || 0) : 0,
    pushedCount: result ? Number(result.pushedCount || result.successCount || 0) : 0,
    failedCount: result ? Number(result.failedCount || 0) : 0,
    records: result && result.records ? result.records.slice(0, 10) : [],
  };
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(payload));
  return result;
}

function getPendingApprovalReminderRunStatus_() {
  const props = PropertiesService.getScriptProperties();
  return {
    lastRun: parsePendingApprovalReminderRun_(props.getProperty('PENDING_APPROVAL_REMINDER_LAST_RUN')),
    lastDryRun: parsePendingApprovalReminderRun_(props.getProperty('PENDING_APPROVAL_REMINDER_LAST_DRY_RUN')),
  };
}

function parsePendingApprovalReminderRun_(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return { parseError: String(err && err.message || err), raw: String(raw).slice(0, 500) };
  }
}

function approvalResendSafeRecord_(rec) {
  return {
    recordId: rec.recordId,
    checkDate: rec.checkDate,
    formType: rec.formTypeZh,
    equipmentId: rec.equipmentId,
    equipmentName: rec.equipmentName,
    inspector: rec.inspector,
    incidentCount: rec.incidentCount,
    status: rec.status,
  };
}

function approvalResendSafeFilters_(opts) {
  opts = opts || {};
  return {
    recordId: sanitizeText_(opts.recordId, 80),
    date: sanitizeText_(opts.date, 30),
    equipmentId: sanitizeText_(opts.equipmentId, 80),
    equipmentName: sanitizeText_(opts.equipmentName, 200),
    inspector: sanitizeText_(opts.inspector, 80),
  };
}

function handleApprovalSubmission_(payload) {
  if (!payload) throw new Error('缺少 approval payload');
  const recordId = sanitizeText_(payload.recordId, 80);
  const token = sanitizeText_(payload.token, 160);
  const supervisorName = sanitizeText_(payload.supervisorName, 80);
  const supervisorSignature = payload.supervisorSignature;
  if (!recordId) throw new Error('缺少 recordId');
  if (!token || token.length < 32) throw new Error('簽核連結無效');
  if (!supervisorName) throw new Error('缺少主管姓名');
  validateSignature_(supervisorSignature);

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('系統忙碌，請稍後再試');

  try {
    const rec = getApprovalRecord_(recordId, token);
    if (rec.status === '已簽核歸檔') {
      return { ok: true, alreadyApproved: true, recordId, fileUrl: rec.fileUrl };
    }
    if (approvalStatusIsPending_(rec.status)) {
      const archivedSibling = findArchivedApprovalSibling_(rec);
      if (archivedSibling) {
        return {
          ok: true,
          alreadyApproved: true,
          supersededByRecordId: archivedSibling.recordId,
          recordId,
          fileUrl: archivedSibling.fileUrl,
        };
      }
    }
    if (rec.status && rec.status !== '待主管簽核') {
      throw new Error('此紀錄目前不可簽核：' + rec.status);
    }
    if (!rec.draftDocId) throw new Error('待簽核草稿不存在');

    const approvedAt = new Date();
    const checkDate = parseISODate_(rec.checkDate);
    const equipment = getEquipmentById_(rec.equipmentId) || {
      equipmentId: rec.equipmentId,
      equipmentName: rec.equipmentName,
      category: rec.category,
      machineSerial: '',
      machineType: '',
      location: '',
    };

    appendSupervisorApprovalToDoc_(rec.draftDocId, supervisorName, supervisorSignature, approvedAt);

    const pdfBlob = exportChecklistDocToPdf_(rec.draftDocId);
    const fileName = buildPdfFilename_(rec.formType, checkDate, equipment);
    pdfBlob.setName(fileName);
    const folder = getOrCreateArchiveFolderForSubmission_(rec.formType, equipment, checkDate);
    const file = folder.createFile(pdfBlob);
    const fileUrl = file.getUrl();

    updateApprovalRecord_(rec.sheet, rec.headers, rec.rowNo, {
      'PDF連結': fileUrl,
      '簽核狀態': '已簽核歸檔',
      '主管姓名': supervisorName,
      '主管簽核時間': Utilities.formatDate(approvedAt, tz_(), 'yyyy-MM-dd HH:mm:ss'),
    });
    updateIncidentPdfLinks_(recordId, fileUrl);

    trashChecklistDoc_(rec.draftDocId);
    return { ok: true, approved: true, recordId, fileName, fileUrl };
  } finally {
    lock.releaseLock();
  }
}

function getApprovalRecord_(recordId, token) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) throw new Error('找不到待簽核紀錄');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idIdx = headers.indexOf('紀錄ID');
  const tokenIdx = headers.indexOf('主管簽核Token');
  if (idIdx < 0 || tokenIdx < 0) throw new Error('填報紀錄缺簽核欄位，請先執行 initializeDatabase');
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][idIdx] || '') !== recordId) continue;
    if (String(data[i][tokenIdx] || '') !== token) throw new Error('簽核連結無效');
    return approvalRecordFromRow_(sheet, headers, data[i], i + 2);
  }
  throw new Error('找不到待簽核紀錄');
}

function approvalRecordFromRow_(sheet, headers, row, rowNo) {
  const idx = name => headers.indexOf(name);
  const value = name => {
    const i = idx(name);
    return i >= 0 ? row[i] : '';
  };
  const checkDate = value('檢查日期');
  const submittedAt = value('送出時間');
  const payloadRaw = String(value('完整資料JSON') || '');
  let payload = null;
  try { payload = payloadRaw ? JSON.parse(payloadRaw) : null; } catch (_) { payload = null; }
  const formTypeZh = String(value('表單類型') || '');
  return {
    sheet,
    headers,
    rowNo,
    recordId: String(value('紀錄ID') || ''),
    submittedAt: submittedAt instanceof Date
      ? submittedAt.toISOString()
      : String(submittedAt || ''),
    checkDate: checkDate instanceof Date
      ? formatISODate_(checkDate)
      : String(checkDate || '').trim(),
    formType: formTypeZh === '每日' ? 'daily' : 'monthly',
    formTypeZh,
    equipmentId: String(value('設備代號') || ''),
    equipmentName: String(value('設備名稱') || ''),
    category: String(value('設備類別') || ''),
    inspector: String(value('檢點人員') || ''),
    incidentCount: Number(value('異常事件數') || 0),
    fileUrl: String(value('PDF連結') || ''),
    status: String(value('簽核狀態') || ''),
    draftDocId: String(value('草稿DocID') || ''),
    draftDocUrl: String(value('草稿Doc連結') || ''),
    payload,
  };
}

function updateApprovalRecord_(sheet, headers, rowNo, values) {
  Object.keys(values).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) sheet.getRange(rowNo, col + 1).setValue(values[key]);
  });
}

function updateIncidentPdfLinks_(recordId, fileUrl) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const recordCol = headers.indexOf('紀錄ID');
  const pdfCol = headers.indexOf('PDF連結');
  if (recordCol < 0 || pdfCol < 0) return;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][recordCol] || '') === recordId) {
      sheet.getRange(i + 2, pdfCol + 1).setValue(fileUrl);
    }
  }
}

function getApprovalSummary_(recordId, token) {
  const rec = getApprovalRecord_(recordId, token);
  const archivedSibling = approvalStatusIsPending_(rec.status)
    ? findArchivedApprovalSibling_(rec)
    : null;
  const displayStatus = archivedSibling ? '已簽核歸檔' : (rec.status || '待主管簽核');
  const fileUrl = archivedSibling ? (archivedSibling.fileUrl || rec.fileUrl) : rec.fileUrl;
  return {
    ok: true,
    record: {
      recordId: rec.recordId,
      status: displayStatus,
      submittedAt: rec.submittedAt,
      checkDate: rec.checkDate,
      formType: rec.formTypeZh,
      equipmentId: rec.equipmentId,
      equipmentName: rec.equipmentName,
      category: rec.category,
      inspector: rec.inspector,
      incidentCount: rec.incidentCount,
      fileUrl,
      items: approvalCheckItems_(rec),
    },
  };
}

/**
 * 計算 payload 中的異常事件數
 * 依機具類別取對應的「bad value」(daily/monthly 不同)
 *
 * 修 P1.1: 接受 allowedResults 動態判定（避免未來新增結果選項時靜默漏算）
 */
function countIncidents_(payload, allowedResults) {
  if (!Array.isArray(payload.items)) return 0;
  let count = 0;
  for (const it of payload.items) {
    if (isBadResult_(payload.formType, it.result, allowedResults)) count++;
  }
  return count;
}

function itemNameWithSection_(it) {
  const section = String((it && it.section) || '').trim();
  const name = String((it && it.name) || '').trim();
  if (!section || section === '安全衛生量測設備及個人防護具') return name;
  return `${section}：${name}`;
}

function sanitizeCheckResults_(value) {
  if (!value || typeof value !== 'object') return null;
  const out = {
    quantity: sanitizeText_(value.quantity, 20),
    appearance: sanitizeText_(value.appearance, 20),
    operation: sanitizeText_(value.operation, 20),
  };
  return (out.quantity || out.appearance || out.operation) ? out : null;
}

function approvalCheckItems_(rec) {
  const payload = rec && rec.payload;
  if (!payload || !Array.isArray(payload.items)) return [];
  return payload.items.map(it => ({
    order: Number(it.order || 0),
    section: sanitizeText_(it.section, 80),
    name: sanitizeText_(it.name, 200),
    methods: Array.isArray(it.methods) ? it.methods.map(m => sanitizeText_(m, 20)).filter(Boolean) : [],
    method: sanitizeText_(it.method, 80),
    result: sanitizeText_(it.result, 30),
    checkResults: sanitizeCheckResults_(it.checkResults),
    abnormalDesc: sanitizeText_(it.abnormalDesc || it.note, 1000),
    risk: sanitizeText_(it.risk, 30),
    action: sanitizeText_(it.action, 500),
    review: sanitizeText_(it.review, 500),
    photoCount: Array.isArray(it.photos) ? it.photos.length : 0,
  }));
}

/**
 * 判斷一個 result 值是不是「bad」
 *
 * 優先級：
 *   1) 若 caller 帶了 allowedResults 且非空 → 用最後一個當 bad（前端慣例）
 *   2) Fallback (allowedResults 缺 / 空，如 F-CRANE-M 留空時) → 硬編碼歷史相容
 *      - daily: 'X'
 *      - monthly: 'abnormal' 或 'X'（兼顧 simple + crane_full schema）
 *
 * 修 P1.1: 避免 isBadResult_ 跟 handleSubmission_ 動態 badValue 規則不一致
 */
function isBadResult_(formType, result, allowedResults) {
  if (!result) return false;
  if (Array.isArray(allowedResults) && allowedResults.length > 0) {
    return result === allowedResults[allowedResults.length - 1];
  }
  // Fallback (allowedResults 沒帶 / 空)
  if (formType === 'daily') return result === 'X';
  if (formType === 'monthly') return result === 'abnormal' || result === 'X';
  return false;
}

function formatCheckResultsSummary_(it) {
  const checks = (it && it.checkResults) || null;
  if (!checks || typeof checks !== 'object') return '';
  const labels = [
    ['quantity', '數量'],
    ['appearance', '外觀'],
    ['operation', '操作'],
  ];
  const parts = labels
    .filter(([key]) => checks[key])
    .map(([key, label]) => `${label}：${checks[key]}`);
  return parts.length ? parts.join('、') : '';
}

function abnormalDescriptionWithCheckResults_(it) {
  const summary = formatCheckResultsSummary_(it);
  const base = String((it && (it.abnormalDesc || it.note)) || '').trim();
  if (summary && base) return summary + '\n' + base;
  return summary || base || '';
}

/**
 * 把該次填報的所有異常項，透過 LINE 即時通報
 * （sendIncidentAlert_ 在 LineNotify.gs，會自動判斷有沒 token 並決定是否真的 push）
 */
function notifyLineIncidents_(recordId, submittedAt, checkDate, payload, equipment, fileUrl, allowedResults) {
  if (typeof sendIncidentAlert_ !== 'function') return;
  const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
  if (!cfg || !cfg.token) return;  // 沒設 token 就 silently skip

  const formTypeZh = payload.formType === 'daily' ? '每日' : '每月';
  const checkDateStr = formatISODate_(checkDate);

  const incidents = [];
  payload.items.forEach(it => {
    if (!isBadResult_(payload.formType, it.result, allowedResults)) return;
    incidents.push({
      order: it.order,
      itemName: itemNameWithSection_(it),
      result: it.result,
      description: abnormalDescriptionWithCheckResults_(it) || '(無說明)',
      photoCount: Array.isArray(it.photos) ? it.photos.length : 0,
      status: '待處理',
    });
  });
  if (!incidents.length) return;

  if (typeof sendIncidentSummaryAlert_ === 'function') {
    sendIncidentSummaryAlert_({
      recordId,
      equipmentName: equipment.equipmentName,
      category: equipment.category,
      formType: formTypeZh,
      reportDate: checkDateStr,
      fileUrl,
      incidents,
    });
    return;
  }

  incidents.forEach(it => sendIncidentAlert_(Object.assign({
    equipmentName: equipment.equipmentName,
    category: equipment.category,
    formType: formTypeZh,
    reportDate: checkDateStr,
    fileUrl,
  }, it)));
}

/**
 * 把 payload 內每個「結果=bad」項目寫入「機具設備異常事件」工作表
 *
 * 一筆檢查表可能產生多筆異常事件（例如 3 項 X）
 * 每筆都有獨立的事件ID、初始狀態 = 待處理
 */
function writeIncidents_({ recordId, submittedAt, checkDate, formType, equipment, payload, fileUrl, tplMeta }) {
  // 修 P1.1: 用模板 resultOptions 動態判定 bad（兼容未來新結果選項）
  const allowedResults = (tplMeta && Array.isArray(tplMeta.resultOptions) && tplMeta.resultOptions.length)
    ? tplMeta.resultOptions
    : null;
  if (!Array.isArray(payload.items) || !payload.items.length) return;

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet) {
    Logger.log('「機具設備異常事件」表不存在，跳過異常追蹤寫入');
    return;
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const submittedAtStr = Utilities.formatDate(submittedAt, tz_(), 'HH:mm:ss');
  const checkDateStr = formatISODate_(checkDate);

  const rowsToAppend = [];
  for (const it of payload.items) {
    if (!isBadResult_(formType, it.result, allowedResults)) continue;
    const row = new Array(headers.length).fill('');
    const setCol = (name, value) => {
      const i = headers.indexOf(name);
      if (i >= 0) row[i] = value;
    };
    setCol('事件ID', uuid_());
    setCol('通報日期', checkDateStr);
    setCol('通報時間', submittedAtStr);
    setCol('設備代號', equipment.equipmentId);
    setCol('設備名稱', equipment.equipmentName);
    setCol('設備類別', equipment.category);
    setCol('表單類型', formType === 'daily' ? '每日' : '每月');
    setCol('項次', it.order);
    setCol('項目名稱', itemNameWithSection_(it));
    setCol('結果代號', it.result);
    // monthly 用 abnormalDesc，daily 用 note
    setCol('異常說明', abnormalDescriptionWithCheckResults_(it));
    setCol('照片數', Array.isArray(it.photos) ? it.photos.length : 0);
    setCol('PDF連結', fileUrl);
    setCol('紀錄ID', recordId);
    setCol('狀態', '待處理');
    rowsToAppend.push(row);
  }

  if (rowsToAppend.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length).setValues(rowsToAppend);
    Logger.log(`寫入 ${rowsToAppend.length} 筆異常事件`);
  }
}

/**
 * 用 clientSubmissionId 查既有紀錄（idempotency）
 * 找到回 { recordId, fileName, fileUrl }；找不到回 null
 */
function findRecordByClientId_(clientId) {
  if (!clientId) return null;
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const idIdx = headers.indexOf('clientSubmissionId');
  if (idIdx < 0) return null;  // 此 DB 尚未 migrate 此欄位，視為無 idempotency
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (data[i][idIdx] === clientId) {
      return {
        recordId: data[i][headers.indexOf('紀錄ID')],
        fileUrl: data[i][headers.indexOf('PDF連結')] || '',
        approvalPending: headers.indexOf('簽核狀態') >= 0
          ? String(data[i][headers.indexOf('簽核狀態')] || '') === '待主管簽核'
          : false,
      };
    }
  }
  return null;
}

/**
 * 取得指定機具類別 + 週期的檢查表模板（給 PDF 動態載入 templateName 等）
 */
function getTemplateForCategoryCycle_(category, formType, equipment) {
  const cycleMap = { daily: '每日', monthly: '每月' };
  const targetCycle = cycleMap[formType];

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('檢查表模板');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = n => headers.indexOf(n);

  // 修 P1.2: 必要欄位缺失時 throw 而非靜默 return null（避免 schema 漂移時所有列被當停用 → fallback 白名單 → 堆高機/PPE 全送不出）
  ['表單ID', '啟用', '設備類別', '週期'].forEach(col => {
    if (idx(col) < 0) throw new Error('檢查表模板缺必要欄位：' + col + '（請執行 initializeDatabase 補欄）');
  });

  const overrideId = getTemplateOverrideIdForEquipment_(equipment, formType);
  for (let i = 1; i < data.length; i++) {
    if (!isActiveValue_(data[i][idx('啟用')])) continue;
    if (overrideId) {
      if (String(data[i][idx('表單ID')] || '').trim() !== overrideId ||
          data[i][idx('週期')] !== targetCycle) {
        continue;
      }
    } else if (data[i][idx('設備類別')] !== category || data[i][idx('週期')] !== targetCycle) {
      continue;
    }
    {
      // 中英相容（'結果選項' / 'resultOptions'）
      const ropIdx = findCol_(headers, '結果選項', 'resultOptions');
      const ropRaw = ropIdx >= 0 ? String(data[i][ropIdx] || '') : '';
      const resultOptions = ropRaw.split(',').map(s => s.trim()).filter(Boolean);
      return {
        templateId: data[i][idx('表單ID')],
        templateName: data[i][idx('表單名稱')],
        category: data[i][idx('設備類別')],
        cycle: data[i][idx('週期')],
        legalBasis: data[i][idx('法規依據')],
        rule: data[i][idx('填寫規則')],
        resultOptions,
        monthlySchema: (() => {
          const sIdx = findCol_(headers, '月檢樣式', 'monthlySchema');
          return sIdx >= 0 ? normalizeMonthlySchema_(data[i][sIdx]) : '';
        })(),
      };
    }
  }
  return null;
}

/**
 * 組 PDF 檔名
 *
 * 例：1150518_<設備名稱>_日檢.pdf
 */
function buildPdfFilename_(formType, checkDate, equipment) {
  const rocDate = formatROCDate_(checkDate);
  const typeStr = formType === 'daily' ? '日檢' : '月檢';
  // 移除 Drive / 檔名不安全字元 + ASCII 控制字元
  const safeName = (equipment.equipmentName || equipment.equipmentId)
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  return `${rocDate}_${safeName}_${typeStr}.pdf`;
}
