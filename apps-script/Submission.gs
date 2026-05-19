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
 *     signature: 'data:image/png;base64,...',
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

    // 簽名格式驗證（必填、且必須是 data:image/png|jpeg;base64,...）
    validateSignature_(payload.signature);

    // 文字欄位 sanitize（控制字元、長度）
    payload.inspector = sanitizeText_(payload.inspector);
    if (!payload.inspector) throw new Error('缺少 inspector');

    // result / risk / methods 白名單
    // 先取得這張表的 template，從 template.resultOptions 動態決定 result 白名單
    // 找不到 template → fallback 到舊的 hard-coded 白名單
    const equipmentForTpl = getEquipmentById_(payload.equipmentId);
    let tplForValidation = null;
    if (equipmentForTpl) {
      tplForValidation = getTemplateForCategoryCycle_(equipmentForTpl.category, payload.formType);
    }
    const fallbackResult = {
      daily: ['V', 'X', '/'],
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
        result,
        note: sanitizeText_(it.note),
        methods,
        method: sanitizeText_(it.method, 40),                 // simple schema 用
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
      const tplMeta = getTemplateForCategoryCycle_(equipment.category, payload.formType);

      // 1. 先產 PDF
      const pdfBlob = buildPdf_(payload.formType, {
        recordId, submittedAt, checkDate, equipment, payload, template: tplMeta,
      });
      const fileName = buildPdfFilename_(payload.formType, checkDate, equipment);
      pdfBlob.setName(fileName);

      // 2. 上傳 Drive
      const folder = getOrCreateArchiveFolder_(equipment.category, checkDate);
      const file = folder.createFile(pdfBlob);
      const fileUrl = file.getUrl();

      // 3. 最後一次寫入紀錄（含 fileUrl + clientSubmissionId）
      writeRecord_({ recordId, submittedAt, checkDate, formType: payload.formType,
                     equipment, payload, fileUrl });

      return { ok: true, recordId, fileName, fileUrl };

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
function writeRecord_({ recordId, submittedAt, checkDate, formType, equipment, payload, fileUrl }) {
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

  // payload 不含 signature dataURL，photos 也改成只記數量（避免 cell 超 50000）
  const payloadForLog = Object.assign({}, payload, { signature: '[stored in PDF]' });
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
  // codex P1: idempotency 用
  setCol('clientSubmissionId', payload.clientSubmissionId || '');

  sheet.appendRow(row);
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
      };
    }
  }
  return null;
}

/**
 * 取得指定機具類別 + 週期的檢查表模板（給 PDF 動態載入 templateName 等）
 */
function getTemplateForCategoryCycle_(category, formType) {
  const cycleMap = { daily: '每日', monthly: '每月' };
  const targetCycle = cycleMap[formType];

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('檢查表模板');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = n => headers.indexOf(n);

  for (let i = 1; i < data.length; i++) {
    const activeRaw = data[i][idx('啟用')];
    const isActive = activeRaw === true || String(activeRaw).toUpperCase() === 'TRUE';
    if (!isActive) continue;
    if (data[i][idx('設備類別')] === category && data[i][idx('週期')] === targetCycle) {
      const ropRaw = idx('resultOptions') >= 0 ? String(data[i][idx('resultOptions')] || '') : '';
      const resultOptions = ropRaw.split(',').map(s => s.trim()).filter(Boolean);
      return {
        templateId: data[i][idx('表單ID')],
        templateName: data[i][idx('表單名稱')],
        category: data[i][idx('設備類別')],
        cycle: data[i][idx('週期')],
        legalBasis: data[i][idx('法規依據')],
        rule: data[i][idx('填寫規則')],
        resultOptions,
        monthlySchema: idx('monthlySchema') >= 0
          ? String(data[i][idx('monthlySchema')] || '') : '',
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
