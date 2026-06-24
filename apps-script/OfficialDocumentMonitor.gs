/**
 * ===== 公文系統待發文雲端檢核 =====
 *
 * Cloud Run Job 負責登入 Vital OD 抓「待發文」清單，並只把最小必要資料
 * 寫回這裡的佇列。LINE 推播一律由 Apps Script 依「訂閱者清單」執行，
 * 避免 Cloud Run 直接持有 LINE Channel Access Token。
 */

const OFFICIAL_DOC_QUEUE_SHEET_NAME = '公文待發文佇列';
const OFFICIAL_DOC_RUN_LOG_SHEET_NAME = '公文待發文執行紀錄';
const OFFICIAL_DOC_QUEUE_PENDING = '待通知';
const OFFICIAL_DOC_QUEUE_NOTIFIED = '已通知';
const OFFICIAL_DOC_QUEUE_NO_LINE = '查無LINE';
const OFFICIAL_DOC_QUEUE_FAILED = '通知失敗';
const OFFICIAL_DOC_QUEUE_SKIPPED = '略過';

function officialDocumentQueueHeaders_() {
  return [
    '檢核日期', '檢核時段', '文件Key', '批次ID',
    '公文文號', '發文字號', '承辦人員', '承辦人姓名', '承辦單位', '限辦日期',
    '通知狀態', '通知時間', '通知結果',
    '建立時間', '更新時間', '備註',
  ];
}

function officialDocumentRunLogHeaders_() {
  return [
    '批次ID', '檢核日期', '檢核時段', '開始時間', '結束時間',
    '狀態', '抓取筆數', '寫入筆數', 'dryRun', '錯誤摘要', '建立時間',
  ];
}

function setupOfficialDocumentMonitorSheets_(ss) {
  setupSheet_(ss, OFFICIAL_DOC_QUEUE_SHEET_NAME, officialDocumentQueueHeaders_(), []);
  setupSheet_(ss, OFFICIAL_DOC_RUN_LOG_SHEET_NAME, officialDocumentRunLogHeaders_(), []);
}

function getOfficialDocumentQueueSheet_(ss) {
  return ss.getSheetByName(OFFICIAL_DOC_QUEUE_SHEET_NAME);
}

function getOfficialDocumentRunLogSheet_(ss) {
  return ss.getSheetByName(OFFICIAL_DOC_RUN_LOG_SHEET_NAME);
}

/**
 * Cloud Run 呼叫入口。
 *
 * payload:
 *   {
 *     batchId, date, slot, startedAt, finishedAt, status, dryRun,
 *     records:[{documentKey, documentNo, outboundNo, handler, handlerName, unit, dueDate}],
 *     notify: true|false
 *   }
 */
function enqueueOfficialDocumentDispatches_(payload) {
  let response;
  let shouldNotify = false;
  let notifyDate = '';
  let notifySlot = '';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('系統忙碌，請稍後再試');
  try {
    payload = payload || {};
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    setupOfficialDocumentMonitorSheets_(ss);

    const dateStr = sanitizeOfficialDocumentDate_(payload.date);
    const slot = sanitizeOfficialDocumentSlot_(payload.slot);
    const dryRun = payload.dryRun === true || String(payload.dryRun || '').toLowerCase() === 'true';
    const records = Array.isArray(payload.records) ? payload.records : [];
    const batchId = sanitizeText_(payload.batchId || Utilities.getUuid(), 80);
    const now = officialDocumentNow_();

    let written = 0;
    if (!dryRun) {
      written = upsertOfficialDocumentQueueRows_(ss, {
        batchId,
        dateStr,
        slot,
        records,
        now,
      });
    }

    appendOfficialDocumentRunLog_(ss, {
      batchId,
      dateStr,
      slot,
      startedAt: sanitizeText_(payload.startedAt, 80),
      finishedAt: sanitizeText_(payload.finishedAt, 80),
      status: sanitizeText_(payload.status || 'ok', 80),
      fetchedCount: records.length,
      writtenCount: written,
      dryRun,
      errorSummary: sanitizeText_(payload.errorSummary, 500),
      createdAt: now,
    });

    SpreadsheetApp.flush();
    shouldNotify = !dryRun && payload.notify === true;
    notifyDate = dateStr;
    notifySlot = slot;
    response = {
      ok: true,
      sheetName: OFFICIAL_DOC_QUEUE_SHEET_NAME,
      runLogSheetName: OFFICIAL_DOC_RUN_LOG_SHEET_NAME,
      batchId,
      date: dateStr,
      slot,
      dryRun,
      fetchedCount: records.length,
      writtenCount: written,
      notifyResult: null,
    };
  } finally {
    lock.releaseLock();
  }
  if (shouldNotify) {
    response.notifyResult = processOfficialDocumentQueue_({ date: notifyDate, slot: notifySlot });
  }
  return response;
}

