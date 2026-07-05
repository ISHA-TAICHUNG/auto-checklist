/**
 * ===== 月度防護具檢點彙整確認表 =====
 *
 * 用途：依「場地使用紀錄」彙整當月需確認的場地防護具配置狀態，
 *      由承辦人於月底/月初逐筆確認狀態、補充備註並簽名產出 PDF。
 *
 * 注意：本表不是每日人工檢點替代品；它是月度彙整確認留痕。
 */

const MONTHLY_PPE_SUMMARY_FOLDER_NAME = '月度防護具檢點彙整確認表';
const MONTHLY_PPE_SUMMARY_EQUIPMENTS = [
  { id: 'VENUE-CRANE', label: '起重機防護具', usageCategory: '固定式起重機', usageEquipmentId: 'CRANE-LJ-001' },
  { id: 'VENUE-FORK', label: '堆高機防護具', usageCategory: '堆高機', usageEquipmentId: 'FORK-LJ-A' },
];
const MONTHLY_PPE_CONFIRMATION_STATUSES = ['未接獲異常', '異常已改善', '異常待追蹤', '不適用'];

function generateMonthlyPpeSummary(options) {
  return generateMonthlyPpeSummary_(options || {});
}

function generateMonthlyPpeSummary_(options) {
  const summary = monthlyPpeBuildSummary_(options || {});
  const confirmation = monthlyPpeNormalizeConfirmation_(options && options.confirmation);
  if (options && Array.isArray(options.rows)) {
    monthlyPpeApplyConfirmationRows_(summary.records, options.rows);
    summary.grouped = monthlyPpeGroupRecords_(summary.records);
    summary.equipments = monthlyPpeEquipmentSummaries_(summary.grouped);
  }
  const pdf = monthlyPpeCreateSummaryPdf_(summary.month, summary.grouped, summary.records, confirmation);

  return {
    month: summary.month.label,
    confirmUrl: summary.confirmUrl,
    fileName: pdf.fileName,
    fileId: pdf.fileId,
    fileUrl: pdf.fileUrl,
    folderUrl: pdf.folderUrl,
    recordCount: summary.records.length,
    equipments: summary.equipments,
    confirmed: !!confirmation.signatureDataUrl,
  };
}

function monthlyPpeSummaryReminderJob(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const today = opts.today || todayStart_();
  const todayIso = formatISODate_(today);

  if (!monthlyPpeIsFirstBusinessDayOfMonth_(today)) {
    return {
      action: 'skip',
      category: '月度防護具檢點彙整確認',
      formType: '每月',
      reason: '非每月第一個工作日',
      date: todayIso,
    };
  }

  const targetMonth = monthlyPpePreviousMonth_(today);
  const summary = monthlyPpeBuildSummary_({
    year: targetMonth.year,
    month: targetMonth.month,
  });

  if (dryRun) {
    return {
      action: 'wouldRemind',
      category: '月度防護具檢點彙整確認',
      formType: '每月',
      month: targetMonth.label,
      recordCount: summary.recordCount,
      confirmUrl: summary.confirmUrl,
      reason: '每月第一個工作日提醒承辦彙整確認並簽名',
    };
  }

  const result = sendMonthlyPpeSummaryReminder_(summary);
  return Object.assign({
    action: result && result.ok ? 'reminded' : 'reminderFailed',
    category: '月度防護具檢點彙整確認',
    formType: '每月',
    month: targetMonth.label,
    recordCount: summary.recordCount,
    confirmUrl: summary.confirmUrl,
  }, result || {});
}

function monthlyPpeConfirmPageResponse_(e) {
  const params = (e && e.parameter) || {};
  const template = HtmlService.createTemplateFromFile('MonthlyPpeConfirmPage');
  template.initialParamsJson = JSON.stringify({
    year: params.year || '',
    month: params.month || '',
    token: params.token || '',
  }).replace(/</g, '\\u003c');

  const html = template
    .evaluate()
    .setTitle('月度防護具彙整確認')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  return html;
}

