(function () {
  'use strict';

  if (window.top !== window.self) {
    try { window.top.location = window.self.location; } catch (_) {}
    return;
  }

  const state = {
    data: null,
    incidentTab: 'machine',
    timer: null,
    loading: false,
    actionLoading: false,
    adminSessionToken: '',
    backgroundRefreshStarted: false,
    pendingNotification: null,
    notificationRequests: {},
    stickyAlert: false,
    alertTimer: null,
  };
  const $ = id => document.getElementById(id);
  const dialog = $('unlockDialog');
  const form = $('unlockForm');
  const notificationDialog = $('notificationDialog');
  const notificationForm = $('notificationForm');

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function text(id, value) { $(id).textContent = value == null || value === '' ? '--' : String(value); }
  function statusLabel(status) {
    return status === 'completed' ? '已完成' : status === 'pending' ? '待完成' : '今日未使用';
  }
  function unavailable(value) { return value == null ? '--' : value; }

  function actionButton(label, config) {
    config = config || {};
    const classes = ['row-action', config.variant || 'secondary', config.compact ? 'compact' : '']
      .filter(Boolean).join(' ');
    const title = config.title ? ` title="${escapeHtml(config.title)}"` : '';
    return `<button class="${classes}" type="button" data-dashboard-action="${escapeHtml(config.action || '')}"
      data-record-type="${escapeHtml(config.recordType || '')}"
      data-record-id="${escapeHtml(config.recordId || '')}"
      data-link-type="${escapeHtml(config.linkType || '')}"${title}>${escapeHtml(label)}</button>`;
  }

  async function loadDashboard(sessionToken, opts) {
    opts = opts || {};
    if (state.loading) return;
    state.loading = true;
    if (opts.initial && dialog.open) {
      dialog.close();
      showAlert('正在驗證管理權限並讀取最近狀態...');
    }
    $('refreshButton').disabled = true;
    $('refreshButton').textContent = '載入中';
    try {
      const result = await window.API.adminDashboardStatus(sessionToken, {
        forceRefresh: opts.forceRefresh === true,
        snapshotOnly: opts.initial === true,
      });
      if (!result || result.ok !== true) throw new Error((result && result.error) || '無法載入面板');
      state.adminSessionToken = sessionToken;
      $('adminPassword').value = '';
      state.data = result;
      render(result);
      if (dialog.open) dialog.close();
      $('unlockError').textContent = '';
      scheduleRefresh(result.refreshAfterSeconds || 60);
      syncNavigation(window.location.hash || '#overview', { scroll: true });
      if (result.snapshotPending) {
        showAlert('管理權限已驗證，正在背景建立最新狀態，完成後會自動更新。');
      }
      if (result.snapshotStale && !opts.forceRefresh && !state.backgroundRefreshStarted) {
        state.backgroundRefreshStarted = true;
        window.setTimeout(() => loadDashboard(sessionToken, { forceRefresh: true, background: true }), 250);
      } else if (!result.snapshotStale) {
        state.backgroundRefreshStarted = false;
      }
    } catch (error) {
      if (opts.initial || /未授權/.test(String(error && error.message))) {
        state.adminSessionToken = '';
        $('unlockError').textContent = /未授權/.test(String(error && error.message))
          ? '中控台登入已失效，請重新輸入密碼'
          : '目前無法連線，請稍後再試';
        openDialog();
      } else {
        showAlert('重新整理失敗：' + (error && error.message ? error.message : error));
        scheduleRefresh((state.data && state.data.refreshAfterSeconds) || 60);
      }
    } finally {
      state.loading = false;
      $('refreshButton').disabled = false;
      $('refreshButton').textContent = '重新整理';
    }
  }

  function scheduleRefresh(seconds) {
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      const sessionToken = state.adminSessionToken;
      if (sessionToken && !document.hidden) loadDashboard(sessionToken, { forceRefresh: true, background: true });
      else scheduleRefresh(seconds);
    }, Math.max(30, Number(seconds || 60)) * 1000);
  }

  function render(data) {
    renderHeader(data);
    renderSummary(data.summary || {});
    renderChecks(data.sections && data.sections.checks);
    renderApprovals(data.sections && data.sections.approvals);
    renderIncidents(data.sections && data.sections.incidents);
    renderNotifications(data.sections && data.sections.notifications, data.sections && data.sections.officialDocuments);
    renderSystem(data.sections && data.sections.system);
    const errors = Object.keys(data.sectionErrors || {});
    if (errors.length) showAlert('部分狀態暫時無法取得：' + errors.join('、'));
    else if (!state.stickyAlert) $('alertBar').hidden = true;
  }

  function renderHeader(data) {
    const sourceLabel = data.cacheSource === 'snapshot' ? '（最近快照）' : data.cached ? '（快取）' : '';
    text('lastUpdated', (data.generatedAtLabel || '資料更新中') + sourceLabel);
    const badge = $('overallHealth');
    badge.className = 'health-badge ' + ((data.overall && data.overall.level) || 'neutral');
    badge.innerHTML = '<span></span>' + escapeHtml((data.overall && data.overall.label) || '狀態未知');
  }

  function renderSummary(summary) {
    text('dailyCompleted', unavailable(summary.dailyCompleted));
    text('dailyRequired', ' / ' + unavailable(summary.dailyRequired));
    text('dailyCaption', summary.dailyRequired === 0 ? '今日無需檢點' : '依場地使用狀態判定');
    text('monthlyPending', unavailable(summary.monthlyPending));
    const monthlyCompleted = summary.monthlyCompleted;
    const monthlyRequired = summary.monthlyRequired;
    text('monthlyCaption', monthlyRequired == null
      ? '等待載入'
      : `本月完成 ${monthlyCompleted || 0} / ${monthlyRequired}`);
    text('incidentOpen', unavailable(summary.incidentOpen));
    text('approvalPending', unavailable(summary.approvalPending));
    text('lineRemaining', unavailable(summary.lineRemaining));
  }

  function renderChecks(section) {
    if (!section || !section.available) return renderUnavailable('checkRows', 5);
    text('checksTime', '來源 ' + section.capturedAt);
    const daily = (section.daily && section.daily.items) || [];
    const monthly = (section.monthly && section.monthly.items) || [];
    const rows = daily.map(row => ({ ...row, cycle: '每日' }))
      .concat(monthly.map(row => ({ ...row, required: true, cycle: '每月', usage: '' })));
    $('checkRows').innerHTML = rows.length ? rows.map(row => `
      <tr>
        <td><strong>${escapeHtml(row.category)}</strong></td>
        <td>${escapeHtml(row.cycle)}</td>
        <td><span class="status ${escapeHtml(row.status)}">${statusLabel(row.status)}</span></td>
        <td>${escapeHtml(row.usage || (row.cycle === '每月' ? (row.equipmentName || '本月進度') : '無使用紀錄'))}</td>
        <td>${checklistRecordActions(row.records)}</td>
      </tr>`).join('') : '<tr><td colspan="5" class="empty">目前沒有檢點項目</td></tr>';
  }

  function checklistRecordActions(records) {
    const available = (records || []).filter(row => row && row.recordId && row.hasDocument);
    if (!available.length) return '<span class="record-empty">--</span>';
    const multiple = available.length > 1;
    return `<div class="check-record-actions">${available.map((row, index) => {
      const label = multiple
        ? (row.equipmentName || `紀錄 ${index + 1}`)
        : (row.documentLabel || '查看紀錄');
      return actionButton(label, {
        action: 'open-link',
        recordType: 'checklist',
        recordId: row.recordId,
        linkType: 'document',
        compact: true,
        title: `${row.equipmentName || '檢點紀錄'}：${row.documentLabel || '查看紀錄'}`,
      });
    }).join('')}</div>`;
  }

  function renderApprovals(section) {
    if (!section || !section.available) return renderQueueUnavailable('approvalRows');
    text('approvalsTime', '來源 ' + section.capturedAt);
    const rows = section.items || [];
    $('approvalRows').innerHTML = rows.length ? rows.map(row => `
      <article class="queue-item has-actions">
        <div class="queue-main"><strong>${escapeHtml(row.equipmentName || row.category || '未命名設備')}</strong>
          <p>${escapeHtml(row.formType || '')} · ${escapeHtml(row.inspector || '未標示檢查人')} · ${escapeHtml(row.checkDate || '')}</p></div>
        <span class="tag ${Number(row.ageHours || 0) >= 24 ? 'critical' : 'warning'}">${row.ageHours == null ? '待簽核' : escapeHtml(row.ageHours + ' 小時')}</span>
        <div class="queue-actions">
          ${row.hasDocument ? actionButton(row.documentLabel || '查看檢查表', { action: 'open-link', recordType: 'approval', recordId: row.recordId, linkType: 'document' }) : ''}
          ${actionButton('主管簽核', { action: 'open-link', recordType: 'approval', recordId: row.recordId, linkType: 'review', variant: 'primary' })}
          ${actionButton('提醒主管', { action: 'preview-notification', recordType: 'approval', recordId: row.recordId })}
        </div>
      </article>`).join('') : '<p class="empty">目前沒有待主管簽核</p>';
  }

  function renderIncidents(section) {
    if (!section || !section.available) return renderQueueUnavailable('incidentRows');
    text('incidentsTime', '來源 ' + section.capturedAt);
    text('machineCount', section.machine ? section.machine.count : 0);
    text('dailyIncidentCount', section.daily ? section.daily.count : 0);
    renderIncidentTab();
  }

  function renderIncidentTab() {
    const section = state.data && state.data.sections && state.data.sections.incidents;
    if (!section || !section.available) return;
    const rows = (section[state.incidentTab] && section[state.incidentTab].items) || [];
    $('incidentRows').innerHTML = rows.length ? rows.map(row => {
      const machine = state.incidentTab === 'machine';
      const title = machine ? (row.equipmentName || row.itemName) : (row.location || row.subject);
      const subtitle = machine
        ? [row.itemName, row.assignee, row.reportDate].filter(Boolean).join(' · ')
        : [row.subject, row.handler, row.reportDate].filter(Boolean).join(' · ');
      const tag = machine ? row.status : (row.reviewStatus || row.processStatus);
      const buttons = machine
        ? [
            row.hasPdf ? actionButton('查看 PDF', { action: 'open-link', recordType: 'machineIncident', recordId: row.recordId, linkType: 'pdf' }) : '',
            row.canManage
              ? actionButton('處理回報', { action: 'open-link', recordType: 'machineIncident', recordId: row.recordId, linkType: 'handle', variant: 'primary' })
              : '',
            row.canManage
              ? actionButton('提醒負責人', { action: 'preview-notification', recordType: 'machineIncident', recordId: row.recordId })
              : '',
          ]
        : [
            row.hasPdf ? actionButton('查看 PDF', { action: 'open-link', recordType: 'dailyIncident', recordId: row.incidentId, linkType: 'pdf' }) : '',
            row.reviewStatus !== '待主管審核'
              ? actionButton('處理回報', { action: 'open-link', recordType: 'dailyIncident', recordId: row.incidentId, linkType: 'handle', variant: 'primary' })
              : '',
            row.reviewStatus === '待主管審核'
              ? actionButton('主管審核', { action: 'open-link', recordType: 'dailyIncident', recordId: row.incidentId, linkType: 'review', variant: 'primary' })
              : (row.processStatus === '處理中' && row.supervisor
                ? actionButton('主管意見', { action: 'open-link', recordType: 'dailyIncident', recordId: row.incidentId, linkType: 'review' })
                : ''),
            actionButton(row.reviewStatus === '待主管審核' ? '提醒主管' : '提醒相關人員', {
              action: 'preview-notification', recordType: 'dailyIncident', recordId: row.incidentId,
            }),
          ];
      return `<article class="queue-item has-actions"><div class="queue-main"><strong>${escapeHtml(title || '未命名事件')}</strong><p>${escapeHtml(subtitle)}</p></div><span class="tag warning">${escapeHtml(tag || '待處理')}</span><div class="queue-actions">${buttons.join('')}</div></article>`;
    }).join('') : '<p class="empty">目前沒有未結案件</p>';
  }

  async function openDashboardLink(button) {
    if (!state.adminSessionToken || state.actionLoading) return;
    const newWindow = window.open('', '_blank');
    if (!newWindow) {
      showAlert('瀏覽器已阻擋新分頁，請允許這個網站開啟彈出視窗後再試。');
      return;
    }
    if (newWindow) {
      newWindow.opener = null;
      newWindow.document.title = '正在開啟';
      if (newWindow.document.body) {
        newWindow.document.body.textContent = '正在取得安全連結...';
      }
    }
    setActionButtonBusy(button, true, '開啟中');
    try {
      const result = await window.API.adminDashboardAction(state.adminSessionToken, {
        mode: 'resolveLink',
        recordType: button.dataset.recordType,
        recordId: button.dataset.recordId,
        linkType: button.dataset.linkType,
      });
      if (!result || result.ok !== true || !/^https:\/\//.test(String(result.url || ''))) {
        throw new Error((result && result.error) || '目前沒有可開啟的連結');
      }
      newWindow.location.replace(result.url);
    } catch (error) {
      if (newWindow) newWindow.close();
      showAlert('開啟失敗：' + (error && error.message ? error.message : error));
    } finally {
      setActionButtonBusy(button, false);
    }
  }

  async function previewDashboardNotification(button) {
    if (!state.adminSessionToken || state.actionLoading) return;
    setActionButtonBusy(button, true, '查詢收件人');
    try {
      const result = await window.API.adminDashboardAction(state.adminSessionToken, {
        mode: 'previewNotification',
        recordType: button.dataset.recordType,
        recordId: button.dataset.recordId,
      });
      if (!result || result.ok !== true) {
        throw new Error((result && result.error) || '無法取得提醒對象');
      }
      state.pendingNotification = {
        recordType: button.dataset.recordType,
        recordId: button.dataset.recordId,
        requestId: notificationRequestId_(button.dataset.recordType, button.dataset.recordId),
      };
      text('notificationDialogTitle', result.title || '確認發送 LINE 提醒');
      text('notificationDescription', result.description || '');
      $('notificationRecipients').innerHTML = (result.recipientNames || [])
        .map(name => `<li>${escapeHtml(name)}</li>`).join('');
      const skippedNames = result.skippedNames || [];
      const skipped = $('notificationSkipped');
      skipped.textContent = skippedNames.length
        ? `未列入：${skippedNames.join('、')}（未啟用通知、尚未綁定 LINE，或身分不符）`
        : '';
      skipped.hidden = skippedNames.length === 0;
      text('notificationEstimate', `共 ${result.recipientCount || 0} 人，預估使用 ${result.estimatedMessages || 0} 則 LINE 主動訊息額度`);
      $('notificationDialogError').textContent = '';
      if (typeof notificationDialog.showModal === 'function') notificationDialog.showModal();
      else notificationDialog.setAttribute('open', '');
    } catch (error) {
      showAlert('無法準備提醒：' + (error && error.message ? error.message : error));
    } finally {
      setActionButtonBusy(button, false);
    }
  }

  async function sendDashboardNotification() {
    if (!state.pendingNotification || state.actionLoading) return;
    const submit = $('notificationConfirmButton');
    state.actionLoading = true;
    submit.disabled = true;
    $('notificationCancelButton').disabled = true;
    submit.textContent = '發送中';
    $('notificationDialogError').textContent = '';
    try {
      const result = await window.API.adminDashboardAction(state.adminSessionToken, {
        mode: 'sendNotification',
        recordType: state.pendingNotification.recordType,
        recordId: state.pendingNotification.recordId,
        requestId: state.pendingNotification.requestId,
      });
      if (!result || result.ok !== true) {
        // 後端已記住成功收件人；新請求編號才能只重試未送達對象。
        if (result) rotateNotificationRequestId_(state.pendingNotification);
        const sent = result && result.sentNames && result.sentNames.length
          ? `已送出：${result.sentNames.join('、')}。`
          : '';
        const alreadySent = result && result.alreadySentNames && result.alreadySentNames.length
          ? `之前已送出：${result.alreadySentNames.join('、')}。`
          : '';
        const failed = result && result.failedNames && result.failedNames.length
          ? `失敗：${result.failedNames.join('、')}。`
          : '';
        throw new Error(`${sent}${alreadySent}${failed}${(result && result.error) || '提醒未能完整送出，可再按一次只重試未送達對象。'}`);
      }
      const names = (result.sentNames || []).join('、') || '相關人員';
      clearNotificationRequestId_(state.pendingNotification);
      if (notificationDialog.open) notificationDialog.close();
      state.pendingNotification = null;
      showAlert(`已發送給 ${names}；本次使用 ${result.estimatedMessages || 0} 則 LINE 主動訊息額度。`, { sticky: true });
    } catch (error) {
      $('notificationDialogError').textContent = error && error.message ? error.message : String(error);
    } finally {
      state.actionLoading = false;
      submit.disabled = false;
      $('notificationCancelButton').disabled = false;
      submit.textContent = '確認發送';
    }
  }

  function notificationRequestKey_(recordType, recordId) {
    return `${String(recordType || '')}:${String(recordId || '')}`;
  }

  function notificationRequestId_(recordType, recordId) {
    const key = notificationRequestKey_(recordType, recordId);
    const current = state.notificationRequests[key];
    if (current && Date.now() - current.createdAt < 9 * 60 * 1000) return current.id;
    const next = { id: createRequestId(), createdAt: Date.now() };
    state.notificationRequests[key] = next;
    return next.id;
  }

  function rotateNotificationRequestId_(pending) {
    if (!pending) return;
    const key = notificationRequestKey_(pending.recordType, pending.recordId);
    const next = { id: createRequestId(), createdAt: Date.now() };
    state.notificationRequests[key] = next;
    pending.requestId = next.id;
  }

  function clearNotificationRequestId_(pending) {
    if (!pending) return;
    delete state.notificationRequests[notificationRequestKey_(pending.recordType, pending.recordId)];
  }

  function createRequestId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
  }

  function setActionButtonBusy(button, busy, busyLabel) {
    if (!button) return;
    if (busy) {
      state.actionLoading = true;
      button.dataset.originalLabel = button.textContent;
      button.textContent = busyLabel || '處理中';
      button.disabled = true;
    } else {
      state.actionLoading = false;
      button.textContent = button.dataset.originalLabel || button.textContent;
      button.disabled = false;
      delete button.dataset.originalLabel;
    }
  }

  function renderNotifications(section, documents) {
    if (!section || !section.available) {
      text('notificationTime', '來源無法取得');
      text('quotaUsage', '--');
      text('lineCaption', 'LINE 額度無法取得');
      $('quotaProgress').value = 0;
      $('recipientCounts').innerHTML = '<p class="empty">通知對象統計無法取得</p>';
    } else {
      text('notificationTime', '來源 ' + section.capturedAt);
      const quota = section.lineQuota || {};
      text('quotaUsage', unavailable(quota.used) + ' / ' + unavailable(quota.limit));
      text('lineCaption', quota.available ? ('已使用 ' + unavailable(quota.used)) : 'LINE 額度無法取得');
      const percent = quota.limit > 0 && quota.used != null ? Math.min(100, Math.round(quota.used / quota.limit * 100)) : 0;
      $('quotaProgress').value = percent;
      const counts = section.targetCounts || {};
      $('recipientCounts').innerHTML = Object.keys(counts).length
        ? Object.keys(counts).map(label => `<div class="metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(counts[label])}</strong></div>`).join('')
        : '<p class="empty">沒有通知對象統計</p>';
    }

    if (documents && documents.available) {
      text('documentSlot', [documents.snapshotDate, documents.slot].filter(Boolean).join(' ') || '尚無快照');
      text('documentCount', (documents.count || 0) + ' 件');
      $('documentHandlers').innerHTML = (documents.byHandler || []).map(row => `<span>${escapeHtml(row.name)} ${escapeHtml(row.count)} 件</span>`).join('');
    } else {
      text('documentSlot', '來源無法取得');
      text('documentCount', '--');
    }
  }

  function renderSystem(section) {
    if (!section || !section.available) {
      $('healthRows').innerHTML = '<p class="empty">系統健康資料無法取得</p>';
      return;
    }
    text('systemTime', '來源 ' + section.capturedAt);
    const items = [
      { label: '歸檔資料夾', ok: section.archiveOk, value: section.archiveOk ? '可存取' : '異常' },
      { label: '場地資料來源', ok: section.venueOk, value: section.venueOk ? (section.venueTitle || '可存取') : '異常' },
    ].concat((section.triggers || []).map(row => ({ label: row.handler, ok: row.ok, value: row.count + ' 個觸發器' })));
    $('healthRows').innerHTML = items.map(row => `<div class="health-item"><span>${escapeHtml(row.label)}</span><strong class="status ${row.ok ? 'completed' : 'critical'}">${escapeHtml(row.value)}</strong></div>`).join('');
    setResourceLink('databaseLink', section.links && section.links.database);
    setResourceLink('archiveLink', section.links && section.links.archive);
  }

  function setResourceLink(id, href) {
    const link = $(id);
    if (href && /^https:\/\//.test(href)) { link.href = href; link.hidden = false; }
    else { link.removeAttribute('href'); link.hidden = true; }
  }

  function renderUnavailable(tbodyId, columns) {
    $(tbodyId).innerHTML = `<tr><td colspan="${columns}" class="empty">此資料來源暫時無法取得</td></tr>`;
  }
  function renderQueueUnavailable(id) { $(id).innerHTML = '<p class="empty">此資料來源暫時無法取得</p>'; }
  function showAlert(message, options) {
    if (state.alertTimer) window.clearTimeout(state.alertTimer);
    state.alertTimer = null;
    state.stickyAlert = !!(options && options.sticky);
    const alertBar = $('alertBar');
    alertBar.textContent = message;
    alertBar.hidden = false;
    if (state.stickyAlert) {
      state.alertTimer = window.setTimeout(() => {
        state.stickyAlert = false;
        state.alertTimer = null;
        if (alertBar.textContent === message) alertBar.hidden = true;
      }, 60000);
    }
  }
  function openDialog() {
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    window.setTimeout(() => $('adminPassword').focus(), 0);
  }

  function syncNavigation(hash, options) {
    options = options || {};
    const normalized = /^#[a-z-]+$/i.test(String(hash || '')) ? hash : '#overview';
    const target = document.querySelector(normalized);
    if (!target) return;
    document.querySelectorAll('.side-nav a[href^="#"], .mobile-nav a[href^="#"]').forEach(link => {
      link.classList.toggle('active', link.getAttribute('href') === normalized);
      if (link.getAttribute('href') === normalized) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (options.scroll) {
      target.scrollIntoView({ behavior: options.instant ? 'auto' : 'smooth', block: 'start' });
    }
  }

  function clearDashboard() {
    ['lastUpdated', 'dailyCompleted', 'dailyRequired', 'monthlyPending', 'incidentOpen',
      'approvalPending', 'lineRemaining', 'monthlyCaption', 'checksTime', 'approvalsTime', 'incidentsTime',
      'notificationTime', 'systemTime', 'quotaUsage', 'documentSlot', 'documentCount']
      .forEach(id => text(id, '--'));
    $('checkRows').innerHTML = '<tr><td colspan="5" class="empty">請先解鎖面板</td></tr>';
    ['approvalRows', 'incidentRows', 'recipientCounts', 'healthRows'].forEach(id => {
      $(id).innerHTML = '<p class="empty">請先解鎖面板</p>';
    });
    $('documentHandlers').innerHTML = '';
    $('quotaProgress').value = 0;
    $('alertBar').hidden = true;
    state.stickyAlert = false;
    $('overallHealth').className = 'health-badge neutral';
    $('overallHealth').innerHTML = '<span></span>尚未連線';
    setResourceLink('databaseLink', '');
    setResourceLink('archiveLink', '');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const password = $('adminPassword').value;
    if (!password || state.loading) return;
    state.loading = true;
    $('unlockError').textContent = '';
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = '驗證中';
    window.API.adminDashboardLogin(password).then(login => {
      $('adminPassword').value = '';
      if (!login || login.ok !== true || !login.adminSessionToken) {
        throw new Error((login && login.error) || '登入失敗');
      }
      state.loading = false;
      return loadDashboard(login.adminSessionToken, { initial: true });
    }).catch(error => {
      state.loading = false;
      state.adminSessionToken = '';
      $('adminPassword').value = '';
      const loginErrorMessage = String((error && error.message) || '');
      $('unlockError').textContent = /未授權|密碼/.test(loginErrorMessage)
        ? '中控台登入密碼不正確或嘗試過多'
        : '目前無法連線，請稍後再試';
      openDialog();
    }).finally(() => {
      submit.disabled = false;
      submit.textContent = '驗證並載入';
    });
  });
  $('refreshButton').addEventListener('click', () => {
    const sessionToken = state.adminSessionToken;
    if (sessionToken) loadDashboard(sessionToken, { forceRefresh: true }); else openDialog();
  });
  $('lockButton').addEventListener('click', () => {
    state.adminSessionToken = '';
    state.data = null;
    if (state.timer) window.clearTimeout(state.timer);
    $('adminPassword').value = '';
    clearDashboard();
    state.pendingNotification = null;
    state.notificationRequests = {};
    if (notificationDialog.open) notificationDialog.close();
    openDialog();
  });
  dialog.addEventListener('cancel', event => {
    if (!state.adminSessionToken) event.preventDefault();
  });
  notificationForm.addEventListener('submit', event => {
    event.preventDefault();
    sendDashboardNotification();
  });
  $('notificationCancelButton').addEventListener('click', () => {
    if (state.actionLoading) return;
    state.pendingNotification = null;
    if (notificationDialog.open) notificationDialog.close();
  });
  notificationDialog.addEventListener('cancel', event => {
    if (state.actionLoading) {
      event.preventDefault();
      return;
    }
    state.pendingNotification = null;
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-dashboard-action]');
    if (!button) return;
    if (button.dataset.dashboardAction === 'open-link') openDashboardLink(button);
    if (button.dataset.dashboardAction === 'preview-notification') previewDashboardNotification(button);
  });
  document.querySelectorAll('[data-incident-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.incidentTab = button.dataset.incidentTab;
      document.querySelectorAll('[data-incident-tab]').forEach(item => item.classList.toggle('active', item === button));
      renderIncidentTab();
    });
  });
  document.querySelectorAll('.side-nav a[href^="#"], .mobile-nav a[href^="#"]').forEach(link => {
    link.addEventListener('click', event => {
      const hash = link.getAttribute('href');
      if (!hash || !document.querySelector(hash)) return;
      event.preventDefault();
      window.history.replaceState(null, '', hash);
      syncNavigation(hash, { scroll: true });
    });
  });
  const observedSections = Array.from(document.querySelectorAll('main section[id]'));
  if ('IntersectionObserver' in window) {
    const navObserver = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) syncNavigation('#' + visible.target.id);
    }, { rootMargin: '-18% 0px -68% 0px', threshold: [0, 0.2, 0.6] });
    observedSections.forEach(section => navObserver.observe(section));
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const sessionToken = state.adminSessionToken;
      if (sessionToken) loadDashboard(sessionToken);
    }
  });

  openDialog();
})();