function upsertOfficialDocumentQueueRows_(ss, opts) {
  const sheet = getOfficialDocumentQueueSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const idx = (name) => headers.indexOf(name);
  const required = ['檢核日期', '檢核時段', '文件Key', '通知狀態'];
  required.forEach(name => {
    if (idx(name) < 0) throw new Error('公文待發文佇列缺少欄位：' + name);
  });

  const lastRow = sheet.getLastRow();
  const values = lastRow >= 2 ? sheet.getRange(2, 1, lastRow - 1, headers.length).getValues() : [];
  const existing = {};
  values.forEach((row, i) => {
    const key = officialDocumentQueueKey_(row[idx('檢核日期')], row[idx('檢核時段')], row[idx('文件Key')]);
    if (key) existing[key] = { rowNo: i + 2, row };
  });

  const appendRows = [];
  let updated = 0;
  opts.records.forEach(raw => {
    const record = normalizeOfficialDocumentRecord_(raw);
    if (!record.documentKey || !record.handlerName) return;
    const key = officialDocumentQueueKey_(opts.dateStr, opts.slot, record.documentKey);
    const found = existing[key];
    const row = found ? found.row.slice() : new Array(headers.length).fill('');

    setOfficialDocumentCell_(row, headers, '檢核日期', opts.dateStr);
    setOfficialDocumentCell_(row, headers, '檢核時段', opts.slot);
    setOfficialDocumentCell_(row, headers, '文件Key', record.documentKey);
    setOfficialDocumentCell_(row, headers, '批次ID', opts.batchId);
    setOfficialDocumentCell_(row, headers, '公文文號', record.documentNo);
    setOfficialDocumentCell_(row, headers, '發文字號', record.outboundNo);
    setOfficialDocumentCell_(row, headers, '承辦人員', record.handler);
    setOfficialDocumentCell_(row, headers, '承辦人姓名', record.handlerName);
    setOfficialDocumentCell_(row, headers, '承辦單位', record.unit);
    setOfficialDocumentCell_(row, headers, '限辦日期', record.dueDate);
    setOfficialDocumentCell_(row, headers, '更新時間', opts.now);
    if (!found) {
      setOfficialDocumentCell_(row, headers, '通知狀態', OFFICIAL_DOC_QUEUE_PENDING);
      setOfficialDocumentCell_(row, headers, '建立時間', opts.now);
      appendRows.push(row);
      return;
    }

    const status = String(row[idx('通知狀態')] || '').trim();
    if (!status || status === OFFICIAL_DOC_QUEUE_FAILED) {
      setOfficialDocumentCell_(row, headers, '通知狀態', OFFICIAL_DOC_QUEUE_PENDING);
    }
    sheet.getRange(found.rowNo, 1, 1, headers.length).setValues([row]);
    updated++;
  });

  if (appendRows.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, appendRows.length, headers.length).setValues(appendRows);
  }
  return appendRows.length + updated;
}