function getMonthlyPpeConfirmationPageData(payload) {
  return getMonthlyPpeConfirmationPageData_(payload || {});
}

function getMonthlyPpeConfirmationPageData_(payload) {
  const month = monthlyPpeResolveMonth_(payload || {});
  monthlyPpeValidateConfirmationToken_(month, payload && payload.token);
  const summary = monthlyPpeBuildSummary_(month);
  return {
    ok: true,
    month: monthlyPpeMonthPayload_(month),
    confirmUrl: summary.confirmUrl,
    statusOptions: MONTHLY_PPE_CONFIRMATION_STATUSES.slice(),
    recordCount: summary.recordCount,
    equipments: summary.equipments,
    records: summary.records.map(monthlyPpeRecordPayload_),
  };
}

function submitMonthlyPpeConfirmationFromPage(payload) {
  payload = payload || {};
  const month = monthlyPpeResolveMonth_(payload);
  monthlyPpeValidateConfirmationToken_(month, payload.token);

  const handlerName = sanitizeText_(payload.handlerName, 60).trim();
  if (!handlerName) throw new Error('請填寫承辦人姓名');
  validateSignature_(payload.signatureDataUrl);

  const summary = monthlyPpeBuildSummary_(month);
  monthlyPpeApplyConfirmationRows_(summary.records, payload.rows || []);
  summary.grouped = monthlyPpeGroupRecords_(summary.records);
  summary.equipments = monthlyPpeEquipmentSummaries_(summary.grouped);

  const confirmation = monthlyPpeNormalizeConfirmation_({
    handlerName,
    summaryNote: payload.summaryNote,
    signatureDataUrl: payload.signatureDataUrl,
    confirmedAt: new Date(),
  });
  const pdf = monthlyPpeCreateSummaryPdf_(summary.month, summary.grouped, summary.records, confirmation);

  return {
    ok: true,
    month: summary.month.label,
    fileName: pdf.fileName,
    fileId: pdf.fileId,
    fileUrl: pdf.fileUrl,
    folderUrl: pdf.folderUrl,
    recordCount: summary.records.length,
    confirmedAt: monthlyPpeDisplayDateTime_(confirmation.confirmedAt),
  };
}

function monthlyPpeBuildSummary_(options) {
  const month = options && options.start ? options : monthlyPpeResolveMonth_(options || {});
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const incidentMap = monthlyPpeCollectMachineIncidents_(ss, month);
  const records = monthlyPpeCollectRecords_(ss, month, incidentMap);
  const grouped = monthlyPpeGroupRecords_(records);
  return {
    month,
    records,
    grouped,
    recordCount: records.length,
    equipments: monthlyPpeEquipmentSummaries_(grouped),
    confirmUrl: monthlyPpeBuildConfirmUrl_(month),
  };
}

function monthlyPpePreviousMonth_(date) {
  const p = dateParts_(date || todayStart_());
  const prev = new Date(p.y, p.m - 2, 1);
  return monthlyPpeResolveMonth_({ year: prev.getFullYear(), month: prev.getMonth() + 1 });
}

function monthlyPpeIsFirstBusinessDayOfMonth_(date) {
  const target = date || todayStart_();
  const p = dateParts_(target);
  for (let d = 1; d <= p.d; d++) {
    const candidate = new Date(p.y, p.m - 1, d);
    const isBiz = (typeof isBusinessDay_ === 'function')
      ? isBusinessDay_(candidate)
      : candidate.getDay() >= 1 && candidate.getDay() <= 5;
    if (!isBiz) continue;
    return formatISODate_(candidate) === formatISODate_(target);
  }
  return false;
}

function sendMonthlyPpeSummaryReminder_(summary) {
  const flex = buildMonthlyPpeSummaryReminderFlex_(summary);
  return linePushToMonthlyPpeSummaryStaff_(withQuickReply_(flex));
}

