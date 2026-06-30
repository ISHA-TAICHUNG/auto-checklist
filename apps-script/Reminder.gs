/**
 * ===== 每日提醒信 =====
 *
 * 觸發時機：每天早上 09:00（由 Apps Script Time-driven trigger）
 *
 * 邏輯（per-category 聚合，不再 per-equipment 重複寄信）：
 *   1. 對每一台啟用中設備檢查場地表「今天有沒有使用」
 *   2. 沒使用 → 跳過
 *   3. 有使用 → 查「同類別」是否有任一設備今日已填日檢
 *   4. 同類別任一已填 → 跳過（業務規則：堆高機 6 台共用，填 1 張代表 group）
 *   5. 同類別都沒填 → 寄一封信給承辦（同類別不重複寄）
 *
 * 重要：以「設備類別」聚合 — 法規要求「該機具當日有檢點紀錄」即可，
 * 不必每台單獨填。否則 6 台堆高機 / 5 台衝剪機械都會誤寄多封信。
 */

function dailyReminderJob(opts) {
  const dryRun = !!(opts && opts.dryRun);
  const today = todayStart_();
  const equipments = getEquipmentList_();
  const results = [];
  const sentCategories = new Set();         // 同類別只寄一次
  const cyclesByCategory = getTemplateCyclesByCategory_();

  for (const eqp of equipments) {
    const full = getEquipmentById_(eqp.equipmentId);
    if (!full || !full.active) continue;

    const cycles = cyclesByCategory[full.category] || [];
    if (cycles.indexOf('每日') < 0) {
      continue;
    }

    // 防護具檢點：不對場地表（每日 PPE check 由操作員每堂課自行記錄、不發 reminder）
    if (full.category === '防護具檢點') {
      results.push({ equipmentId: full.equipmentId, category: full.category, action: 'skip',
                     reason: '防護具類別不發 reminder' });
      continue;
    }

    const usage = getVenueUsage_(full, today);
    if (!usage.used) {
      results.push({ equipmentId: full.equipmentId, category: full.category, action: 'skip',
                     reason: usage.reason || '無使用紀錄' });
      continue;
    }

    if (hasDailyRecordInCategory_(full.category, today)) {
      results.push({ equipmentId: full.equipmentId, category: full.category, action: 'skip',
                     reason: '該類別當日已填' });
      continue;
    }

    if (sentCategories.has(full.category)) {
      results.push({ equipmentId: full.equipmentId, category: full.category, action: 'skip',
                     reason: '同類別已寄信' });
      continue;
    }

    if (!dryRun) sendUnfilledReminder_(full, today, usage);
    sentCategories.add(full.category);
    results.push({ equipmentId: full.equipmentId, category: full.category,
                   action: dryRun ? 'wouldMail' : 'mailed',
                   usage: usage.content });
  }

  if (typeof monthlyReminderJob_ === 'function') {
    const monthlyResults = monthlyReminderJob_({ dryRun, today });
    monthlyResults.forEach(r => results.push(r));
  }

  Logger.log((dryRun ? 'dryRun ' : '') + 'dailyReminderJob 結果：' + JSON.stringify(results));
  return results;
}

/**
 * 判斷指定「設備類別」當天是否有任一設備填了日檢
 * （取代舊版 per-equipment 的 hasDailyRecord_，避免 group 內每台重複寄信）
 */
function hasDailyRecordInCategory_(category, date) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (sheet.getLastRow() < 2) return false;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const dateCol = headers.indexOf('檢查日期');
  const typeCol = headers.indexOf('表單類型');
  const categoryCol = headers.indexOf('設備類別');
  const missing = [];
  if (dateCol < 0) missing.push('檢查日期');
  if (typeCol < 0) missing.push('表單類型');
  if (categoryCol < 0) missing.push('設備類別');
  if (missing.length) {
    Logger.log('填報紀錄缺欄位，無法判斷日檢是否已填：' + missing.join(', '));
    return false;
  }
  const target = formatISODate_(date);

  for (let i = 1; i < data.length; i++) {
    let cellDate = data[i][dateCol];
    if (cellDate instanceof Date) cellDate = formatISODate_(cellDate);
    else cellDate = String(cellDate);
    if (
      cellDate === target &&
      data[i][typeCol] === '每日' &&
      data[i][categoryCol] === category
    ) {
      return true;
    }
  }
  return false;
}

/**
 * 寄信給承辦人
 */
