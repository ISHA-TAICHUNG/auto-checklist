/**
 * ===== 機具設備異常輕量處理回報 =====
 *
 * 同一次檢查產生的多筆異常，以「紀錄ID」整併為一張處理表。
 * LINE 先以 source.userId 驗證同仁/主管，再核發綁定該人員的限時連結。
 */

const MACHINE_INCIDENT_HANDLING_STATUSES = ['待處理', '處理中', '待重檢', '已完成'];
const MACHINE_INCIDENT_HANDLING_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const MACHINE_INCIDENT_HANDLING_COLUMNS = ['處理更新時間', '處理紀錄PDF'];

function machineIncidentHandlingPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const tpl = HtmlService.createTemplateFromFile('MachineIncidentHandlingPage');
  tpl.recordIdJson = scriptSafeJson_(params.recordId);
  tpl.handlingTokenJson = scriptSafeJson_(params.token);
  return tpl
    .evaluate()
    .setTitle('機具設備異常處理回報')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

function getMachineIncidentHandlingPageData(recordId, token) {
  try {
    const auth = assertMachineIncidentHandlingToken_(recordId, token);
    const group = getMachineIncidentGroupByRecordId_(recordId);
    return {
      ok: true,
      actor: { name: auth.person.name },
      group: publicMachineIncidentHandlingGroup_(group),
    };
  } catch (err) {
    Logger.log('getMachineIncidentHandlingPageData 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitMachineIncidentHandlingFromPage(payload) {
  try {
    return submitMachineIncidentHandling_(payload || {});
  } catch (err) {
    Logger.log('submitMachineIncidentHandlingFromPage 失敗：' + err + '\n' + (err.stack || ''));
    return { ok: false, error: friendlyError_(err) };
  }
}

function submitMachineIncidentHandling_(payload) {
  const recordId = sanitizeText_(payload.recordId, 100).trim();
  const auth = assertMachineIncidentHandlingToken_(recordId, payload.token);
  const updates = normalizeMachineIncidentHandlingUpdates_(payload.items);
  const completedDate = payload.completedDate
    ? formatISODate_(parseISODate_(String(payload.completedDate)))
    : '';
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const group = getMachineIncidentGroupByRecordId_(recordId);
    if (group.allCompleted) {
      return {
        ok: true,
        alreadyCompleted: true,
        group: publicMachineIncidentHandlingGroup_(group),
      };
    }

    const updateById = {};
    updates.forEach(update => { updateById[update.incidentId] = update; });
    const expectedIds = group.items.map(item => item.incidentId);
    if (updates.length !== expectedIds.length || expectedIds.some(id => !updateById[id])) {
      throw new Error('異常項目已變更，請重新從 LINE 開啟最新處理頁');
    }

    const hasCompleted = expectedIds.some(id => updateById[id].status === '已完成');
    const allCompleted = expectedIds.every(id => updateById[id].status === '已完成');
    if (hasCompleted && !completedDate) throw new Error('有項目完成時請填寫處理完成日期');
    updates.forEach(update => {
      if (update.status === '已完成' && !update.note) {
        throw new Error(`第 ${update.order || '—'} 項標記完成前，請填寫處理說明`);
      }
    });

    const sheet = group.sheet;
    const headers = ensureMachineIncidentHandlingColumns_(sheet);
    const col = machineIncidentHandlingColumnMap_(headers);
    const now = Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
    group.items.forEach(item => {
      const update = updateById[item.incidentId];
      sheet.getRange(item.rowNo, col.status + 1).setValue(update.status);
      sheet.getRange(item.rowNo, col.owner + 1).setValue(auth.person.name);
      sheet.getRange(item.rowNo, col.note + 1).setValue(update.note);
      sheet.getRange(item.rowNo, col.completedDate + 1)
        .setValue(update.status === '已完成' ? completedDate : '');
      sheet.getRange(item.rowNo, col.updatedAt + 1).setValue(now);
      if (!allCompleted) sheet.getRange(item.rowNo, col.handlingPdf + 1).setValue('');
    });
    SpreadsheetApp.flush();

    let handlingPdfUrl = '';
    if (allCompleted) {
      const refreshed = getMachineIncidentGroupByRecordId_(recordId);
      const pdf = createMachineIncidentHandlingPdf_(refreshed, {
        actorName: auth.person.name,
        completedDate,
        updatedAt: now,
      });
      handlingPdfUrl = pdf.fileUrl;
      refreshed.items.forEach(item => {
        sheet.getRange(item.rowNo, col.handlingPdf + 1).setValue(handlingPdfUrl);
      });
      SpreadsheetApp.flush();
    }

    const resultGroup = getMachineIncidentGroupByRecordId_(recordId);
    return {
      ok: true,
      allCompleted,
      handlingPdfUrl: handlingPdfUrl || resultGroup.handlingPdfUrl || '',
      group: publicMachineIncidentHandlingGroup_(resultGroup),
    };
  } finally {
    lock.releaseLock();
  }
}

function normalizeMachineIncidentHandlingUpdates_(items) {
  if (!Array.isArray(items) || !items.length || items.length > 50) {
    throw new Error('處理項目內容不正確');
  }
  const seen = {};
  return items.map(item => {
    const incidentId = sanitizeText_(item && item.incidentId, 100).trim();
    const status = sanitizeText_(item && item.status, 20).trim();
    const note = sanitizeText_(item && item.note, 600).trim();
    if (!incidentId || seen[incidentId]) throw new Error('處理項目重複或缺少事件ID');
    if (MACHINE_INCIDENT_HANDLING_STATUSES.indexOf(status) < 0) throw new Error('處理狀態不合法');
    seen[incidentId] = true;
    return {
      incidentId,
      order: Number(item && item.order) || 0,
      status,
      note,
    };
  });
}

function ensureMachineIncidentHandlingColumns_(sheet) {
  let headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(value => String(value || '').trim());
  MACHINE_INCIDENT_HANDLING_COLUMNS.forEach(name => {
    if (headers.indexOf(name) >= 0) return;
    sheet.getRange(1, sheet.getLastColumn() + 1).setValue(name);
    headers.push(name);
  });
  return headers;
}

function machineIncidentHandlingColumnMap_(headers) {
  const required = {
    incidentId: '事件ID',
    reportDate: '通報日期',
    equipmentId: '設備代號',
    equipmentName: '設備名稱',
    category: '設備類別',
    formType: '表單類型',
    order: '項次',
    itemName: '項目名稱',
    result: '結果代號',
    description: '異常說明',
    originalPdf: 'PDF連結',
    recordId: '紀錄ID',
    status: '狀態',
    completedDate: '實際完成日',
    owner: '負責人',
    note: '備註',
    updatedAt: '處理更新時間',
    handlingPdf: '處理紀錄PDF',
  };
  const out = {};
  Object.keys(required).forEach(key => {
    out[key] = headers.indexOf(required[key]);
    if (out[key] < 0) throw new Error('機具設備異常事件缺少欄位：' + required[key]);
  });
  return out;
}

function getMachineIncidentGroupByReference_(reference) {
  const ref = sanitizeText_(reference, 100).trim();
  if (!ref || ref.length < 8) throw new Error('事件ID或紀錄ID至少需 8 碼');
  const sheet = getMachineIncidentSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
  if (!sheet || sheet.getLastRow() < 2) throw new Error('找不到機具設備異常事件');
  const headers = ensureMachineIncidentHandlingColumns_(sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const recordIds = {};
  values.forEach(row => {
    const recordId = String(row[col.recordId] || '').trim();
    const incidentId = String(row[col.incidentId] || '').trim();
    if (recordId === ref || incidentId.indexOf(ref) === 0) recordIds[recordId] = true;
  });
  const matches = Object.keys(recordIds).filter(Boolean);
  if (!matches.length) throw new Error('找不到符合的機具設備異常');
  if (matches.length > 1) throw new Error('事件ID命中多筆檢查，請使用完整事件ID');
  return getMachineIncidentGroupByRecordId_(matches[0]);
}

function getMachineIncidentGroupByRecordId_(recordId) {
  const target = sanitizeText_(recordId, 100).trim();
  if (!target) throw new Error('缺少檢查紀錄ID');
  const sheet = getMachineIncidentSheet_(SpreadsheetApp.openById(CONFIG.DB_SHEET_ID));
  if (!sheet || sheet.getLastRow() < 2) throw new Error('找不到機具設備異常事件');
  const headers = ensureMachineIncidentHandlingColumns_(sheet);
  const col = machineIncidentHandlingColumnMap_(headers);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const items = [];
  values.forEach((row, index) => {
    if (String(row[col.recordId] || '').trim() !== target) return;
    items.push({
      rowNo: index + 2,
      incidentId: String(row[col.incidentId] || '').trim(),
      order: Number(row[col.order]) || 0,
      itemName: String(row[col.itemName] || '').trim(),
      result: String(row[col.result] || '').trim(),
      description: String(row[col.description] || '').trim(),
      status: String(row[col.status] || '').trim() || '待處理',
      completedDate: machineIncidentDateCell_(row[col.completedDate]),
      owner: String(row[col.owner] || '').trim(),
      note: String(row[col.note] || '').trim(),
      updatedAt: machineIncidentDateTimeCell_(row[col.updatedAt]),
      handlingPdfUrl: String(row[col.handlingPdf] || '').trim(),
    });
  });
  if (!items.length) throw new Error('找不到這次檢查的機具設備異常');
  items.sort((a, b) => a.order - b.order);
  const anchorRow = values[items[0].rowNo - 2];
  const group = {
    sheet,
    recordId: target,
    reportDate: machineIncidentDateCell_(anchorRow[col.reportDate]),
    equipmentId: String(anchorRow[col.equipmentId] || '').trim(),
    equipmentName: String(anchorRow[col.equipmentName] || '').trim(),
    category: String(anchorRow[col.category] || '').trim(),
    formType: String(anchorRow[col.formType] || '').trim(),
    originalPdfUrl: String(anchorRow[col.originalPdf] || '').trim(),
    handlingPdfUrl: items.map(item => item.handlingPdfUrl).filter(Boolean)[0] || '',
    items,
  };
  group.allCompleted = items.every(item => item.status === '已完成');
  return group;
}

function publicMachineIncidentHandlingGroup_(group) {
  return {
    recordId: group.recordId,
    reportDate: group.reportDate,
    equipmentName: group.equipmentName,
    category: group.category,
    formType: group.formType,
    originalPdfUrl: /^https?:\/\//.test(group.originalPdfUrl || '') ? group.originalPdfUrl : '',
    handlingPdfUrl: /^https?:\/\//.test(group.handlingPdfUrl || '') ? group.handlingPdfUrl : '',
    allCompleted: !!group.allCompleted,
    items: group.items.map(item => ({
      incidentId: item.incidentId,
      order: item.order,
      itemName: item.itemName,
      description: item.description,
      status: item.status,
      completedDate: item.completedDate,
      owner: item.owner,
      note: item.note,
      updatedAt: item.updatedAt,
    })),
  };
}

function machineIncidentDateCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return formatISODate_(value);
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
  return match
    ? `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`
    : text;
}

function machineIncidentDateTimeCell_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(value || '').trim();
}