function buildMonthlyPpeSummaryReminderFlex_(summary) {
  summary = summary || {};
  const monthLabel = monthlyPpeSummaryMonthLabel_(summary);
  const countLabel = `${summary.recordCount || 0} 筆`;
  const equipmentRows = (summary.equipments || []).map(item => ({
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: item.label || item.equipmentId || '-', flex: 5, size: 'sm', color: '#202124', weight: 'bold', wrap: true },
      { type: 'text', text: `${item.recordCount || 0} 筆`, flex: 2, size: 'sm', color: '#137333', weight: 'bold', align: 'end' },
    ],
  }));
  return {
    type: 'flex',
    altText: `🦺 ${monthLabel} 防護具彙整確認`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#5F6368',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 月度防護具確認', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: monthLabel, color: '#F1F3F4', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '請承辦人開啟確認頁，逐日確認防護具配置狀態並簽名產出 PDF。', size: 'sm', color: '#202124', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              { type: 'text', text: '待確認筆數', flex: 5, size: 'sm', color: '#666666' },
              { type: 'text', text: countLabel, flex: 2, size: 'sm', color: '#202124', weight: 'bold', align: 'end' },
            ],
          },
          ...equipmentRows,
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#5F6368',
            action: {
              type: 'uri',
              label: '開啟確認頁',
              uri: summary.confirmUrl || 'https://drive.google.com/',
            },
          },
        ],
      },
    },
  };
}

function monthlyPpeSummaryMonthLabel_(summary) {
  const month = summary && summary.month;
  if (month && typeof month === 'object') {
    const label = String(month.label || month.rocYm || '').trim();
    if (label) return label;
  }
  const text = String((summary && (summary.month || summary.label)) || '').trim();
  return text || '月份未指定';
}

function linePushToMonthlyPpeSummaryStaff_(messages) {
  const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
  if (!cfg || !cfg.token) return { ok: false, reason: 'no_token', targetMode: 'monthly-ppe-summary-staff', targetCount: 0 };
  if (!Array.isArray(messages)) messages = [messages];
  const ids = monthlyPpeSummaryStaffRecipientIds_();
  if (ids.length > 0) {
    let pushedCount = 0;
    let failedCount = 0;
    const failureCodes = [];
    let firstFailureBody = '';
    ids.forEach(id => {
      const res = linePushTo_(id, messages, 'push');
      if (res && res.ok) {
        pushedCount++;
        return;
      }
      failedCount++;
      if (res && res.code && failureCodes.indexOf(res.code) < 0) failureCodes.push(res.code);
      if (!firstFailureBody && res && res.body) firstFailureBody = res.body;
    });
    return {
      ok: pushedCount > 0,
      targetMode: 'monthly-ppe-summary-staff',
      targetCount: ids.length,
      pushedCount,
      failedCount,
      failureCodes,
      firstFailureBody,
    };
  }
  return { ok: false, reason: 'no_staff_target', targetMode: 'monthly-ppe-summary-staff', targetCount: 0 };
}

function monthlyPpeSummaryStaffRecipientIds_() {
  const ids = [];
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    const sheet = getLineSubscriberSheet_(ss);
    if (!sheet || sheet.getLastRow() < 2) return ids;
    const data = sheet.getDataRange().getValues();
    const headers = data[0].map(h => String(h || '').trim());
    const idCol = headers.indexOf('LINE_USER_ID');
    const subscribeCol = getLineSubscriberActiveColumnIndex_(headers);
    const staffCol = headers.indexOf('是否為同仁');
    const noticeCol = headers.indexOf(LINE_NOTIFICATION_COLUMNS.MACHINE_MONTHLY_REMINDER);
    if (idCol < 0 || staffCol < 0) return ids;
    data.slice(1).forEach(row => {
      const id = String(row[idCol] || '').trim();
      const subscribed = subscribeCol < 0 ? true : isActiveValue_(row[subscribeCol]);
      const isStaff = isActiveValue_(row[staffCol]);
      const notificationEnabled = isLineNotificationEnabled_(noticeCol >= 0 ? row[noticeCol] : '');
      if (id && subscribed && isStaff && notificationEnabled) ids.push(id);
    });
  } catch (err) {
    Logger.log('[MonthlyPpeSummary] 讀取月度防護具確認提醒收件者失敗: ' + err);
  }
  return Array.from(new Set(ids));
}

