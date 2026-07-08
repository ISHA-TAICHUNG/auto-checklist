/**
 * ===== 檢查表模板與檢查項目讀取 =====
 *
 * 資料來源：DB Sheet
 *   - 「檢查表模板」工作表：定義有哪些檢查表
 *   - 「檢查項目」工作表：每張檢查表的細項
 *   - 「設備清單」工作表：每台設備
 *
 * 設計重點：
 *   未來新增「堆高機日檢」時，只需要在這 3 個工作表加列，不用改程式。
 */

/**
 * 取得單一設備的資料
 */
function getEquipmentById_(equipmentId) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('設備清單');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  const opt = name => {
    const i = headers.indexOf(name);
    return i >= 0 ? i : -1;
  };

  for (let i = 1; i < data.length; i++) {
    if (data[i][idx('設備代號')] === equipmentId) {
      // 嚴格判斷：boolean true / 字串 "TRUE" 才算啟用
      const isActive = isActiveValue_(data[i][idx('啟用')]);
      return {
        equipmentId: data[i][idx('設備代號')],
        equipmentName: data[i][idx('設備名稱')],
        machineSerial: data[i][idx('機械編號')],
        machineType: data[i][idx('型式規格')],
        category: data[i][idx('設備類別')],
        location: data[i][idx('所在位置')],
        venueSheetTab: data[i][idx('場地表分頁')],
        dailyTemplateId: opt('日檢表單ID') >= 0 ? data[i][opt('日檢表單ID')] : '',
        monthlyTemplateId: opt('月檢表單ID') >= 0 ? data[i][opt('月檢表單ID')] : '',
        active: isActive,
      };
    }
  }
  return null;
}

function getTemplateOverrideIdForEquipment_(equipment, formType) {
  if (!equipment) return '';
  const key = formType === 'daily' ? 'dailyTemplateId'
            : formType === 'monthly' ? 'monthlyTemplateId' : '';
  return key ? String(equipment[key] || '').trim() : '';
}

function buildTemplateMetaFromRow_(headers, row) {
  const idx = n => headers.indexOf(n);
  const ropIdx = findCol_(headers, '結果選項', 'resultOptions');
  const ropRaw = ropIdx >= 0 ? String(row[ropIdx] || '') : '';
  const schIdx = findCol_(headers, '月檢樣式', 'monthlySchema');
  const schRaw = schIdx >= 0 ? String(row[schIdx] || '') : '';
  return {
    templateId: row[idx('表單ID')],
    templateName: row[idx('表單名稱')],
    category: row[idx('設備類別')],
    cycle: row[idx('週期')],
    legalBasis: row[idx('法規依據')],
    rule: row[idx('填寫規則')],
    resultOptions: ropRaw.split(',').map(s => s.trim()).filter(Boolean),
    monthlySchema: normalizeMonthlySchema_(schRaw),
  };
}

function findTemplateMetaForEquipment_(headers, data, category, formType, equipment) {
  const idx = name => headers.indexOf(name);
  const cycleMap = { daily: '每日', monthly: '每月' };
  const targetCycle = cycleMap[formType];
  const overrideId = getTemplateOverrideIdForEquipment_(equipment, formType);

  ['表單ID', '啟用', '設備類別', '週期'].forEach(col => {
    if (idx(col) < 0) throw new Error('檢查表模板缺必要欄位：' + col + '（請執行 initializeDatabase 補欄）');
  });

  for (let i = 1; i < data.length; i++) {
    if (!isActiveValue_(data[i][idx('啟用')])) continue;
    if (overrideId) {
      if (String(data[i][idx('表單ID')] || '').trim() === overrideId &&
          data[i][idx('週期')] === targetCycle) {
        return buildTemplateMetaFromRow_(headers, data[i]);
      }
      continue;
    }
    if (data[i][idx('設備類別')] === category && data[i][idx('週期')] === targetCycle) {
      return buildTemplateMetaFromRow_(headers, data[i]);
    }
  }
  return null;
}

/**
 * 取得所有啟用中的設備
 */
