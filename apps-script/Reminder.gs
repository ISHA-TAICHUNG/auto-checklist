/**
 * ===== 每日提醒信 =====
 *
 * 觸發時機：每天早上 09:00（由 Apps Script Time-driven trigger）
 *
 * 邏輯（針對每一台啟用中的設備）：
 *   1. 讀場地表 → 今天有沒有使用？
 *   2. 如果沒使用（含節假日）→ 跳過
 *   3. 如果有使用 → 查「填報紀錄」當天有沒有該設備的「每日」紀錄
 *   4. 如果沒填 → 寄信給承辦
 *
 * 注意：09:00 還在當天作業開始前後，所以這個寄信是「提醒今天要做」而非
 * 「昨天沒做」。如果你希望改成「檢查昨天有沒有做」，改 todayStart_() → yesterdayStart_()。
 */

function dailyReminderJob() {
  const today = todayStart_();
  const equipments = getEquipmentList_();
  const results = [];

  for (const eqp of equipments) {
    const full = getEquipmentById_(eqp.equipmentId);
    if (!full || !full.active) continue;

    const usage = getVenueUsage_(full, today);
    if (!usage.used) {
      results.push({ equipmentId: full.equipmentId, action: 'skip', reason: usage.reason || '無使用紀錄' });
      continue;
    }

    const filed = hasDailyRecord_(full.equipmentId, today);
    if (filed) {
      results.push({ equipmentId: full.equipmentId, action: 'skip', reason: '已填日檢' });
      continue;
    }

    sendUnfilledReminder_(full, today, usage);
    results.push({ equipmentId: full.equipmentId, action: 'mailed', usage: usage.content });
  }

  Logger.log('dailyReminderJob 結果：' + JSON.stringify(results));
  return results;
}

/**
 * 判斷指定設備、指定日期是否已有「每日」填報紀錄
 */
function hasDailyRecord_(equipmentId, date) {
  const ss = SpreadsheetApp.openById(CONFIG.DB_SHEET_ID);
  const sheet = ss.getSheetByName('填報紀錄');
  if (sheet.getLastRow() < 2) return false;

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const idx = name => headers.indexOf(name);

  const target = formatISODate_(date);
  for (let i = 1; i < data.length; i++) {
    if (
      data[i][idx('檢查日期')] === target &&
      data[i][idx('表單類型')] === '每日' &&
      data[i][idx('設備代號')] === equipmentId
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
  const rocDate = `${toROC_(date)}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;

  const subject = `[未填日檢提醒] ${rocDate} ${equipment.equipmentName}`;

  // 取得這台設備的填表連結（如果系統設定有存 webAppUrl 就用，否則留空）
  const webAppUrl = getSetting_('webAppUrl', '');
  const fillLink = webAppUrl
    ? `${webAppUrl}?form=daily&eqp=${encodeURIComponent(equipment.equipmentId)}`
    : '（請至系統入口填寫）';

  const htmlBody = `
    <div style="font-family: 'Microsoft JhengHei', Arial, sans-serif; font-size: 14px; color: #222; line-height: 1.6;">
      <p>承辦您好，</p>
      <p>系統偵測到 <b>${rocDate}</b> <b>${equipment.equipmentName}</b> 場地有使用紀錄，但尚未完成<b>每日作業前檢點表</b>填報。</p>
      <table style="border-collapse: collapse; margin: 12px 0;">
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">設備代號</td><td><b>${equipment.equipmentId}</b></td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">設備名稱</td><td>${equipment.equipmentName}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">機械編號</td><td>${equipment.machineSerial}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">所在位置</td><td>${equipment.location}</td></tr>
        <tr><td style="padding: 4px 12px 4px 0; color: #666;">場地表內容</td><td><b>${escapeHtml_(usage.content)}</b></td></tr>
      </table>
      <p>請通知當日使用單位 / 操作人員儘速完成檢點：</p>
      <p><a href="${fillLink}" style="display: inline-block; background: #1a73e8; color: #fff; padding: 10px 20px; border-radius: 4px; text-decoration: none;">前往填寫</a></p>
      <hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;">
      <p style="font-size: 12px; color: #888;">
        本信由「自動檢查表電子化系統」自動寄送<br>
        ${CONFIG.ORGANIZATION_HEADER}
      </p>
    </div>
  `;

  MailApp.sendEmail({
    to: CONFIG.REMINDER_EMAIL_TO,
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