function monthlyPpeResolveMonth_(options) {
  const now = new Date();
  const nowParts = dateParts_(now);
  let year = Number(options.year || options.y || options.gregorianYear || nowParts.y);
  const rocYear = Number(options.rocYear || options.roc || 0);
  if ((!year || isNaN(year)) && rocYear) year = rocYear + 1911;
  if (year > 0 && year < 1911) year += 1911;
  if (!year || isNaN(year)) year = nowParts.y;

  let month = Number(options.month || options.m || nowParts.m);
  if (!month || isNaN(month) || month < 1 || month > 12) month = nowParts.m;

  const start = new Date(year, month - 1, 1);
  const next = new Date(year, month, 1);
  const end = new Date(next.getTime() - 24 * 60 * 60 * 1000);
  const label = `${year - 1911}年${String(month).padStart(2, '0')}月`;

  return {
    year,
    month,
    start,
    next,
    end,
    startIso: formatISODate_(start),
    nextIso: formatISODate_(next),
    label,
    rocYm: `${year - 1911}${String(month).padStart(2, '0')}`,
  };
}

function monthlyPpeCollectRecords_(ss, month, incidentMap) {
  const out = [];
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(item => {
    const equipment = getEquipmentById_(item.id);
    if (!equipment || !equipment.active) return;
    const usageProbe = monthlyPpeUsageProbeEquipment_(item, equipment);
    for (let d = new Date(month.start.getTime()); d < month.next; d.setDate(d.getDate() + 1)) {
      const checkDate = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      const usage = getVenueUsage_(usageProbe, checkDate);
      if (!usage || !usage.used) continue;
      const iso = formatISODate_(checkDate);
      const key = `${item.id}|${iso}`;
      const linkedIncidents = ((incidentMap && incidentMap.byEquipmentDate) || {})[key] || [];
      const abnormalCount = linkedIncidents.length;
      out.push({
        key,
        checkDate: iso,
        equipmentId: item.id,
        equipmentLabel: item.label,
        equipmentName: equipment.equipmentName || item.label,
        category: equipment.category || '',
        location: equipment.location || '',
        usageContent: usage.content || '',
        usageReason: usage.reason || '',
        sourceLabel: '場地使用紀錄',
        status: abnormalCount > 0 ? '異常待追蹤' : '未接獲異常',
        note: '',
        abnormalCount,
        abnormalSummary: monthlyPpeAbnormalSummary_([], linkedIncidents),
        incidentStatusSummary: monthlyPpeIncidentStatusSummary_(linkedIncidents),
      });
    }
  });

  out.sort((a, b) => {
    if (a.checkDate !== b.checkDate) return a.checkDate < b.checkDate ? -1 : 1;
    return a.equipmentId < b.equipmentId ? -1 : 1;
  });
  return out;
}

function monthlyPpeUsageProbeEquipment_(item, ppeEquipment) {
  const usageCategory = String((item && item.usageCategory) || '').trim();
  const probe = Object.assign({}, ppeEquipment || {});
  if (usageCategory) probe.category = usageCategory;

  if (!String(probe.venueSheetTab || '').trim()) {
    const linkedId = String((item && item.usageEquipmentId) || '').trim();
    const linked = linkedId ? getEquipmentById_(linkedId) : null;
    if (linked && String(linked.venueSheetTab || '').trim()) {
      probe.venueSheetTab = linked.venueSheetTab;
    }
  }

  return probe;
}