function sendUnfilledReminder_(equipment, date, usage) {
  const p = dateParts_(date);
  const rocDate = `${p.y - 1911}/${String(p.m).padStart(2, '0')}/${String(p.d).padStart(2, '0')}`;

  // 主旨改成 category-based（不指特定機台，避免「6 台都寄」誤導）
  const subject = `[未填日檢提醒] ${rocDate} ${equipment.category}`;

  // 前端連結：用 ?cat= 進入 group 列表頁（讓使用者自選機台填）
  const webFrontendUrl =
    getSetting_('webFrontendUrl', '') || CONFIG.DEFAULT_WEB_FRONTEND_URL;
  const fillLink = webFrontendUrl
    ? `${webFrontendUrl}/?cat=${encodeURIComponent(equipment.category)}`
    : '';

  const E = escapeHtml_;
  const linkButton = fillLink
    ? `<p><a href="${E(fillLink)}" style="display: inline-block; background: #1a73e8; color: #fff; padding: 10px 20px; border-radius: 4px; text-decoration: none;">前往填寫</a></p>`
    : '';

  const htmlBody = `
    <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; font-size: 14px; color: #222; line-height: 1.6;">
      <p>承辦您好，</p>
      <p>系統偵測到 <b>${E(rocDate)}</b> <b>${E(equipment.category)}</b> 場地有使用紀錄，
         但<b>該類別當日尚未有任何機台完成每日檢點表填報</b>。</p>
      <table style="border-collapse: collapse; margin: 12px 0;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">機具類別</td><td><b>${E(equipment.category)}</b></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">所在位置</td><td>${E(equipment.location)}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">場地表內容</td><td><b>${E(usage.content)}</b></td></tr>
      </table>
      <p>請通知當日使用單位 / 操作人員儘速完成檢點（同類別任一機台填一張即可）：</p>
      ${linkButton}
      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
      <p style="font-size: 12px; color: #888;">
        本信由「自動檢查表電子化系統」自動寄送<br>
        ${E(getOrgHeader_())}
      </p>
    </div>
  `;

  // === 通知 channel：優先 LINE，**失敗才** fallback 到 email（codex 2026-05-26 P1.4）===
  const lineCfg = (typeof getLineConfig_ === 'function') ? getLineConfig_() : null;
  const hasLineToken = lineCfg && lineCfg.token;
  // webFrontendUrl 空時，sendReminder_ 內部會構造 invalid Flex URI → 提前判斷不傳 link
  const safeFillLink = fillLink && /^https?:\/\//.test(fillLink)
    ? fillLink
    : '';

  if (hasLineToken) {
    try {
      const allEqps = getEquipmentList_().filter(e => e.category === equipment.category);
      // 修 codex P1.1 (round 2): sendReminder_ 失敗時 return {ok:false} 不 throw
      // 必須檢查回傳值 ok === true，否則 throw 進 catch 走 email fallback
      const r = sendReminder_(equipment.category, allEqps, safeFillLink, {
        notificationColumn: LINE_NOTIFICATION_COLUMNS.MACHINE_DAILY_REMINDER,
      });
      if (r && r.ok === true) {
        Logger.log(`[Reminder] 已透過 LINE 通知 ${equipment.category} ${allEqps.length} 台未填`);
        return;
      }
      throw new Error(`LINE push 失敗（非 throw 路徑）: ${JSON.stringify(r)}`);
    } catch (lineErr) {
      // LINE 推播失敗（token 失效 / LINE API down / multicast 全 fail / no_target 等）→ 改走 email fallback
      Logger.log(`[Reminder] LINE 推播失敗，fallback 到 email: ${lineErr}\n${lineErr.stack || ''}`);
      // 不 return，繼續走下方 email 路徑
    }
  }

  // Fallback：email（既有行為）
  MailApp.sendEmail({
    to: getReminderEmail_(),
    cc: CONFIG.REMINDER_EMAIL_CC,
    name: CONFIG.REMINDER_EMAIL_FROM_NAME,
    subject,
    htmlBody,
  });
}

/**
 * 一鍵：建立每日 09:00 提醒觸發器
 * 部署完成後，到 Apps Script 編輯器手動執行一次此函數即可
 */
function installDailyReminderTrigger() {
  // 先刪掉舊的同名觸發器，避免重複
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyReminderJob')
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger('dailyReminderJob')
    .timeBased()
    .everyDays(1)
    .atHour(CONFIG.REMINDER_TRIGGER_HOUR)
    .create();

  Logger.log(`已安裝每日 ${CONFIG.REMINDER_TRIGGER_HOUR}:00 提醒觸發器`);
}
