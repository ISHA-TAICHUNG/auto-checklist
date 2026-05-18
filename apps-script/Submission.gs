/**
 * ===== 接收前端送出的檢查表 =====
 *
 * 流程：
 *   1. 驗證 payload
 *   2. 寫入「填報紀錄」工作表
 *   3. 產生 PDF
 *   4. 上傳到 Drive 對應年月資料夾
 *   5. 把 PDF 連結寫回紀錄
 *
 * payload 範例（daily）：
 *   {
 *     formType: 'daily',
 *     equipmentId: 'CRANE-LJ-001',
 *     checkYear: 115,
 *     checkMonth: 5,
 *     // 31 天結果，未檢查者 null
 *     results: [
 *       { day: 1, items: ['V','V','V','V','V','V','V'], note: '', signature: '<dataURL>' },
 *       { day: 2, items: ['V','X','V','V','V','V','V'], note: '制動器異響', signature: '<dataURL>' },
 *       ...
 *     ],
 *     inspector: '張三',
 *   }
 *
 * payload 範例（monthly）：
 *   {
 *     formType: 'monthly',
 *     equipmentId: 'CRANE-LJ-001',
 *     checkDate: '2026-05-31',
 *     items: [
 *       { order: 1, method: ['目視'], result: 'normal', abnormalDesc: '', risk: '', action: '', review: '' },
 *       ...
 *     ],
 *     inspector: '李四',
 *     signature: '<dataURL>',
 *   }
 */

function handleSubmission_(payload) {
  try {
    if (!payload || !payload.formType) throw new Error('缺少 formType');

    const equipment = getEquipmentById_(payload.equipmentId);
    if (!equipment) throw new Error('找不到設備：' + payload.equipmentId);

    const recordId = uuid_();
    const submittedAt = new Date();
    const checkDate = payload.formType === 'monthly'
      ? new Date(payload.checkDate)
      : submittedAt;

    // 1. 寫紀錄
    writeRecord_({
      recordId,
      submittedAt,
      checkDate,
      formType: payload.formType,
      equipment,
      payload,
    });

    // 2. 產 PDF
    const pdfBlob = buildPdf_(payload.formType, {
      recordId,
      submittedAt,
      checkDate,
      equipment,
      payload,
    });

    // 3. 上傳 Drive（依設備類別、民國年、民國月歸檔）
    const fileName = buildPdfFilename_(payload.formType, checkDate, equipment);
    pdfBlob.setName(fileName);

    const folder = getOrCreateArchiveFolder_(equipment.category, checkDate);
    const file = folder.createFile(pdfBlob);
    const fileUrl = file.getUrl();

    // 4. 把 PDF URL 回填到紀錄
    updateRecordPdfUrl_(recordId, fileUrl);

    return { ok: true, recordId, fileName, fileUrl };

  } catch (err) {
    Logger.log('submitForm 失敗：' + err + '\n' + err.stack);
    return { ok: false, error: String(err.message || err) };
  }
}

/**
 * 將紀錄寫入「填報紀錄」工作表
 */
function writeRecord_({ recordId, submittedAt, checkDate, formType, equipment, payload }) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');

  sheet.appendRow([
    recordId,
    Utilities.formatDate(submittedAt, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
    formatISODate_(checkDate),
    formType === 'daily' ? '每日' : '每月',
    equipment.equipmentId,
    equipment.equipmentName,
    equipment.category,
    payload.inspector || '',
    JSON.stringify(payload),   // 完整 payload 存起來以備查
    '',                         // PDF URL（之後回填）
    '',                         // 備註
  ]);
}

/**
 * 把 PDF URL 回填到對應紀錄列
 */
function updateRecordPdfUrl_(recordId, fileUrl) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === recordId) {
      sheet.getRange(i + 1, 10).setValue(fileUrl);
      return;
    }
  }
}

/**
 * 組 PDF 檔名
 *
 * 規則：
 *   每日：{民國年月日}_{設備名稱}_日檢.pdf
 *   每月：{民國年月日}_{設備名稱}_月檢.pdf
 *
 * 例：1150518_<設備名稱>_日檢.pdf
 */
function buildPdfFilename_(formType, checkDate, equipment) {
  const rocDate = formatROCDate_(checkDate);
  const typeStr = formType === 'daily' ? '日檢' : '月檢';
  const safeName = (equipment.equipmentName || equipment.equipmentId).replace(/[\\/:*?"<>|]/g, '_');
  return `${rocDate}_${safeName}_${typeStr}.pdf`;
}