function monthlyPpeCollectMachineIncidents_(ss, month) {
  const sheet = getMachineIncidentSheet_(ss);
  const map = { byRecordId: {}, byEquipmentDate: {} };
  if (!sheet || sheet.getLastRow() < 2) return map;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h || '').trim());
  const idx = (...names) => findCol_(headers, ...names);
  const col = {
    recordId: idx('紀錄ID'),
    date: idx('通報日期'),
    equipmentId: idx('設備代號'),
    order: idx('項次'),
    itemName: idx('項目名稱'),
    description: idx('異常說明'),
    status: idx('狀態'),
  };
  if (col.date < 0 || col.equipmentId < 0) return map;

  const targetIds = MONTHLY_PPE_SUMMARY_EQUIPMENTS.map(e => e.id);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();

  values.forEach(row => {
    const equipmentId = monthlyPpeCell_(row, col.equipmentId).toUpperCase();
    if (targetIds.indexOf(equipmentId) < 0) return;
    const date = monthlyPpeParseDate_(row[col.date]);
    if (!date) return;
    const iso = formatISODate_(date);
    if (iso < month.startIso || iso >= month.nextIso) return;
    const item = {
      order: monthlyPpeCell_(row, col.order),
      itemName: monthlyPpeCell_(row, col.itemName),
      description: monthlyPpeCell_(row, col.description),
      status: monthlyPpeCell_(row, col.status) || '待處理',
    };
    const recordId = monthlyPpeCell_(row, col.recordId);
    if (recordId) {
      if (!map.byRecordId[recordId]) map.byRecordId[recordId] = [];
      map.byRecordId[recordId].push(item);
      map[recordId] = map.byRecordId[recordId]; // backward-compatible shape
    }
    const dateKey = `${equipmentId}|${iso}`;
    if (!map.byEquipmentDate[dateKey]) map.byEquipmentDate[dateKey] = [];
    map.byEquipmentDate[dateKey].push(item);
  });
  return map;
}

function monthlyPpeGroupRecords_(records) {
  const grouped = {};
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(e => grouped[e.id] = []);
  records.forEach(r => {
    if (!grouped[r.equipmentId]) grouped[r.equipmentId] = [];
    grouped[r.equipmentId].push(r);
  });
  return grouped;
}

function monthlyPpeEquipmentSummaries_(grouped) {
  return MONTHLY_PPE_SUMMARY_EQUIPMENTS.map(e => {
    const rows = grouped[e.id] || [];
    return {
      equipmentId: e.id,
      label: e.label,
      recordCount: rows.length,
      checkedDateCount: monthlyPpeUniqueDates_(rows).length,
      abnormalRecordCount: rows.filter(r => r.abnormalCount > 0 || r.status === '異常待追蹤').length,
      confirmedNormalCount: rows.filter(r => r.status === '未接獲異常').length,
    };
  });
}

function monthlyPpeApplyConfirmationRows_(records, rows) {
  const byKey = {};
  (rows || []).forEach(row => {
    const key = String(row && row.key || '').trim();
    if (!key) return;
    byKey[key] = {
      status: monthlyPpeNormalizeStatus_(row.status),
      note: sanitizeText_(row.note || '', 300).trim(),
    };
  });
  records.forEach(record => {
    const update = byKey[record.key];
    if (!update) return;
    record.status = update.status;
    record.note = update.note;
  });
}