function appendOfficialDocumentRunLog_(ss, log) {
  const sheet = getOfficialDocumentRunLogSheet_(ss);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const row = new Array(headers.length).fill('');
  setOfficialDocumentCell_(row, headers, '批次ID', log.batchId);
  setOfficialDocumentCell_(row, headers, '檢核日期', log.dateStr);
  setOfficialDocumentCell_(row, headers, '檢核時段', log.slot);
  setOfficialDocumentCell_(row, headers, '開始時間', log.startedAt);
  setOfficialDocumentCell_(row, headers, '結束時間', log.finishedAt);
  setOfficialDocumentCell_(row, headers, '狀態', log.status);
  setOfficialDocumentCell_(row, headers, '抓取筆數', log.fetchedCount);
  setOfficialDocumentCell_(row, headers, '寫入筆數', log.writtenCount);
  setOfficialDocumentCell_(row, headers, 'dryRun', log.dryRun ? '是' : '否');
  setOfficialDocumentCell_(row, headers, '錯誤摘要', log.errorSummary);
  setOfficialDocumentCell_(row, headers, '建立時間', log.createdAt);
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function processOfficialDocumentQueue_(payload) {
  payload = payload || {};
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) throw new Error('系統忙碌，請稍後再試');
  try {
    const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
    setupOfficialDocumentMonitorSheets_(ss);
    const dateStr = sanitizeOfficialDocumentDate_(payload.date);
    const slot = sanitizeOfficialDocumentSlot_(payload.slot);
    const sheet = getOfficialDocumentQueueSheet_(ss);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
    const idx = (name) => headers.indexOf(name);
    const lastRow = sheet.getLastRow();
    if (lastRow < 2) return { ok: true, date: dateStr, slot, pendingCount: 0, notifiedPeople: 0 };

    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    const groups = {};
    data.forEach((row, i) => {
      const status = String(row[idx('通知狀態')] || '').trim();
      if (status !== OFFICIAL_DOC_QUEUE_PENDING) return;
      if (String(row[idx('檢核日期')] || '').trim() !== dateStr) return;
      if (String(row[idx('檢核時段')] || '').trim() !== slot) return;
      const handlerName = String(row[idx('承辦人姓名')] || '').trim();
      if (!handlerName) return;
      if (!groups[handlerName]) groups[handlerName] = { handlerName, unit: '', rows: [] };
      groups[handlerName].rows.push({ rowNo: i + 2, row });
      const unit = String(row[idx('承辦單位')] || '').trim();
      if (unit && !groups[handlerName].unit) groups[handlerName].unit = unit;
    });

    let pendingCount = 0;
    let notifiedPeople = 0;
    let noLinePeople = 0;
    let failedPeople = 0;
    Object.keys(groups).forEach(name => {
      const group = groups[name];
      pendingCount += group.rows.length;
      const target = findOfficialDocumentStaffLineTarget_(group.handlerName, group.unit);
      if (target && target.ambiguous) {
        markOfficialDocumentQueueRows_(sheet, headers, group.rows, OFFICIAL_DOC_QUEUE_SKIPPED, '訂閱者清單同名同仁比對不唯一，未推播');
        noLinePeople++;
        return;
      }
      if (!target || !target.userId) {
        markOfficialDocumentQueueRows_(sheet, headers, group.rows, OFFICIAL_DOC_QUEUE_NO_LINE, '訂閱者清單找不到同仁 LINE_USER_ID');
        noLinePeople++;
        return;
      }

      const flex = buildOfficialDocumentDispatchReminderFlex_({
        date: dateStr,
        slot,
        handlerName: group.handlerName,
        unit: group.unit || target.unit || '',
        records: group.rows.map(item => rowToOfficialDocumentRecord_(item.row, headers)),
      });
      const result = linePushTo_(target.userId, withQuickReply_(flex));
      if (result && result.ok) {
        markOfficialDocumentQueueRows_(sheet, headers, group.rows, OFFICIAL_DOC_QUEUE_NOTIFIED, '已推播給 ' + group.handlerName);
        notifiedPeople++;
      } else {
        markOfficialDocumentQueueRows_(sheet, headers, group.rows, OFFICIAL_DOC_QUEUE_FAILED, 'LINE 推播失敗');
        failedPeople++;
      }
    });

    // 公文登記桌:除通知各承辦人外,另把「全部待發文彙總」推給被指定為登記桌的同仁(oversight)
    // 安全:整個函式由 Cloud Run 於 16:30/17:00 觸發;目前 NOTIFY/DRY_RUN/Scheduler 仍 gated,不會對外發
    let deskNotified = 0;
    if (pendingCount > 0) {
      const allRecords = [];
      Object.keys(groups).forEach(gname => {
        groups[gname].rows.forEach(item => allRecords.push(rowToOfficialDocumentRecord_(item.row, headers)));
      });
      const deskTargets = getOfficialDocumentRegistryDeskTargets_();
      if (deskTargets.length > 0 && allRecords.length > 0) {
        const deskFlex = buildOfficialDocumentListFlex_({
          title: '📨 公文待發文彙總（登記桌）',
          altPrefix: '📨 公文待發文彙總',
          color: '#1A73E8',
          date: dateStr,
          slot: slot,
          records: allRecords,
          message: '本時段共 ' + allRecords.length + ' 件待發文,請協助追蹤。',
        });
        deskTargets.forEach(t => {
          const r = linePushTo_(t.userId, withQuickReply_(deskFlex));
          if (r && r.ok) deskNotified++;
        });
      }
    }

    SpreadsheetApp.flush();
    return { ok: true, date: dateStr, slot, pendingCount, notifiedPeople, noLinePeople, failedPeople, deskNotified };
  } finally {
    lock.releaseLock();
  }
}

