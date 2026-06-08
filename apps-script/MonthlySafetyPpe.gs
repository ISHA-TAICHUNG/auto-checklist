/**
 * ===== 教室量測設備 / PPE / SCBA 每月檢核表 =====
 *
 * 來源：
 * - 龍井 / 復興 / 忠明「置備之安全衛生量測設備及個人防護具每月檢核表」
 * - SCBA 月檢不再獨立成第四張表，而是併入三間教室表單下方獨立區塊。
 *
 * 這批表單是 monthly-only，前端沿用堆高機「簡式月檢」UI；
 * PDF 另由 Pdf.gs 轉成原紙本表單欄位（應備數量 / 單位 / 廠牌規格或型號 / 檢核結果）。
 */

function getMonthlySafetyPpeDefinitions_() {
  const commonRule = '正常打「ˇ」/ 異常打「X」；異常需填寫說明與改善措施';
  const commonLegal = '職業安全衛生設施規則、職業安全衛生管理辦法';
  const scbaSection = 'SCBA 空氣呼吸器檢查';
  const scbaItems = [
    ['面體、吸氣管、呼氣閥、眼睛玻璃罩是否完好', '目視'],
    ['減壓閥及壓力指示計是否正常', '目視'],
    ['壓力指示是否在最高填充壓力80%以上', '目視'],
    ['呼氣閥蓋是否完好', '目視'],
    ['置放地點溫度是否在40°C以下', '溫度計'],
    ['主閥是否無洩漏', '有無氣音'],
    ['高壓導管是否完好', '目視'],
    ['背負具（背帶、金屬裝置）是否完好', '目視'],
    ['外表是否保持清潔', '目視'],
  ].map(item => [item[0], item[1], scbaSection]);
  const withScbaBlock = items => items.concat(scbaItems);

  const defs = [
    {
      templateId: 'F-LJ-MEAS-PPE-M',
      equipmentId: 'CLASSROOM-LJ-MEAS-PPE',
      category: '龍井教室安全衛生量測設備及個人防護具',
      equipmentName: '龍井教室量測設備及個人防護具月檢',
      location: '龍井教室',
      templateName: '龍井教室置備之安全衛生量測設備及個人防護具每月檢核表',
      legalBasis: commonLegal,
      rule: commonRule,
      items: withScbaBlock([
        ['安全帽', '數量/外觀/操作；應備1頂；石頭牌安全帽 型號：SM-901'],
        ['安全鞋', '數量/外觀/操作；應備1雙；藍鷹牌橡膠鞋底安全鞋 型號：EN.345.99.S5'],
        ['安全帶', '數量/外觀/操作；應備1條；HC-321豪華型插扣式'],
        ['安全眼鏡', '數量/外觀/操作；應備1個；HCP-1'],
        ['防護手套', '數量/外觀/操作；應備1雙；ULTRANITRIL 492'],
        ['防護面罩', '數量/外觀/操作；應備1個；藍鷹牌EN166-B'],
        ['防護衣', '數量/外觀/操作；應備1套；C級，chemMax1'],
        ['防護口罩', '數量/外觀/操作；應備1個；單濾塵罐、雙排氣孔 NP-303'],
        ['防音防護具', '數量/外觀/操作；應備1個；型號:EP-106'],
        ['電氣絕緣手套', '數量/外觀/操作；應備1雙；Sperian 9351'],
        ['空氣(氧氣)呼吸器', '數量/外觀/操作；應備1台；Rite RHZKF6.8/30 GB1266 序號J93057'],
        ['檢知器(含檢知管)', '數量/外觀/操作；應備1組；(器)型號 GASTEC GV-100 (管)型號Tube NO.128U'],
        ['氣狀有害物採樣設備', '數量/外觀/操作；應備1組；Gilian/Sensidyne(U.S.A) 型號：BDX II S/N:20140904047'],
        ['粒狀有害物採樣設備', '數量/外觀/操作；應備1組；Gilian/Sensidyne(U.S.A) 型號：BDX II S/N:20140904048'],
        ['可燃性氣體測定器', '數量/外觀/操作；應備1台；PGM-2400P S/N:181-202175'],
        ['氧氣測定器', '數量/外觀/操作；應備1台；型號MP100 序號00101057260'],
        ['照度計', '數量/外觀/操作；應備1台；TES 1330N'],
        ['噪音計', '數量/外觀/操作；應備1台；TM-101 S/N:120605761'],
        ['三用電表', '數量/外觀/操作；應備2台；KILLER耐摔型269'],
        ['風速計', '數量/外觀/操作；應備1台；TM-412 S/N:131100169'],
        ['WBGT測定設備', '數量/外觀/操作；應備1組；MC黑球溫度計'],
        ['檢電器具', '數量/外觀/操作；應備1部；LVD-15'],
      ]),
    },
    {
      templateId: 'F-FX-MEAS-PPE-M',
      equipmentId: 'CLASSROOM-FX-MEAS-PPE',
      category: '復興教室安全衛生量測設備及個人防護具',
      equipmentName: '復興教室量測設備及個人防護具月檢',
      location: '復興教室',
      templateName: '復興教室置備之安全衛生量測設備及個人防護具每月檢核表',
      legalBasis: commonLegal,
      rule: commonRule,
      items: withScbaBlock([
        ['安全帽', '數量/外觀/操作；應備1頂；0.P0歐堡牌產業用防護頭盔-型號：SN-70-1'],
        ['安全鞋', '數量/外觀/操作；應備1雙；牛頭牌橡膠鞋底安全鞋 型號：SB-SRA-FO'],
        ['安全帶', '數量/外觀/操作；應備1條；背負式18-44-601013-3M'],
        ['安全眼鏡', '數量/外觀/操作；應備1個；雙眼1B-Z87+'],
        ['防護手套', '數量/外觀/操作；應備1雙；MAPA 492'],
        ['防護面罩', '數量/外觀/操作；應備1個；藍鷹牌ANSI Z87'],
        ['防護衣', '數量/外觀/操作；應備1套；C級，ULTITEL 4000S'],
        ['防護口罩', '數量/外觀/操作；應備1個；藍鷹牌4765-0001'],
        ['防音防護具', '數量/外觀/操作；應備1個；型號EN352-1'],
        ['電氣絕緣手套', '數量/外觀/操作；應備1雙；YOTSUGI YS-102-13-04'],
        ['空氣(氧氣)呼吸器', '數量/外觀/操作；應備1台；RHZKF6.8/30 GB1266序號Y064028'],
        ['檢知器(含檢知管)', '數量/外觀/操作；應備1組；(器)型號GV-100 S (管)型號GASTEC NO.1HH'],
        ['氣狀有害物採樣設備', '數量/外觀/操作；應備1組；Gilian/Sensidyne(U.S.A) 型號：BDX II 序號：20191201116'],
        ['粒狀有害物採樣設備', '數量/外觀/操作；應備1組；Gilian/Sensidyne(U.S.A) 型號：BDX II 序號：20191201115'],
        ['可燃性氣體測定器', '數量/外觀/操作；應備1台；型號MP400P 序號040219010067'],
        ['氧氣測定器', '數量/外觀/操作；應備1台；型號MP100 序號M00101045849'],
        ['照度計', '數量/外觀/操作；應備1台；YF-1065序號181200806'],
        ['噪音計', '數量/外觀/操作；應備1台；TM-101序號190400266'],
        ['三用電表', '數量/外觀/操作；應備1台；TENMARS TM-24E 序號180200698'],
        ['風速計', '數量/外觀/操作；應備1台；TM-4001序號190800184'],
        ['WBGT測定設備', '數量/外觀/操作；應備1組；MC黑球溫度計'],
        ['檢電器具', "數量/外觀/操作；應備1部；Pro'sKit NT-309"],
      ]),
    },
    {
      templateId: 'F-ZM-MEAS-PPE-M',
      equipmentId: 'CLASSROOM-ZM-MEAS-PPE',
      category: '忠明教室安全衛生量測設備及個人防護具',
      equipmentName: '忠明教室量測設備及個人防護具月檢',
      location: '忠明教室',
      templateName: '忠明教室置備之安全衛生量測設備及個人防護具每月檢核表',
      legalBasis: commonLegal,
      rule: commonRule,
      items: withScbaBlock([
        ['安全帽', '數量/外觀/操作；應備1頂；石頭牌 HM'],
        ['安全鞋', '數量/外觀/操作；應備1雙；牛頭牌steel toe97'],
        ['安全帶', '數量/外觀/操作；應備1條；巨力 標準單掛勾'],
        ['安全眼鏡', '數量/外觀/操作；應備1個；ANSIZ 87+'],
        ['防護手套', '數量/外觀/操作；應備1雙；MAPA 492'],
        ['防護面罩', '數量/外觀/操作；應備1個；藍鷹 EN166-B'],
        ['防護衣', '數量/外觀/操作；應備1套；C級，chemMax1'],
        ['防護口罩', '數量/外觀/操作；應備1個；NP-305'],
        ['防音防護具', '數量/外觀/操作；應備1個；Model 1000'],
        ['電氣絕緣手套', '數量/外觀/操作；應備1雙；Sperian 9351'],
        ['空氣(氧氣)呼吸器', '數量/外觀/操作；應備1台；Rite RHZKF6.8/30 J15167'],
        ['檢知器(含檢知管)', '數量/外觀/操作；應備1組；(器)GASTEC GV-100S；(管)AP-20S'],
        ['氣狀有害物採樣設備', '數量/外觀/操作；應備1組；BDXII S/N:20120604099'],
        ['粒狀有害物採樣設備', '數量/外觀/操作；應備1組；BDXII S/N:20120702097'],
        ['可燃性氣體測定器', '數量/外觀/操作；應備1台；POLI MP400P S/N:00403004632'],
        ['氧氣測定器', '數量/外觀/操作；應備1台；MP-100 S/N M00101051227'],
        ['照度計', '數量/外觀/操作；應備1台；TM-202 S/N：120201774'],
        ['噪音計', '數量/外觀/操作；應備1台；TM-101 S/N:131202602'],
        ['三用電表', '數量/外觀/操作；應備1台；KILLER 耐摔型電錶249'],
        ['風速計', '數量/外觀/操作；應備1台；TES-1340 S/N：120207379'],
        ['WBGT測定設備', '數量/外觀/操作；應備1組；黑球溫度計'],
        ['檢電器具', '數量/外觀/操作；應備1部；LVD-15'],
      ]),
    },
  ];
  return defs;
}