function monthlyPpeCreateSummaryPdf_(month, grouped, records, confirmation) {
  const fileName = `${month.rocYm}_月度防護具檢點彙整確認表.pdf`;
  const folder = monthlyPpeGetSummaryFolder_(month);
  monthlyPpeTrashExistingFiles_(folder, fileName);

  const doc = DocumentApp.create(`tmp_${fileName.replace(/\.pdf$/i, '')}_${Date.now()}`);
  const docId = doc.getId();
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

  monthlyPpeAppendHeader_(body, month, records, confirmation);
  monthlyPpeAppendSummaryTable_(body, grouped);
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(e => {
    monthlyPpeAppendDetailTable_(body, e, grouped[e.id] || []);
  });
  monthlyPpeAppendConfirmArea_(body, confirmation);

  doc.saveAndClose();
  const blob = DriveApp.getFileById(docId).getAs(MimeType.PDF).setName(fileName);
  const file = folder.createFile(blob);
  DriveApp.getFileById(docId).setTrashed(true);

  return {
    fileName,
    fileId: file.getId(),
    fileUrl: file.getUrl(),
    folderUrl: folder.getUrl(),
  };
}

function monthlyPpeAppendHeader_(body, month, records, confirmation) {
  body.appendParagraph('社團法人中華民國工業安全衛生協會附設台中職業訓練中心')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setBold(true);
  body.appendParagraph(MONTHLY_PPE_SUMMARY_FOLDER_NAME)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  const generatedAt = Utilities.formatDate(new Date(), tz_(), 'yyyy/MM/dd HH:mm');
  const confirmedAt = confirmation && confirmation.confirmedAt
    ? monthlyPpeDisplayDateTime_(confirmation.confirmedAt)
    : '尚未簽名確認';
  body.appendParagraph(`彙整月份：${month.label}　產生時間：${generatedAt}　確認時間：${confirmedAt}`)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`本表依當月場地使用紀錄自動彙整需確認的場地防護具配置狀態，供承辦人月度檢視、補充狀態與簽名留痕。彙整筆數：${records.length} 筆。`)
    .setSpacingAfter(8);
  if (confirmation && confirmation.summaryNote) {
    body.appendParagraph(`承辦總備註：${confirmation.summaryNote}`).setSpacingAfter(8);
  }
}

function monthlyPpeAppendSummaryTable_(body, grouped) {
  body.appendParagraph('一、月度彙整').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [['項目', '使用日期數', '待確認筆數', '未接獲異常', '異常/追蹤', '不適用']];
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(e => {
    const records = grouped[e.id] || [];
    rows.push([
      e.label,
      String(monthlyPpeUniqueDates_(records).length),
      String(records.length),
      String(records.filter(r => r.status === '未接獲異常').length),
      String(records.filter(r => r.status === '異常已改善' || r.status === '異常待追蹤').length),
      String(records.filter(r => r.status === '不適用').length),
    ]);
  });
  const table = body.appendTable(rows);
  monthlyPpeStyleTable_(table, '#1a73e8');
  body.appendParagraph('');
}

function monthlyPpeAppendDetailTable_(body, equipment, records) {
  body.appendParagraph(`二、${equipment.label} 明細`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [['日期', '場地/來源內容', '配置狀態', '異常摘要', '承辦備註']];
  if (!records.length) {
    rows.push(['-', '-', '本月查無場地使用紀錄', '-', '-']);
  } else {
    records.forEach(r => {
      rows.push([
        r.checkDate,
        monthlyPpeShortText_(r.usageContent || r.location || '-', 80),
        r.status || '未接獲異常',
        r.abnormalSummary || '-',
        r.note || '-',
      ]);
    });
  }
  const table = body.appendTable(rows);
  monthlyPpeStyleTable_(table, '#5f6368');
  body.appendParagraph('');
}

function monthlyPpeAppendConfirmArea_(body, confirmation) {
  body.appendParagraph('三、承辦人月度確認').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('確認說明：承辦人已依本月場地使用紀錄檢視防護具配置狀態，並就異常或不適用日期於明細中標註。');
  if (confirmation && confirmation.signatureDataUrl) {
    const table = body.appendTable([
      ['承辦人', confirmation.handlerName || '-'],
      ['確認時間', monthlyPpeDisplayDateTime_(confirmation.confirmedAt) || '-'],
      ['承辦人簽名', ''],
    ]);
    monthlyPpeStyleTable_(table, '#188038');
    const sigCell = table.getRow(2).getCell(1);
    const sigBlob = dataUrlToBlob_(confirmation.signatureDataUrl, 'monthly-ppe-handler-signature.png');
    if (sigBlob) {
      const image = sigCell.appendImage(sigBlob);
      const width = image.getWidth();
      if (width > 220) image.setWidth(220);
    } else {
      sigCell.appendParagraph('簽名圖無法載入');
    }
    return;
  }

  const table = body.appendTable([
    ['承辦人簽名確認'],
    ['\n\n簽名：____________________________　確認日期：________年____月____日\n\n'],
  ]);
  monthlyPpeStyleTable_(table, '#188038');
}

function monthlyPpeStyleTable_(table, headerColor) {
  table.setBorderWidth(1);
  for (let r = 0; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      const cell = row.getCell(c);
      cell.setPaddingTop(4).setPaddingBottom(4).setPaddingLeft(5).setPaddingRight(5);
      const text = cell.editAsText();
      text.setFontSize(r === 0 ? 9 : 8);
      if (r === 0) {
        cell.setBackgroundColor(headerColor);
        text.setBold(true).setForegroundColor('#ffffff');
      } else {
        cell.setBackgroundColor('#ffffff');
        text.setForegroundColor('#202124');
      }
    }
  }
}