function getOfficialDocumentRegistryDeskTargets_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = (typeof getLineSubscriberSheet_ === 'function') ? getLineSubscriberSheet_(ss) : null;
  if (!sheet || sheet.getLastRow() < 2) return [];
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const idCol = headers.indexOf('LINE_USER_ID');
  const deskCol = headers.indexOf('公文登記桌');
  if (idCol < 0 || deskCol < 0) return [];  // 欄位不存在 → 視為無登記桌(安全,不推播)
  const seen = {};
  const targets = [];
  data.slice(1).forEach(row => {
    const userId = String(row[idCol] || '').trim();
    if (!userId || !isActiveValue_(row[deskCol])) return;
    if (seen[userId]) return;
    seen[userId] = true;
    targets.push({ name: nameCol >= 0 ? String(row[nameCol] || '').trim() : '', userId: userId });
  });
  return targets;
}

function findOfficialDocumentStaffLineTarget_(handlerName, unit) {
  const targetName = String(handlerName || '').trim();
  if (!targetName) return null;
  const targetUnit = String(unit || '').trim();
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getLineSubscriberSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return null;
  const data = sheet.getDataRange().getValues();
  const headers = data[0].map(h => String(h || '').trim());
  const nameCol = headers.indexOf('姓名');
  const idCol = headers.indexOf('LINE_USER_ID');
  const staffCol = headers.indexOf('是否為同仁');
  const noteCol = headers.indexOf('備註');
  if (nameCol < 0 || idCol < 0 || staffCol < 0) return null;

  const matches = [];
  data.slice(1).forEach(row => {
    const name = String(row[nameCol] || '').trim();
    const userId = String(row[idCol] || '').trim();
    const isStaff = isActiveValue_(row[staffCol]);
    if (!name || !userId || !isStaff) return;
    if (name === targetName) {
      matches.push({ name, userId, unit: noteCol >= 0 ? String(row[noteCol] || '').trim() : '' });
    }
  });

  if (matches.length <= 1) return matches[0] || null;
  if (targetUnit) {
    const unitMatches = matches.filter(m => m.unit && (m.unit === targetUnit || m.unit.indexOf(targetUnit) >= 0 || targetUnit.indexOf(m.unit) >= 0));
    if (unitMatches.length === 1) return unitMatches[0];
  }
  return { ambiguous: true, name: targetName, unit: targetUnit, matchCount: matches.length };
}