function getMonthlySafetyPpeReminderCategories_() {
  return getMonthlySafetyPpeDefinitions_().map(def => def.category);
}

function isMonthlySafetyPpeReminderCategory_(category) {
  return getMonthlySafetyPpeReminderCategories_().indexOf(category) >= 0;
}

function getMonthlyEquipmentReminderCategories_() {
  return ['固定式起重機', '堆高機'];
}

function getMonthlyReminderCategories_() {
  return getMonthlySafetyPpeReminderCategories_()
    .concat(getMonthlyEquipmentReminderCategories_());
}

function isMonthlyReminderCategory_(category) {
  return getMonthlyReminderCategories_().indexOf(String(category || '').trim()) >= 0;
}

function addMonthlySafetyPpeForms() {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const defs = getMonthlySafetyPpeDefinitions_();
  const out = {
    templatesAdded: 0,
    templatesUpdated: 0,
    equipmentsAdded: 0,
    equipmentsUpdated: 0,
    itemsAdded: 0,
    itemsUpdated: 0,
    legacyTemplatesDisabled: 0,
    legacyEquipmentsDisabled: 0,
    legacyItemsDisabled: 0,
  };

  const tplSheet = ss.getSheetByName('檢查表模板');
  const tplHeaders = tplSheet.getRange(1, 1, 1, tplSheet.getLastColumn()).getValues()[0];
  const tplIdx = name => tplHeaders.indexOf(name);
  const tplRows = tplSheet.getLastRow() > 1
    ? tplSheet.getRange(2, 1, tplSheet.getLastRow() - 1, tplHeaders.length).getValues()
    : [];
  const tplRowById = {};
  tplRows.forEach((r, i) => { tplRowById[String(r[tplIdx('表單ID')] || '')] = i + 2; });

  defs.forEach(def => {
    const values = {
      '表單ID': def.templateId,
      '設備類別': def.category,
      '表單名稱': def.templateName,
      '週期': '每月',
      '法規依據': def.legalBasis,
      '填寫規則': def.rule,
      '結果選項': 'ˇ,X',
      '月檢樣式': '簡式月檢',
      '啟用': '是',
    };
    const rowNo = tplRowById[def.templateId];
    if (rowNo) {
      setSheetRowValues_(tplSheet, tplHeaders, rowNo, values);
      out.templatesUpdated++;
    } else {
      appendSheetRowValues_(tplSheet, tplHeaders, values);
      out.templatesAdded++;
    }
  });

  const eqSheet = ss.getSheetByName('設備清單');
  const eqHeaders = eqSheet.getRange(1, 1, 1, eqSheet.getLastColumn()).getValues()[0];
  const eqIdx = name => eqHeaders.indexOf(name);
  const eqRows = eqSheet.getLastRow() > 1
    ? eqSheet.getRange(2, 1, eqSheet.getLastRow() - 1, eqHeaders.length).getValues()
    : [];
  const eqRowById = {};
  eqRows.forEach((r, i) => { eqRowById[String(r[eqIdx('設備代號')] || '')] = i + 2; });

  defs.forEach(def => {
    const values = {
      '設備代號': def.equipmentId,
      '設備名稱': def.equipmentName,
      '機械編號': '',
      '型式規格': def.templateName,
      '設備類別': def.category,
      '所在位置': def.location,
      '場地表分頁': '',
      '啟用': '是',
    };
    const rowNo = eqRowById[def.equipmentId];
    if (rowNo) {
      setSheetRowValues_(eqSheet, eqHeaders, rowNo, values);
      out.equipmentsUpdated++;
    } else {
      appendSheetRowValues_(eqSheet, eqHeaders, values);
      out.equipmentsAdded++;
    }
  });

  const itemSheet = ss.getSheetByName('檢查項目');
  const itemHeaders = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0];
  const itemIdx = name => itemHeaders.indexOf(name);
  const itemRows = itemSheet.getLastRow() > 1
    ? itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, itemHeaders.length).getValues()
    : [];
  const itemRowByKey = {};
  itemRows.forEach((r, i) => {
    itemRowByKey[String(r[itemIdx('表單ID')] || '') + '|' + String(r[itemIdx('項目順序')] || '')] = i + 2;
  });

  defs.forEach(def => {
    def.items.forEach((item, i) => {
      const order = i + 1;
      const values = {
        '表單ID': def.templateId,
        '項目順序': order,
        '項目名稱': formatMonthlySafetyPpeStoredItemName_(item),
        '檢查方法': item[1],
        '啟用': '是',
      };
      const key = def.templateId + '|' + order;
      const rowNo = itemRowByKey[key];
      if (rowNo) {
        setSheetRowValues_(itemSheet, itemHeaders, rowNo, values);
        out.itemsUpdated++;
      } else {
        appendSheetRowValues_(itemSheet, itemHeaders, values);
        out.itemsAdded++;
      }
    });
  });

  disableLegacyMonthlyScbaForm_(ss, out);

  try { applyChineseSettingsAndDropdowns(); } catch (e) { Logger.log('dropdown 重套失敗：' + e); }
  try { applyColumnWidthsAndWrap_(); } catch (e) { Logger.log('欄寬重套失敗：' + e); }

  Logger.log('addMonthlySafetyPpeForms 完成：' + JSON.stringify(out));
  return out;
}

