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
        active: isActive,
      };
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

  const list = [];
  for (let i = 1; i < data.length; i++) {
    // 與 getEquipmentById_ 一致：支援 boolean true / 'TRUE' / '是' / '啟用'
    if (!isActiveValue_(data[i][idx('啟用')])) continue;
    list.push({
      equipmentId: data[i][idx('設備代號')],
      equipmentName: data[i][idx('設備名稱')],
      category: data[i][idx('設備類別')],
      location: data[i][idx('所在位置')],
    });
  }
  return list;
}

/**
 * 取得「特定設備 + 特定表單類型」尚未處理完成的異常項目（鎖定用）
 *
 * 用途：前端載入填表頁時，先 fetch 此函式，把仍在追蹤中的異常項
 *      鎖死成「只能選異常」，並帶入上次的異常說明作預設值。
 *
 * 解鎖條件：異常事件表「狀態」== 「已完成」才視為解除（嚴格模式）
 *           其他狀態（待處理 / 處理中 / 待重檢 / 不處理 / 空字串）都仍鎖
 *
 * 同一項次（order）有多筆 → 取最新一筆（依通報日期 desc）
 *
 * 回傳：[ { order, itemName, incidentId, reportDate, description, status } ]
 */
function getLockedItemsForEquipment_(equipmentId, formType) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('異常事件');
  if (!sheet || sheet.getLastRow() < 2) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);

  // 欄位防呆：「異常事件」表如果還沒初始化會缺欄位，避免崩潰
  const REQUIRED = ['設備代號', '表單類型', '項次', '項目名稱', '通報日期', '異常說明', '狀態'];
  for (const col of REQUIRED) {
    if (idx(col) < 0) {
      Logger.log(`getLockedItemsForEquipment_：「異常事件」缺欄位 ${col}，回空陣列`);
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

  // 依 order 聚合，取最新一筆
  const byOrder = {};
  for (let i = 1; i < data.length; i++) {
    if (data[i][idx('設備代號')] !== equipmentId) continue;
    if (data[i][idx('表單類型')] !== targetType) continue;
    if (!isLocked(data[i][idx('狀態')])) continue;

    const order = Number(data[i][idx('項次')]) || 0;
    if (!order) continue;

    const rd = data[i][idx('通報日期')];
    const rdStr = rd instanceof Date
      ? Utilities.formatDate(rd, tz_(), 'yyyy-MM-dd')
      : String(rd || '').trim();

    const candidate = {
      order,
      itemName: String(data[i][idx('項目名稱')] || ''),
      incidentId: String(data[i][idx('事件ID')] || ''),
      reportDate: rdStr,
      description: String(data[i][idx('異常說明')] || ''),
      status: String(data[i][idx('狀態')] || ''),
    };

    // 取較新的（reportDate 比較 string 排序在 YYYY-MM-DD 格式下等同日期排序）
    if (!byOrder[order] || candidate.reportDate >= byOrder[order].reportDate) {
      byOrder[order] = candidate;
    }
  }

  return Object.values(byOrder).sort((a, b) => a.order - b.order);
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

  // 找對應的模板：同一設備類別 + 同一週期
  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplData = tplSheet.getDataRange().getValues();
  const tplHeaders = tplData[0];
  const tplIdx = name => tplHeaders.indexOf(name);

  const cycleMap = { daily: '每日', monthly: '每月' };
  const targetCycle = cycleMap[formType];

  let template = null;
  for (let i = 1; i < tplData.length; i++) {
    if (
      tplData[i][tplIdx('設備類別')] === equipment.category &&
      tplData[i][tplIdx('週期')] === targetCycle &&
      isActiveValue_(tplData[i][tplIdx('啟用')])
    ) {
      // 結果選項：comma-separated 結果代號（依各機具表單不同）
      // 用 findCol_ 支援中文（結果選項）/ 英文（resultOptions）雙向相容
      const ropIdx = findCol_(tplHeaders, '結果選項', 'resultOptions');
      const ropRaw = ropIdx >= 0 ? String(tplData[i][ropIdx] || '') : '';
      const resultOptions = ropRaw.split(',').map(s => s.trim()).filter(Boolean);

      const schIdx = findCol_(tplHeaders, '月檢樣式', 'monthlySchema');
      const schRaw = schIdx >= 0 ? String(tplData[i][schIdx] || '') : '';

      template = {
        templateId: tplData[i][tplIdx('表單ID')],
        templateName: tplData[i][tplIdx('表單名稱')],
        category: tplData[i][tplIdx('設備類別')],
        cycle: tplData[i][tplIdx('週期')],
        legalBasis: tplData[i][tplIdx('法規依據')],
        rule: tplData[i][tplIdx('填寫規則')],
        resultOptions,                                                          // []  → fallback by formType
        monthlySchema: normalizeMonthlySchema_(schRaw),                         // 內部正規化為 'simple' / 'crane_full' / ''
      };
      break;
    }
  }
  if (!template) throw new Error(`找不到模板：${equipment.category} - ${targetCycle}`);

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