function getEquipmentList_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('設備清單');
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  const cyclesByCategory = getTemplateCyclesByCategory_();

  const list = [];
  for (let i = 1; i < data.length; i++) {
    // 與 getEquipmentById_ 一致：支援 boolean true / 'TRUE' / '是' / '啟用'
    if (!isActiveValue_(data[i][idx('啟用')])) continue;
    const category = data[i][idx('設備類別')];
    const cycles = cyclesByCategory[category] || [];
    list.push({
      equipmentId: data[i][idx('設備代號')],
      equipmentName: data[i][idx('設備名稱')],
      category,
      location: data[i][idx('所在位置')],
      cycles,
      hasDaily: cycles.indexOf('每日') >= 0,
      hasMonthly: cycles.indexOf('每月') >= 0,
    });
  }
  return list;
}

/**
 * 依設備類別彙整已啟用模板的週期，讓前端只顯示可填的表單按鈕。
 */
function getTemplateCyclesByCategory_() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('檢查表模板');
  if (!sheet || sheet.getLastRow() < 2) return {};

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  const categoryIdx = idx('設備類別');
  const cycleIdx = idx('週期');
  const activeIdx = idx('啟用');
  if (categoryIdx < 0 || cycleIdx < 0 || activeIdx < 0) return {};

  const map = {};
  for (let i = 1; i < data.length; i++) {
    if (!isActiveValue_(data[i][activeIdx])) continue;
    const category = String(data[i][categoryIdx] || '').trim();
    const cycle = String(data[i][cycleIdx] || '').trim();
    if (!category || !cycle) continue;
    map[category] = map[category] || [];
    if (map[category].indexOf(cycle) < 0) map[category].push(cycle);
  }
  return map;
}

/**
 * 取得「特定設備 + 特定表單類型」尚未處理完成的異常項目（鎖定用）
 *
 * 用途：前端載入填表頁時，先 fetch 此函式，把仍在追蹤中的異常項
 *      鎖死成「只能選異常」，並帶入上次的異常說明作預設值。
 *
 * 解鎖條件：機具設備異常事件表「狀態」== 「已完成」才視為解除（嚴格模式）
 *           其他狀態（待處理 / 處理中 / 待重檢 / 不處理 / 空字串）都仍鎖
 *
 * 同一項次（order）有多筆 → 取最新一筆（依通報日期 desc）
 *
 * 回傳：[ { order, itemName, incidentId, reportDate, description, status, note, dueDate, assignee } ]
 */
function getLockedItemsForEquipment_(equipmentId, formType) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = getMachineIncidentSheet_(ss);
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  const cell = (row, name) => {
    const col = idx(name);
    return col >= 0 ? row[col] : '';
  };
  const dateCell = (row, name) => {
    const value = cell(row, name);
    if (value instanceof Date) return Utilities.formatDate(value, tz_(), 'yyyy-MM-dd');
    return String(value || '').trim();
  };

  // 欄位防呆：「機具設備異常事件」表如果還沒初始化會缺欄位，避免崩潰
  const REQUIRED = ['設備代號', '表單類型', '項次', '項目名稱', '通報日期', '異常說明', '狀態'];
  for (const col of REQUIRED) {
    if (idx(col) < 0) {
      Logger.log(`getLockedItemsForEquipment_：「機具設備異常事件」缺欄位 ${col}，回空陣列`);
      return [];
    }
  }

  // 表單類型對應：daily ↔ 每日、monthly ↔ 每月
  const targetType = formType === 'daily' ? '每日' : (formType === 'monthly' ? '每月' : '');
  if (!targetType) return [];

  // 「已完成」才算解鎖（嚴格模式），其他狀態都仍鎖
  const isLocked = (status) => {
    const s = String(status || '').trim();
    return s !== '已完成';
  };

  // 依 order 聚合，先收全部未完成列，再由最新列承接前一筆處理脈絡。
  const byOrder = {};
  for (let i = 1; i < data.length; i++) {
    if (cell(data[i], '設備代號') !== equipmentId) continue;
    if (cell(data[i], '表單類型') !== targetType) continue;
    if (!isLocked(cell(data[i], '狀態'))) continue;

    const order = Number(cell(data[i], '項次')) || 0;
    if (!order) continue;

    const rdStr = dateCell(data[i], '通報日期');

    const candidate = {
      order,
      itemName: String(cell(data[i], '項目名稱') || ''),
      incidentId: String(cell(data[i], '事件ID') || ''),
      reportDate: rdStr,
      description: String(cell(data[i], '異常說明') || ''),
      status: String(cell(data[i], '狀態') || ''),
      note: String(cell(data[i], '備註') || ''),
      dueDate: dateCell(data[i], '預計完成日'),
      assignee: String(cell(data[i], '負責人') || ''),
    };

    if (!byOrder[order]) byOrder[order] = [];
    byOrder[order].push(candidate);
  }

  return Object.keys(byOrder)
    .map(order => {
      const rows = byOrder[order].sort(machineIncidentCompareByReportDateDesc_);
      return machineIncidentMergeTrackingContext_(rows[0], rows);
    })
    .sort((a, b) => a.order - b.order);
}