function formatMonthlySafetyPpeStoredItemName_(item) {
  const name = item[0];
  const section = item[2] || '';
  return section ? `【${section}】${name}` : name;
}

function disableLegacyMonthlyScbaForm_(ss, out) {
  const legacyTemplateId = 'F-SCBA-M';
  const legacyEquipmentId = 'PPE-SCBA-MONTHLY';

  const tplSheet = ss.getSheetByName('檢查表模板');
  if (tplSheet && tplSheet.getLastRow() > 1) {
    const headers = tplSheet.getRange(1, 1, 1, tplSheet.getLastColumn()).getValues()[0];
    const idCol = headers.indexOf('表單ID');
    const activeCol = headers.indexOf('啟用');
    if (idCol >= 0 && activeCol >= 0) {
      const rows = tplSheet.getRange(2, 1, tplSheet.getLastRow() - 1, headers.length).getValues();
      rows.forEach((row, i) => {
        if (String(row[idCol] || '') !== legacyTemplateId) return;
        if (!isActiveValue_(row[activeCol])) return;
        tplSheet.getRange(i + 2, activeCol + 1).setValue('否');
        out.legacyTemplatesDisabled++;
      });
    }
  }

  const eqSheet = ss.getSheetByName('設備清單');
  if (eqSheet && eqSheet.getLastRow() > 1) {
    const headers = eqSheet.getRange(1, 1, 1, eqSheet.getLastColumn()).getValues()[0];
    const idCol = headers.indexOf('設備代號');
    const activeCol = headers.indexOf('啟用');
    if (idCol >= 0 && activeCol >= 0) {
      const rows = eqSheet.getRange(2, 1, eqSheet.getLastRow() - 1, headers.length).getValues();
      rows.forEach((row, i) => {
        if (String(row[idCol] || '') !== legacyEquipmentId) return;
        if (!isActiveValue_(row[activeCol])) return;
        eqSheet.getRange(i + 2, activeCol + 1).setValue('否');
        out.legacyEquipmentsDisabled++;
      });
    }
  }

  const itemSheet = ss.getSheetByName('檢查項目');
  if (itemSheet && itemSheet.getLastRow() > 1) {
    const headers = itemSheet.getRange(1, 1, 1, itemSheet.getLastColumn()).getValues()[0];
    const tplCol = headers.indexOf('表單ID');
    const activeCol = headers.indexOf('啟用');
    if (tplCol >= 0 && activeCol >= 0) {
      const rows = itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, headers.length).getValues();
      rows.forEach((row, i) => {
        if (String(row[tplCol] || '') !== legacyTemplateId) return;
        if (!isActiveValue_(row[activeCol])) return;
        itemSheet.getRange(i + 2, activeCol + 1).setValue('否');
        out.legacyItemsDisabled++;
      });
    }
  }
}

