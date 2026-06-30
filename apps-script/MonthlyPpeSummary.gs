/**
 * ===== 月度防護具檢點彙整確認表 =====
 *
 * 用途：將「每日場地防護具檢點」當月紀錄彙整成一份承辦人簽名確認 PDF。
 * 這份表只彙整既有填報紀錄；月度確認由承辦人在 PDF 確認區簽名留痕。
 */

const MONTHLY_PPE_SUMMARY_FOLDER_NAME = '月度防護具檢點彙整確認表';
const MONTHLY_PPE_SUMMARY_EQUIPMENTS = [
  { id: 'VENUE-CRANE', label: '起重機防護具' },
  { id: 'VENUE-FORK', label: '堆高機防護具' },
];

function generateMonthlyPpeSummary(options) {
  return generateMonthlyPpeSummary_(options || {});
}

function generateMonthlyPpeSummary_(options) {
  const month = monthlyPpeResolveMonth_(options || {});
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const incidentMap = monthlyPpeCollectMachineIncidents_(ss, month);
  const records = monthlyPpeCollectRecords_(ss, month, incidentMap);
  const grouped = monthlyPpeGroupRecords_(records);
  const pdf = monthlyPpeCreateSummaryPdf_(month, grouped, records);

  return {
    month: month.label,
    fileName: pdf.fileName,
    fileId: pdf.fileId,
    fileUrl: pdf.fileUrl,
    folderUrl: pdf.folderUrl,
    recordCount: records.length,
    equipments: MONTHLY_PPE_SUMMARY_EQUIPMENTS.map(e => {
      const rows = grouped[e.id] || [];
      return {
        equipmentId: e.id,
        label: e.label,
        recordCount: rows.length,
        checkedDateCount: monthlyPpeUniqueDates_(rows).length,
        abnormalRecordCount: rows.filter(r => r.abnormalCount > 0).length,
      };
    }),
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
  if (dryRun) {
    return {
      action: 'wouldRemind',
      category: '月度防護具檢點彙整確認',
      formType: '每月',
      month: targetMonth.label,
      reason: '每月第一個工作日提醒承辦簽名確認',
    };
  }

  const summary = generateMonthlyPpeSummary_({
    year: targetMonth.year,
    month: targetMonth.month,
  });
  const result = sendMonthlyPpeSummaryReminder_(summary);
  return Object.assign({
    action: result && result.ok ? 'reminded' : 'reminderFailed',
    category: '月度防護具檢點彙整確認',
    formType: '每月',
    month: targetMonth.label,
    recordCount: summary.recordCount,
    fileUrl: summary.fileUrl,
  }, result || {});
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
    altText: `🦺 ${summary.month || ''} 防護具彙整確認表`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#5F6368',
        paddingAll: 'md',
        contents: [
          { type: 'text', text: '🦺 月度防護具確認', color: '#ffffff', weight: 'bold', size: 'lg' },
          { type: 'text', text: summary.month || '', color: '#F1F3F4', size: 'sm' },
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          { type: 'text', text: '請承辦人開啟 PDF，於「承辦人簽名確認」欄簽名留痕。', size: 'sm', color: '#202124', wrap: true },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'baseline',
            spacing: 'sm',
            contents: [
              { type: 'text', text: '彙整紀錄', flex: 5, size: 'sm', color: '#666666' },
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
              label: '開啟確認 PDF',
              uri: summary.fileUrl || 'https://drive.google.com/',
            },
          },
        ],
      },
    },
  };
}