function markOfficialDocumentQueueRows_(sheet, headers, entries, status, resultText) {
  const now = officialDocumentNow_();
  entries.forEach(entry => {
    const row = entry.row.slice();
    setOfficialDocumentCell_(row, headers, '通知狀態', status);
    setOfficialDocumentCell_(row, headers, '通知時間', now);
    setOfficialDocumentCell_(row, headers, '通知結果', resultText);
    setOfficialDocumentCell_(row, headers, '更新時間', now);
    sheet.getRange(entry.rowNo, 1, 1, headers.length).setValues([row]);
  });
}

function buildOfficialDocumentDispatchReminderFlex_(group) {
  const records = Array.isArray(group.records) ? group.records : [];
  return buildOfficialDocumentListFlex_({
    mode: 'reminder',
    title: '📨 公文待發文提醒',
    altPrefix: '📨 公文待發文提醒',
    color: '#D93025',
    accentColor: '#FCE8E6',
    date: group.date || '',
    slot: group.slot || '',
    handlerName: group.handlerName || '',
    records,
    message: '請登入 Vital OD 公文系統完成發文作業。',
  });
}

function getOfficialDocumentQueueStatusForUser_(userId) {
  const staff = (typeof getDailyWorkStaffByUserId_ === 'function') ? getDailyWorkStaffByUserId_(userId) : null;
  if (!staff || !staff.name) {
    return buildOfficialDocumentStatusFlex_({
      date: sanitizeOfficialDocumentDate_(''),
      slot: '',
      isStaff: false,
      handlerName: '',
      records: [],
      message: '你的 LINE 帳號尚未在「訂閱者清單」標記為同仁。',
    });
  }

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  setupOfficialDocumentMonitorSheets_(ss);
  const sheet = getOfficialDocumentQueueSheet_(ss);
  const dateStr = sanitizeOfficialDocumentDate_('');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return buildOfficialDocumentStatusFlex_({
      date: dateStr,
      slot: '',
      isStaff: true,
      handlerName: staff.name,
      records: [],
      message: '今日尚未有公文待發文檢核紀錄。',
    });
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const dateCol = headers.indexOf('檢核日期');
  const slotCol = headers.indexOf('檢核時段');
  const nameCol = headers.indexOf('承辦人姓名');
  if (dateCol < 0 || slotCol < 0 || nameCol < 0) throw new Error('公文待發文佇列缺少必要欄位');
  const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const todayRows = data.filter(row => String(row[dateCol] || '').trim() === dateStr);
  const latestSlot = todayRows.map(row => String(row[slotCol] || '').trim()).filter(Boolean).sort().pop() || '';
  const ownRows = latestSlot ? todayRows.filter(row => {
    const name = String(row[nameCol] || '').trim();
    const slot = String(row[slotCol] || '').trim();
    return slot === latestSlot && name === staff.name;
  }) : [];
  const records = ownRows.map(row => rowToOfficialDocumentRecord_(row, headers));
  return buildOfficialDocumentStatusFlex_({
    date: dateStr,
    slot: latestSlot,
    isStaff: true,
    handlerName: staff.name,
    records,
    message: latestSlot ? '' : '今日尚未有公文待發文檢核紀錄。',
  });
}

