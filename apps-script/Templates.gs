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
      return {
        equipmentId: data[i][idx('設備代號')],
        equipmentName: data[i][idx('設備名稱')],
        machineSerial: data[i][idx('機械編號')],
        machineType: data[i][idx('型式規格')],
        category: data[i][idx('設備類別')],
        location: data[i][idx('所在位置')],
        venueSheetTab: data[i][idx('場地表分頁')],
        active: data[i][idx('啟用')] !== false,
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
    if (data[i][idx('啟用')] === false) continue;
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
  const equipment = getEquipmentById_(equipmentId) || CONFIG.DEFAULT_EQUIPMENT;

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
      tplData[i][tplIdx('啟用')] !== false
    ) {
      template = {
        templateId: tplData[i][tplIdx('表單ID')],
        templateName: tplData[i][tplIdx('表單名稱')],
        category: tplData[i][tplIdx('設備類別')],
        cycle: tplData[i][tplIdx('週期')],
        legalBasis: tplData[i][tplIdx('法規依據')],
        rule: tplData[i][tplIdx('填寫規則')],
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
    if (itemData[i][itemIdx('啟用')] === false) continue;
    items.push({
      order: itemData[i][itemIdx('項目順序')],
      name: itemData[i][itemIdx('項目名稱')],
      method: itemData[i][itemIdx('檢查方法')] || '',
    });
  }
  items.sort((a, b) => a.order - b.order);

  return { equipment, template, items };
}