function setSheetRowValues_(sheet, headers, rowNo, values) {
  Object.keys(values).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) sheet.getRange(rowNo, col + 1).setValue(values[key]);
  });
}

function appendSheetRowValues_(sheet, headers, values) {
  const row = new Array(headers.length).fill('');
  Object.keys(values).forEach(key => {
    const col = headers.indexOf(key);
    if (col >= 0) row[col] = values[key];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([row]);
}

function getMonthlyReminderStartDay_() {
  const raw = Number(getSetting_('monthlyReminderStartDay', '25'));
  if (!raw || raw < 1 || raw > 31) return 25;
  return Math.floor(raw);
}

/**
 * 月檢「應檢期」(window)：當期可填的時段
 * 預設每月 1~5 號（依承辦實務「月初填寫」設定）
 * 可在 DB 系統設定 monthlyCheckWindowStart / monthlyCheckWindowEnd 覆蓋
 */
function getMonthlyCheckWindow_() {
  const start = Number(getSetting_('monthlyCheckWindowStart', '1'));
  const end = Number(getSetting_('monthlyCheckWindowEnd', '5'));
  const safeStart = (!start || start < 1 || start > 31) ? 1 : Math.floor(start);
  const safeEnd = (!end || end < safeStart || end > 31) ? Math.max(safeStart, 5) : Math.floor(end);
  return { start: safeStart, end: safeEnd };
}

function monthlyReminderJob_(opts) {
  opts = opts || {};
  const dryRun = !!opts.dryRun;
  const today = opts.today || todayStart_();
  const day = dateParts_(today).d;
  const startDay = getMonthlyReminderStartDay_();
  const checkWindow = getMonthlyCheckWindow_();
  const equipments = getEquipmentList_();
  const sentCategories = new Set();
  const results = [];

  for (const eqp of equipments) {
    const full = getEquipmentById_(eqp.equipmentId);
    if (!full || !full.active) continue;
    if (!isMonthlyReminderCategory_(full.category)) continue;

    const base = {
      equipmentId: full.equipmentId,
      equipmentName: full.equipmentName,
      category: full.category,
      formType: '每月',
    };

    if (sentCategories.has(full.category)) {
      results.push(Object.assign({}, base, { action: 'skip', reason: '同類別已寄月檢提醒' }));
      continue;
    }

    const inCheckWindow = (day >= checkWindow.start && day <= checkWindow.end);
    const inReminderPeriod = (day >= startDay);

    // 非「應檢期」也非「補填提醒期」→ 完全隱藏，不 push 到 results
    //   結果：cmdStatus_ 不會列、reminderStatus 也不會出現（避免 6~24 號之間冗餘訊息）
    if (!inCheckWindow && !inReminderPeriod) {
      continue;
    }

    if (hasMonthlyRecordInCategory_(full.category, today)) {
      results.push(Object.assign({}, base, { action: 'skip', reason: '該類別本月已填' }));
      continue;
    }

    // 應檢期內未填 → 顯示在狀態（讓承辦看進度），但不寄信（避免月初就吵）
    if (inCheckWindow && !inReminderPeriod) {
      results.push(Object.assign({}, base, {
        action: dryRun ? 'inWindow' : 'inWindow',
        reason: `本月應檢期(${checkWindow.start}-${checkWindow.end}日)尚未填`,
      }));
      sentCategories.add(full.category);
      continue;
    }

    // 已到補填提醒期（≥ startDay）+ 未填 → 寄信
    if (!dryRun) sendMonthlyUnfilledReminder_(full, today);
    sentCategories.add(full.category);
    results.push(Object.assign({}, base, { action: dryRun ? 'wouldMail' : 'mailed', reason: '本月尚未填月檢' }));
  }

  return results;
}

function hasMonthlyRecordInCategory_(category, date) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (!sheet || sheet.getLastRow() < 2) return false;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);
  const target = dateParts_(date);

  for (let i = 1; i < data.length; i++) {
    let cellDate = data[i][idx('檢查日期')];
    if (!(cellDate instanceof Date)) {
      const s = String(cellDate || '').trim();
      if (!s) continue;
      cellDate = new Date(s + 'T00:00:00+08:00');
    }
    const parts = dateParts_(cellDate);
    if (
      parts.y === target.y &&
      parts.m === target.m &&
      data[i][idx('表單類型')] === '每月' &&
      data[i][idx('設備類別')] === category
    ) {
      return true;
    }
  }
  return false;
}