function monthlyPpeGetSummaryFolder_(month) {
  const root = getArchiveRootFolder_();
  const base = getOrCreateSubFolder_(root, MONTHLY_PPE_SUMMARY_FOLDER_NAME);
  const yearFolder = getOrCreateSubFolder_(base, `${month.year - 1911}年`);
  return getOrCreateSubFolder_(yearFolder, `${String(month.month).padStart(2, '0')}月`);
}

function monthlyPpeTrashExistingFiles_(folder, fileName) {
  const files = folder.getFilesByName(fileName);
  while (files.hasNext()) {
    files.next().setTrashed(true);
  }
}

function monthlyPpeBuildConfirmUrl_(month) {
  const base = getWebAppBaseUrl_();
  if (!base) return '';
  const params = [
    'page=monthly-ppe-confirm',
    `year=${encodeURIComponent(month.year)}`,
    `month=${encodeURIComponent(month.month)}`,
    `token=${encodeURIComponent(monthlyPpeConfirmationToken_(month))}`,
  ];
  return `${base}?${params.join('&')}`;
}

function monthlyPpeConfirmationToken_(month) {
  const secret = String(CONFIG.ADMIN_TOKEN_SHA256 || getAdminToken_() || '').trim();
  if (!secret || secret.length < 32 || secret === CONFIG.API_TOKEN) throw new Error('月度防護具確認 token 尚未設定');
  const raw = `${month.year}-${String(month.month).padStart(2, '0')}|monthly-ppe-confirm|${secret}`;
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

function monthlyPpeValidateConfirmationToken_(month, token) {
  const expected = monthlyPpeConfirmationToken_(month);
  if (!token || token !== expected) throw new Error('月度防護具確認連結無效');
}

function monthlyPpeNormalizeConfirmation_(raw) {
  raw = raw || {};
  const confirmedAt = raw.confirmedAt instanceof Date ? raw.confirmedAt : (raw.confirmedAt ? new Date(raw.confirmedAt) : null);
  return {
    handlerName: sanitizeText_(raw.handlerName || '', 60).trim(),
    summaryNote: sanitizeText_(raw.summaryNote || '', 500).trim(),
    signatureDataUrl: raw.signatureDataUrl || raw.signature || '',
    confirmedAt: confirmedAt && !isNaN(confirmedAt.getTime()) ? confirmedAt : null,
  };
}

function monthlyPpeNormalizeStatus_(status) {
  const s = String(status || '').trim();
  if (MONTHLY_PPE_CONFIRMATION_STATUSES.indexOf(s) >= 0) return s;
  return MONTHLY_PPE_CONFIRMATION_STATUSES[0];
}

function monthlyPpeMonthPayload_(month) {
  return {
    year: month.year,
    month: month.month,
    label: month.label,
    startIso: month.startIso,
    nextIso: month.nextIso,
    rocYm: month.rocYm,
  };
}

function monthlyPpeRecordPayload_(record) {
  return {
    key: record.key,
    checkDate: record.checkDate,
    equipmentId: record.equipmentId,
    equipmentLabel: record.equipmentLabel,
    equipmentName: record.equipmentName,
    location: record.location,
    usageContent: record.usageContent,
    status: record.status,
    note: record.note,
    abnormalCount: record.abnormalCount,
    abnormalSummary: record.abnormalSummary,
    incidentStatusSummary: record.incidentStatusSummary,
  };
}

function monthlyPpeUniqueDates_(records) {
  const seen = {};
  records.forEach(r => {
    if (r.checkDate) seen[r.checkDate] = true;
  });
  return Object.keys(seen).sort();
}

function monthlyPpeEquipmentLabel_(equipmentId) {
  const found = MONTHLY_PPE_SUMMARY_EQUIPMENTS.find(e => e.id === equipmentId);
  return found ? found.label : equipmentId;
}

function monthlyPpeShortText_(value, maxLen) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  const limit = maxLen || 80;
  return text.length > limit ? `${text.substring(0, limit - 1)}…` : text;
}