function createMachineIncidentHandlingLink_(recordId, userId) {
  const profile = getLineSubscriberProfileByUserId_(userId);
  if (!profile || !(profile.isStaff || profile.isSupervisor)) {
    throw new Error('只有訂閱者清單中的同仁或主管可以處理設備異常');
  }
  const personKey = lineSubscriberPersonKey_(userId);
  const token = createMachineIncidentHandlingToken_(recordId, personKey);
  const base = getWebAppBaseUrl_();
  if (!base) throw new Error('尚未設定 Web App 網址');
  return {
    url: `${base}?page=machine-incident-handle&recordId=${encodeURIComponent(recordId)}&token=${encodeURIComponent(token)}`,
    profile,
  };
}

function createMachineIncidentHandlingToken_(recordId, personKey) {
  const payload = {
    v: 1,
    r: String(recordId || ''),
    p: String(personKey || ''),
    e: Math.floor(Date.now() / 1000) + MACHINE_INCIDENT_HANDLING_TOKEN_TTL_SECONDS,
  };
  const encoded = Utilities.base64EncodeWebSafe(
    JSON.stringify(payload),
    Utilities.Charset.UTF_8,
  ).replace(/=+$/g, '');
  return encoded + '.' + machineIncidentHandlingSignature_(encoded);
}