function buildOfficialDocumentStatusFlex_(status) {
  status = status || {};
  const records = Array.isArray(status.records) ? status.records : [];
  const hasPending = records.length > 0;
  const color = !status.isStaff ? '#5F6368' : hasPending ? '#D93025' : '#137333';
  const title = !status.isStaff
    ? '尚未啟用同仁身分'
    : hasPending
      ? '尚有 ' + records.length + ' 件待發文'
      : '目前沒有待發文';
  return buildOfficialDocumentListFlex_({
    mode: 'status',
    title: '📨 公文待發文',
    altPrefix: '📨 公文待發文狀態',
    color,
    accentColor: '#ffffff',
    date: status.date || '',
    slot: status.slot || '',
    handlerName: status.handlerName || '',
    records,
    message: status.message || title,
  });
}

function buildOfficialDocumentListFlex_(opts) {
  opts = opts || {};
  const records = Array.isArray(opts.records) ? opts.records : [];
  const perBubble = 8;
  const maxBubbles = 12;
  const chunks = [];
  for (let i = 0; i < records.length; i += perBubble) {
    chunks.push(records.slice(i, i + perBubble));
  }
  if (chunks.length === 0) chunks.push([]);
  const totalPages = Math.min(chunks.length, maxBubbles);
  const truncatedCount = chunks.length > maxBubbles ? records.length - (perBubble * maxBubbles) : 0;
  const bubbles = chunks.slice(0, maxBubbles).map((chunk, pageIndex) => {
    const startNo = pageIndex * perBubble + 1;
    return buildOfficialDocumentListBubble_({
      title: opts.title || '📨 公文待發文',
      color: opts.color || '#D93025',
      accentColor: opts.accentColor || '#ffffff',
      date: opts.date || '',
      slot: opts.slot || '',
      handlerName: opts.handlerName || '',
      records: chunk,
      totalCount: records.length,
      startNo,
      pageNo: pageIndex + 1,
      totalPages,
      message: pageIndex === 0 ? opts.message : '',
      truncatedCount: pageIndex === maxBubbles - 1 ? truncatedCount : 0,
    });
  });
  return {
    type: 'flex',
    altText: (opts.altPrefix || '📨 公文待發文') + ' ' + records.length + ' 件',
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  };
}

function buildOfficialDocumentListBubble_(opts) {
  const records = Array.isArray(opts.records) ? opts.records : [];
  const subtitleParts = [opts.date, opts.slot].filter(Boolean);
  const body = [
    { type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: '待發文', flex: 2, size: 'sm', color: '#666666' },
      { type: 'text', text: opts.totalCount + ' 件', flex: 5, size: 'sm', color: opts.color || '#D93025', weight: 'bold' },
    ]},
  ];
  if (opts.handlerName) {
    body.push({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: '承辦人', flex: 2, size: 'sm', color: '#666666' },
      { type: 'text', text: opts.handlerName, flex: 5, size: 'sm', weight: 'bold', wrap: true },
    ]});
  }
  if (subtitleParts.length > 0) {
    body.push({ type: 'box', layout: 'baseline', spacing: 'sm', contents: [
      { type: 'text', text: '時段', flex: 2, size: 'sm', color: '#666666' },
      { type: 'text', text: subtitleParts.join(' '), flex: 5, size: 'sm', wrap: true },
    ]});
  }
  if (opts.message) {
    body.push({ type: 'text', text: opts.message, size: 'sm', color: '#202124', margin: 'sm', wrap: true });
  }
  body.push({ type: 'separator', margin: 'md' });
  records.forEach((record, index) => {
    body.push(buildOfficialDocumentRecordBox_(record, opts.startNo + index));
  });
  if (records.length === 0) {
    body.push({ type: 'text', text: '目前沒有待發文。', size: 'sm', color: '#5F6368', margin: 'sm', wrap: true });
  }
  if (opts.truncatedCount > 0) {
    body.push({ type: 'text', text: 'LINE 圖卡容量限制，尚有 ' + opts.truncatedCount + ' 件請至公文系統查看。', size: 'xs', color: '#5F6368', margin: 'sm', wrap: true });
  }
  return {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: opts.color || '#D93025',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: opts.title || '📨 公文待發文', color: '#ffffff', weight: 'bold', size: 'lg', wrap: true },
        { type: 'text', text: (subtitleParts.join(' ') || '今日') + (opts.totalPages > 1 ? '・第 ' + opts.pageNo + '/' + opts.totalPages + ' 頁' : ''), color: opts.accentColor || '#ffffff', size: 'sm', wrap: true },
      ],
    },
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: body,
    },
  };
}