function sendMonthlyUnfilledReminder_(equipment, date) {
  const p = dateParts_(date);
  const rocMonth = `${p.y - 1911}/${String(p.m).padStart(2, '0')}`;
  const subject = `[未填月檢提醒] ${rocMonth} ${equipment.category}`;
  const webFrontendUrl = getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL;
  const fillLink = webFrontendUrl
    ? `${webFrontendUrl}/monthly.html?eqp=${encodeURIComponent(equipment.equipmentId)}`
    : '';
  const E = escapeHtml_;
  const linkButton = fillLink
    ? `<p><a href="${E(fillLink)}" style="display:inline-block;background:#1a73e8;color:#fff;padding:10px 20px;border-radius:4px;text-decoration:none;">前往填寫月檢</a></p>`
    : '';

  const htmlBody = `
    <div style="font-family:'Microsoft JhengHei',Arial,sans-serif;font-size:14px;color:#222;line-height:1.6;">
      <p>承辦您好，</p>
      <p>系統偵測到 <b>${E(rocMonth)}</b> <b>${E(equipment.category)}</b> 尚未完成每月檢核表填報。</p>
      <table style="border-collapse:collapse;margin:12px 0;">
        <tr><td style="padding:4px 12px 4px 0;color:#666;">表單</td><td><b>${E(equipment.equipmentName)}</b></td></tr>
        <tr><td style="padding:4px 12px 4px 0;color:#666;">所在位置</td><td>${E(equipment.location)}</td></tr>
      </table>
      <p>請於月底前完成月檢；若檢核結果為異常，系統會自動建立異常事件並推播 LINE 通知。</p>
      ${linkButton}
      <hr style="border:none;border-top:1px solid #ddd;margin:24px 0;">
      <p style="font-size:12px;color:#888;">本信由「自動檢查表電子化系統」自動寄送<br>${E(getOrgHeader_())}</p>
    </div>
  `;

  const lineCfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
  const hasLineToken = lineCfg && lineCfg.token;
  const safeFillLink = fillLink && /^https?:\/\//.test(fillLink) ? fillLink : '';

  if (hasLineToken) {
    try {
      const r = sendSupervisorReminder_(equipment.category, [equipment], safeFillLink, {
        title: '本月未完成月檢',
        dateLabel: rocMonth,
        itemLabel: '待填表單',
        itemIcon: '📋',
        buttonLabel: '填寫月檢',
      });
      if (r && r.ok === true) return;
      throw new Error(`LINE 月檢提醒失敗（非 throw 路徑）: ${JSON.stringify(r)}`);
    } catch (lineErr) {
      Logger.log(`[MonthlyReminder] LINE 推播失敗，fallback 到 email: ${lineErr}\n${lineErr.stack || ''}`);
    }
  }

  MailApp.sendEmail({
    to: getReminderEmail_(),
    cc: CONFIG.REMINDER_EMAIL_CC,
    name: CONFIG.REMINDER_EMAIL_FROM_NAME,
    subject,
    htmlBody,
  });
}