function assertMachineIncidentHandlingToken_(recordId, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2 || !machineIncidentConstantTimeEqual_(parts[1], machineIncidentHandlingSignature_(parts[0]))) {
    throw new Error('處理回報連結無效，請從 LINE 重新開啟');
  }
  let payload;
  try {
    let encoded = parts[0];
    while (encoded.length % 4) encoded += '=';
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(encoded)).getDataAsString('UTF-8'));
  } catch (_) {
    throw new Error('處理回報連結格式錯誤');
  }
  if (payload.v !== 1 || String(payload.r || '') !== String(recordId || '')) {
    throw new Error('處理回報連結與檢查紀錄不符');
  }
  if (!payload.e || Number(payload.e) < Math.floor(Date.now() / 1000)) {
    throw new Error('處理回報連結已逾期，請從 LINE 重新開啟');
  }
  const person = findLineSubscriberPersonByKey_(payload.p, { requireStaff: true });
  if (!person) throw new Error('你目前沒有處理這筆設備異常的權限');
  return { payload, person };
}

function machineIncidentHandlingSecret_() {
  const props = PropertiesService.getScriptProperties();
  let secret = props.getProperty('MACHINE_INCIDENT_HANDLING_SECRET') || '';
  if (!secret) {
    secret = uuid_() + '-' + uuid_();
    props.setProperty('MACHINE_INCIDENT_HANDLING_SECRET', secret);
  }
  return secret;
}

function machineIncidentHandlingSignature_(encoded) {
  const bytes = Utilities.computeHmacSha256Signature(
    String(encoded || ''),
    machineIncidentHandlingSecret_(),
    Utilities.Charset.UTF_8,
  );
  return bytes.map(value => ((value + 256) % 256).toString(16).padStart(2, '0')).join('');
}