function buildOfficialDocumentRecordBox_(record, itemNo) {
  const title = trimLineText_((itemNo ? itemNo + '. ' : '') + (record.documentNo || record.outboundNo || '未命名公文'), 80);
  const details = [];
  if (record.outboundNo && record.outboundNo !== record.documentNo) details.push('發文字號 ' + record.outboundNo);
  details.push('限辦日期 ' + (record.dueDate || '未填'));
  return {
    type: 'box',
    layout: 'vertical',
    spacing: 'xs',
    margin: 'sm',
    contents: [
      { type: 'text', text: title, size: 'sm', weight: 'bold', color: '#202124', wrap: true },
      { type: 'text', text: details.join('｜'), size: 'xs', color: '#5F6368', wrap: true },
    ],
  };
}

function rowToOfficialDocumentRecord_(row, headers) {
  const get = name => {
    const i = headers.indexOf(name);
    return i >= 0 ? String(row[i] || '').trim() : '';
  };
  return {
    documentKey: get('文件Key'),
    documentNo: get('公文文號'),
    outboundNo: get('發文字號'),
    handler: get('承辦人員'),
    handlerName: get('承辦人姓名'),
    unit: get('承辦單位'),
    dueDate: get('限辦日期'),
  };
}

function normalizeOfficialDocumentRecord_(raw) {
  raw = raw || {};
  const handler = sanitizeText_(raw.handler || raw.handlerRaw || raw.assignee || raw.owner, 120);
  const parsed = parseOfficialDocumentHandler_(handler);
  const handlerName = sanitizeText_(raw.handlerName || parsed.name, 80);
  const unit = sanitizeText_(raw.unit || raw.handlerUnit || parsed.unit, 120);
  const documentNo = sanitizeText_(raw.documentNo || raw.docNo || raw.caseNo, 120);
  const outboundNo = sanitizeText_(raw.outboundNo || raw.issueNo || raw.dispatchNo, 120);
  const dueDate = sanitizeText_(raw.dueDate || raw.deadline, 80);
  const documentKey = sanitizeText_(raw.documentKey || raw.key || hashOfficialDocumentKey_([documentNo, outboundNo, handlerName, dueDate].join('|')), 160);
  return {
    documentKey,
    documentNo,
    outboundNo,
    handler,
    handlerName,
    unit,
    dueDate,
  };
}

function parseOfficialDocumentHandler_(raw) {
  const text = String(raw || '').trim();
  const match = text.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
  if (!match) return { name: text, unit: '' };
  return { name: match[1].trim(), unit: match[2].trim() };
}

function hashOfficialDocumentKey_(text) {
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text || ''), Utilities.Charset.UTF_8);
  return digest.map(b => {
    const n = b < 0 ? b + 256 : b;
    return ('0' + n.toString(16)).slice(-2);
  }).join('').substring(0, 32);
}

function officialDocumentQueueKey_(dateStr, slot, documentKey) {
  const d = String(dateStr || '').trim();
  const s = String(slot || '').trim();
  const k = String(documentKey || '').trim();
  if (!d || !s || !k) return '';
  return d + '|' + s + '|' + k;
}

function setOfficialDocumentCell_(row, headers, name, value) {
  const i = headers.indexOf(name);
  if (i >= 0) row[i] = value;
}

function sanitizeOfficialDocumentDate_(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

function sanitizeOfficialDocumentSlot_(value) {
  const text = String(value || '').trim();
  if (/^\d{2}:\d{2}$/.test(text)) return text;
  return Utilities.formatDate(new Date(), tz_(), 'HH:mm');
}

function officialDocumentNow_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}