function monthlyPpeBadItemsFromPayload_(payload) {
  if (!payload || !Array.isArray(payload.items)) return [];
  const formType = payload.formType || 'daily';
  return payload.items
    .filter(it => isBadResult_(formType, it.result, null))
    .map(it => ({
      order: it.order,
      itemName: itemNameWithSection_(it),
      description: abnormalDescriptionWithCheckResults_(it),
      status: '',
    }));
}

function monthlyPpeAbnormalSummary_(badItems, linkedIncidents) {
  const items = (linkedIncidents && linkedIncidents.length) ? linkedIncidents : badItems;
  if (!items || !items.length) return '';
  return items.slice(0, 3).map(it => {
    const order = it.order ? `第${it.order}項` : '';
    const name = it.itemName || '';
    const desc = it.description ? `：${it.description}` : '';
    return `${order}${name ? ' ' + name : ''}${desc}`.trim();
  }).join('；') + (items.length > 3 ? `；另 ${items.length - 3} 項` : '');
}

function monthlyPpeIncidentStatusSummary_(linkedIncidents) {
  if (!linkedIncidents || !linkedIncidents.length) return '';
  const counts = {};
  linkedIncidents.forEach(it => {
    const s = it.status || '待處理';
    counts[s] = (counts[s] || 0) + 1;
  });
  return Object.keys(counts).sort().map(k => `${k}${counts[k]}項`).join('、');
}

function monthlyPpeParsePayload_(json) {
  if (!json) return null;
  const clean = String(json || '').replace(/\.\.\.\[truncated\]$/g, '');
  try {
    return JSON.parse(clean);
  } catch (e) {
    return null;
  }
}

function monthlyPpeParseDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;
  const s = String(value || '').trim();
  let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = s.match(/^(\d{2,3})[-\/](\d{1,2})[-\/](\d{1,2})/);
  if (m) return new Date(Number(m[1]) + 1911, Number(m[2]) - 1, Number(m[3]));
  return null;
}

function monthlyPpeDisplayDateTime_(value) {
  if (!value) return '';
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, tz_(), 'yyyy/MM/dd HH:mm');
  }
  return formatDisplayDateTime_(value);
}

function monthlyPpeCell_(rowOrValue, index) {
  if (Array.isArray(rowOrValue)) {
    if (index < 0) return '';
    const value = rowOrValue[index];
    return value == null ? '' : String(value).trim();
  }
  return rowOrValue == null ? '' : String(rowOrValue).trim();
}