function machineIncidentConstantTimeEqual_(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }
  return diff === 0;
}

function buildMachineIncidentHandlingLinkFlex_(group, url, actorName) {
  return {
    type: 'flex',
    altText: `機具設備異常處理回報｜${group.equipmentName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#B3261E',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🛠 機具設備異常處理回報', color: '#FFFFFF', weight: 'bold', size: 'lg', wrap: true },
          { type: 'text', text: `${group.formType || '檢查'}｜${group.items.length} 項`, color: '#FCE8E6', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          dailyIncidentFlexField_('設備', group.equipmentName, { weight: 'bold' }),
          dailyIncidentFlexField_('日期', group.reportDate),
          dailyIncidentFlexField_('處理人', actorName),
          dailyIncidentFlexField_('待處理', `${group.items.filter(item => item.status !== '已完成').length} 項`, { color: '#B3261E', weight: 'bold' }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [{
          type: 'button',
          style: 'primary',
          color: '#B3261E',
          action: { type: 'uri', label: '開啟處理回報', uri: url },
        }],
      },
    },
  };
}

function createMachineIncidentHandlingPdf_(group, meta) {
  const equipment = getEquipmentById_(group.equipmentId) || {
    equipmentId: group.equipmentId,
    equipmentName: group.equipmentName,
    category: group.category,
    location: '',
  };
  const formType = group.formType === '每日' ? 'daily' : 'monthly';
  const date = parseISODate_(group.reportDate);
  const archive = getOrCreateArchiveFolderForSubmission_(formType, equipment, date);
  const folder = getOrCreateSubFolder_(archive, '異常處理紀錄');
  const shortRecord = String(group.recordId || '').replace(/[^A-Za-z0-9]/g, '').substring(0, 8);
  const fileName = `${formatROCDate_(date)}_${cleanDriveFolderName_(group.equipmentName)}_機具設備異常處理紀錄_${shortRecord}.pdf`;
  const doc = DocumentApp.create('tmp_machine_incident_' + shortRecord + '_' + Date.now());
  const docId = doc.getId();
  try {
    const body = doc.getBody();
    body.clear();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);
    body.appendParagraph('機具設備異常處理紀錄')
      .setHeading(DocumentApp.ParagraphHeading.TITLE)
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendParagraph(getOrgHeader_())
      .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
      .editAsText().setFontSize(11).setForegroundColor('#555555');
    body.appendParagraph('');
    const metaTable = body.appendTable([
      ['設備名稱', group.equipmentName, '表單類型', group.formType],
      ['檢查日期', group.reportDate, '異常項數', `${group.items.length} 項`],
      ['處理人', meta.actorName, '完成日期', meta.completedDate],
      ['處理時間', meta.updatedAt, '檢查紀錄ID', group.recordId],
    ]);
    styleMetaTable_(metaTable);
    body.appendParagraph('');
    const rows = [['項次', '異常項目', '原異常說明', '處理狀態', '處理說明']];
    group.items.forEach(item => rows.push([
      String(item.order || ''),
      item.itemName || '',
      item.description || '',
      item.status || '',
      item.note || '',
    ]));
    const table = body.appendTable(rows);
    styleMachineIncidentHandlingTable_(table);
    if (group.originalPdfUrl) {
      body.appendParagraph('');
      body.appendParagraph('原檢查紀錄 PDF：' + group.originalPdfUrl)
        .editAsText().setFontSize(9).setForegroundColor('#555555');
    }
    body.appendParagraph('');
    body.appendParagraph('本紀錄由處理人完成回報後產製。')
      .setAlignment(DocumentApp.HorizontalAlignment.RIGHT)
      .editAsText().setFontSize(9).setForegroundColor('#888888');
    doc.saveAndClose();
    const blob = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(fileName);
    const file = folder.createFile(blob);
    sharePdfFileForLinkView_(file, 'machine-incident-handling');
    return { fileId: file.getId(), fileUrl: file.getUrl(), fileName };
  } finally {
    try { DriveApp.getFileById(docId).setTrashed(true); } catch (err) { Logger.log('刪除設備異常暫存 Doc 失敗：' + err); }
  }
}

function styleMachineIncidentHandlingTable_(table) {
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(5).setPaddingBottom(5).setPaddingLeft(5).setPaddingRight(5);
      const text = cell.editAsText().setFontSize(9);
      if (r === 0) {
        cell.setBackgroundColor('#1A73E8');
        text.setForegroundColor('#FFFFFF').setBold(true);
      } else if (c === 3) {
        text.setForegroundColor(row.getCell(c).getText() === '已完成' ? '#137333' : '#B3261E').setBold(true);
      }
    }
  }
}