function linePushToMonthlyPpeSummaryStaff_(messages) {
  const cfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
  if (!cfg || !cfg.token) return { ok: false, reason: 'no_token', targetMode: 'monthly-ppe-summary-staff', targetCount: 0 };
  if (!Array.isArray(messages)) messages = [messages];
  const ids = monthlyPpeSummaryStaffRecipientIds_();
  if (ids.length > 1) {
    const res = lineMulticast_(ids, messages);
    return Object.assign({ targetMode: 'monthly-ppe-summary-staff', targetCount: ids.length }, res);
  }
  if (ids.length === 1) {
    const res = linePushTo_(ids[0], messages, 'push');
    return Object.assign({ targetMode: 'monthly-ppe-summary-staff', targetCount: 1 }, res);
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
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(h => String(h || '').trim());
  const idx = (...names) => findCol_(headers, ...names);
  const col = {
    recordId: idx('紀錄ID'),
    submittedAt: idx('送出時間'),
    checkDate: idx('檢查日期'),
    formType: idx('表單類型'),
    equipmentId: idx('設備代號'),
    equipmentName: idx('設備名稱'),
    category: idx('設備類別'),
    inspector: idx('檢點人員', '檢查人'),
    incidentCount: idx('異常事件數'),
    payloadJson: idx('完整資料JSON'),
    pdfUrl: idx('PDF連結'),
    note: idx('備註'),
  };
  if (col.recordId < 0 || col.checkDate < 0 || col.equipmentId < 0) {
    throw new Error('填報紀錄缺少必要欄位：紀錄ID / 檢查日期 / 設備代號');
  }

  const targetIds = MONTHLY_PPE_SUMMARY_EQUIPMENTS.map(e => e.id);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const out = [];

  values.forEach(row => {
    const equipmentId = monthlyPpeCell_(row, col.equipmentId).toUpperCase();
    if (targetIds.indexOf(equipmentId) < 0) return;

    const date = monthlyPpeParseDate_(row[col.checkDate]);
    if (!date) return;
    const iso = formatISODate_(date);
    if (iso < month.startIso || iso >= month.nextIso) return;

    const formTypeLabel = monthlyPpeCell_(row, col.formType);
    if (formTypeLabel && formTypeLabel !== '每日') return;

    const payload = monthlyPpeParsePayload_(monthlyPpeCell_(row, col.payloadJson));
    const recordId = monthlyPpeCell_(row, col.recordId);
    const linkedIncidents = incidentMap[recordId] || [];
    const badItems = monthlyPpeBadItemsFromPayload_(payload);
    const sheetIncidentCount = Number(row[col.incidentCount] || 0);
    const abnormalCount = Math.max(sheetIncidentCount || 0, badItems.length, linkedIncidents.length);

    out.push({
      recordId,
      checkDate: iso,
      submittedAt: monthlyPpeDisplayDateTime_(row[col.submittedAt]),
      equipmentId,
      equipmentLabel: monthlyPpeEquipmentLabel_(equipmentId),
      equipmentName: monthlyPpeCell_(row, col.equipmentName),
      category: monthlyPpeCell_(row, col.category),
      inspector: monthlyPpeCell_(row, col.inspector) || monthlyPpeCell_(payload.inspector),
      abnormalCount,
      abnormalSummary: monthlyPpeAbnormalSummary_(badItems, linkedIncidents),
      incidentStatusSummary: monthlyPpeIncidentStatusSummary_(linkedIncidents),
      pdfUrl: monthlyPpeCell_(row, col.pdfUrl),
      note: monthlyPpeCell_(row, col.note),
    });
  });

  out.sort((a, b) => {
    if (a.checkDate !== b.checkDate) return a.checkDate < b.checkDate ? -1 : 1;
    return a.equipmentId < b.equipmentId ? -1 : 1;
  });
  return out;
}

function monthlyPpeCollectMachineIncidents_(ss, month) {
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return {};

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
  if (col.recordId < 0 || col.date < 0 || col.equipmentId < 0) return {};

  const targetIds = MONTHLY_PPE_SUMMARY_EQUIPMENTS.map(e => e.id);
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const map = {};

  values.forEach(row => {
    const equipmentId = monthlyPpeCell_(row, col.equipmentId).toUpperCase();
    if (targetIds.indexOf(equipmentId) < 0) return;
    const date = monthlyPpeParseDate_(row[col.date]);
    if (!date) return;
    const iso = formatISODate_(date);
    if (iso < month.startIso || iso >= month.nextIso) return;
    const recordId = monthlyPpeCell_(row, col.recordId);
    if (!recordId) return;
    if (!map[recordId]) map[recordId] = [];
    map[recordId].push({
      order: monthlyPpeCell_(row, col.order),
      itemName: monthlyPpeCell_(row, col.itemName),
      description: monthlyPpeCell_(row, col.description),
      status: monthlyPpeCell_(row, col.status) || '待處理',
    });
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

function monthlyPpeCreateSummaryPdf_(month, grouped, records) {
  const fileName = `${month.rocYm}_月度防護具檢點彙整確認表.pdf`;
  const folder = monthlyPpeGetSummaryFolder_(month);
  monthlyPpeTrashExistingFiles_(folder, fileName);

  const doc = DocumentApp.create(`tmp_${fileName.replace(/\.pdf$/i, '')}_${Date.now()}`);
  const docId = doc.getId();
  const body = doc.getBody();
  body.clear();
  body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

  monthlyPpeAppendHeader_(body, month, records);
  monthlyPpeAppendSummaryTable_(body, grouped);
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(e => {
    monthlyPpeAppendDetailTable_(body, e, grouped[e.id] || []);
  });
  monthlyPpeAppendConfirmArea_(body);

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

function monthlyPpeAppendHeader_(body, month, records) {
  body.appendParagraph('社團法人中華民國工業安全衛生協會附設台中職業訓練中心')
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .setBold(true);
  body.appendParagraph(MONTHLY_PPE_SUMMARY_FOLDER_NAME)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`彙整月份：${month.label}　產生時間：${Utilities.formatDate(new Date(), tz_(), 'yyyy/MM/dd HH:mm')}`)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);
  body.appendParagraph(`本表依當月場地防護具檢點紀錄彙整，供承辦人月度簽名確認留痕。紀錄總數：${records.length} 筆。`)
    .setSpacingAfter(12);
}

function monthlyPpeAppendSummaryTable_(body, grouped) {
  body.appendParagraph('一、月度彙整').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [['項目', '檢點日期數', '紀錄筆數', '正常紀錄', '異常紀錄', '最後檢點日']];
  MONTHLY_PPE_SUMMARY_EQUIPMENTS.forEach(e => {
    const records = grouped[e.id] || [];
    const abnormal = records.filter(r => r.abnormalCount > 0).length;
    rows.push([
      e.label,
      String(monthlyPpeUniqueDates_(records).length),
      String(records.length),
      String(records.length - abnormal),
      String(abnormal),
      records.length ? records[records.length - 1].checkDate : '無',
    ]);
  });
  const table = body.appendTable(rows);
  monthlyPpeStyleTable_(table, '#1a73e8');
  body.appendParagraph('');
}

function monthlyPpeAppendDetailTable_(body, equipment, records) {
  body.appendParagraph(`二、${equipment.label} 明細`).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const rows = [['檢點日期', '檢點人員', '結果', '異常摘要', '原始PDF']];
  if (!records.length) {
    rows.push(['-', '-', '本月查無紀錄', '-', '-']);
  } else {
    records.forEach(r => {
      rows.push([
        r.checkDate,
        r.inspector || '-',
        r.abnormalCount > 0 ? `異常 ${r.abnormalCount} 項（${r.incidentStatusSummary || '待確認'}）` : '正常',
        r.abnormalSummary || '-',
        r.pdfUrl ? '已歸檔' : '無',
      ]);
    });
  }
  const table = body.appendTable(rows);
  monthlyPpeStyleTable_(table, '#5f6368');
  body.appendParagraph('');
}

function monthlyPpeAppendConfirmArea_(body) {
  body.appendParagraph('三、月度確認').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('確認說明：本月防護具檢點紀錄已完成彙整，請承辦人於下方簽名確認。');
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
  return String(value || '').trim();
}

function monthlyPpeCell_(rowOrValue, index) {
  if (Array.isArray(rowOrValue)) {
    if (index < 0) return '';
    const value = rowOrValue[index];
    return value == null ? '' : String(value).trim();
  }
  return rowOrValue == null ? '' : String(rowOrValue).trim();
}
