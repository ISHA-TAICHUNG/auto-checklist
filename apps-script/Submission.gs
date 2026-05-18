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
 *     equipmentId: 'CRANE-LJ-001',
 *     checkDate: '2026-05-18',            // 必填，daily 也要
 *     inspector: '張三',
 *     items: [{ order, name, result, note }, ...],
 *     signature: 'data:image/png;base64,...',
 *   }
 *
 * payload 範例（monthly）：
 *   {
 *     formType: 'monthly',
 *     equipmentId: 'CRANE-LJ-001',
 *     checkDate: '2026-05-31',
 *     inspector: '李四',
 *     items: [{ order, name, methods, result, abnormalDesc, risk, action, review }, ...],
 *     signature: 'data:image/png;base64,...',
 *   }
 */

function handleSubmission_(payload) {
  try {
    if (!payload || !payload.formType) throw new Error('缺少 formType');
    if (!payload.equipmentId) throw new Error('缺少 equipmentId');
    if (!payload.checkDate) throw new Error('缺少 checkDate');
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error('缺少 items');
    }

    // 簽名格式驗證（必須是 data:image/png|jpeg;base64,...）
    validateSignature_(payload.signature);

    // 文字欄位 sanitize（控制字元、長度）
    payload.inspector = sanitizeText_(payload.inspector);
    if (!payload.inspector) throw new Error('缺少 inspector');
    payload.items = payload.items.map(it => ({
      order: Number(it.order) || 0,
      name: sanitizeText_(it.name, 200),
      result: sanitizeText_(it.result, 30),
      note: sanitizeText_(it.note),
      methods: Array.isArray(it.methods) ? it.methods.map(m => sanitizeText_(m, 20)) : undefined,
      abnormalDesc: sanitizeText_(it.abnormalDesc),
      risk: sanitizeText_(it.risk, 30),
      action: sanitizeText_(it.action),
      review: sanitizeText_(it.review),
    }));

    const equipment = getEquipmentById_(payload.equipmentId);
    if (!equipment) throw new Error('找不到設備：' + payload.equipmentId);

    // 鎖：避免同設備同日重複寫 / 並發 race
    const lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) throw new Error('系統忙碌，請稍後再試');

    try {
      const recordId = uuid_();
      const submittedAt = new Date();
      // daily 和 monthly 都用 payload.checkDate
      const checkDate = parseISODate_(payload.checkDate);

      // 1. 先產 PDF
      const pdfBlob = buildPdf_(payload.formType, {
        recordId, submittedAt, checkDate, equipment, payload,
      });
      const fileName = buildPdfFilename_(payload.formType, checkDate, equipment);
      pdfBlob.setName(fileName);

      // 2. 上傳 Drive
      const folder = getOrCreateArchiveFolder_(equipment.category, checkDate);
      const file = folder.createFile(pdfBlob);
      const fileUrl = file.getUrl();

      // 3. 最後一次寫入紀錄（含 fileUrl）— 一次完成、無回填、無髒資料
      writeRecord_({ recordId, submittedAt, checkDate, formType: payload.formType,
                     equipment, payload, fileUrl });

      return { ok: true, recordId, fileName, fileUrl };

    } finally {
      lock.releaseLock();
    }

  } catch (err) {
    Logger.log('handleSubmission_ 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
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

  // payload 不含 signature dataURL（避免 cell 超長）
  const payloadForLog = Object.assign({}, payload, { signature: '[stored in PDF]' });
  setCol('完整資料JSON', JSON.stringify(payloadForLog));

  setCol('PDF連結', fileUrl);

  sheet.appendRow(row);
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