function machineIncidentCompareByReportDateDesc_(a, b) {
  return String(b && b.reportDate || '').localeCompare(String(a && a.reportDate || ''));
}

function machineIncidentIsGeneratedTracking_(description) {
  return /^\[(沒改善|[^\]]*追蹤)\]\s*/.test(String(description || '').trim());
}

function machineIncidentNormalizeTrackingDescription_(description) {
  return String(description || '').trim().replace(/^\[沒改善\]\s*/, '[持續追蹤] ');
}

function machineIncidentHasHandlingContext_(incident) {
  if (!incident) return false;
  const status = String(incident.status || '').trim();
  return (!!status && status !== '待處理') ||
    !!String(incident.note || '').trim() ||
    !!String(incident.assignee || '').trim() ||
    !!String(incident.dueDate || '').trim();
}

function machineIncidentMergeTrackingContext_(latest, historyRows) {
  if (!latest) return latest;
  const merged = Object.assign({}, latest);
  merged.description = machineIncidentNormalizeTrackingDescription_(merged.description);

  if (!machineIncidentIsGeneratedTracking_(latest.description) || machineIncidentHasHandlingContext_(latest)) {
    return merged;
  }

  const inherited = (historyRows || []).find(row => row !== latest && machineIncidentHasHandlingContext_(row));
  if (!inherited) return merged;

  if (!String(merged.status || '').trim() || String(merged.status || '').trim() === '待處理') {
    merged.status = inherited.status || merged.status;
  }
  if (!String(merged.note || '').trim()) merged.note = inherited.note || '';
  if (!String(merged.assignee || '').trim()) merged.assignee = inherited.assignee || '';
  if (!String(merged.dueDate || '').trim()) merged.dueDate = inherited.dueDate || '';
  return merged;
}

/**
 * 取得指定「檢查表 + 設備」的完整 meta（給前端動態渲染）
 *
 * formType: 'daily' | 'monthly'
 *
 * 回傳：
 *   {
 *     equipment: {...},
 *     template:  { 表單ID, 表單名稱, 週期, 法規依據, 填寫規則 },
 *     items:     [ { 項目順序, 項目名稱, 檢查方法 }, ... ],
 *   }
 */
function getFormMeta_(formType, equipmentId) {
  // 不再 fallback 到 DEFAULT_EQUIPMENT（codex P1）
  // production 找不到 / 停用設備 → 直接拒絕，避免用 placeholder 跑生產
  const equipment = getEquipmentById_(equipmentId);
  if (!equipment) throw new Error('找不到設備：' + equipmentId);
  if (equipment.active === false) throw new Error('設備已停用：' + equipmentId);

  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);

  // 找對應的模板：優先依設備指定表單ID；未指定才回到同一設備類別 + 同一週期。
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplData = tplSheet.getDataRange().getValues();
  const tplHeaders = tplData[0];
  const template = findTemplateMetaForEquipment_(tplHeaders, tplData, equipment.category, formType, equipment);
  const cycleLabel = formType === 'daily' ? '每日' : (formType === 'monthly' ? '每月' : formType);
  if (!template) throw new Error(`找不到模板：${equipment.category} - ${cycleLabel}`);

  // 抓檢查項目
  const itemSheet = ss.getSheetByName('檢查項目');
  const itemData = itemSheet.getDataRange().getValues();
  const itemHeaders = itemData[0];
  const itemIdx = name => itemHeaders.indexOf(name);

  const items = [];
  for (let i = 1; i < itemData.length; i++) {
    if (itemData[i][itemIdx('表單ID')] !== template.templateId) continue;
    if (!isActiveValue_(itemData[i][itemIdx('啟用')])) continue;
    items.push({
      order: itemData[i][itemIdx('項目順序')],
      name: itemData[i][itemIdx('項目名稱')],
      method: itemData[i][itemIdx('檢查方法')] || '',
    });
  }
  items.sort((a, b) => a.order - b.order);

  return { equipment, template, items };
}
