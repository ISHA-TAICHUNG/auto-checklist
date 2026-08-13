(function () {
  'use strict';

  if (window.top !== window.self) {
    try { window.top.location = window.self.location; } catch (_) {}
    return;
  }

  const state = { data: null, incidentTab: 'machine', timer: null, loading: false, adminToken: '' };
  const $ = id => document.getElementById(id);
  const dialog = $('unlockDialog');
  const form = $('unlockForm');

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

  async function loadDashboard(token, opts) {
    opts = opts || {};
    if (state.loading) return;
    state.loading = true;
    $('refreshButton').disabled = true;
    $('refreshButton').textContent = '載入中';
    try {
      const result = await window.API.adminDashboardStatus(token);
      if (!result || result.ok !== true) throw new Error((result && result.error) || '無法載入面板');
      state.adminToken = token;
      $('adminToken').value = '';
      state.data = result;
      render(result);
      if (dialog.open) dialog.close();
      $('unlockError').textContent = '';
      scheduleRefresh(result.refreshAfterSeconds || 60);
    } catch (error) {
      if (opts.initial || /未授權/.test(String(error && error.message))) {
        state.adminToken = '';
        $('unlockError').textContent = /未授權/.test(String(error && error.message))
          ? '管理存取密鑰不正確'
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
      const token = state.adminToken;
      if (token && !document.hidden) loadDashboard(token);
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
    else $('alertBar').hidden = true;
  }

  function renderHeader(data) {
    text('lastUpdated', data.generatedAtLabel + (data.cached ? '（快取）' : ''));
    const badge = $('overallHealth');
    badge.className = 'health-badge ' + ((data.overall && data.overall.level) || 'neutral');
    badge.innerHTML = '<span></span>' + escapeHtml((data.overall && data.overall.label) || '狀態未知');
  }

  function renderSummary(summary) {
    text('dailyCompleted', unavailable(summary.dailyCompleted));
    text('dailyRequired', ' / ' + unavailable(summary.dailyRequired));
    text('dailyCaption', summary.dailyRequired === 0 ? '今日無需檢點' : '依場地使用狀態判定');
    text('monthlyPending', unavailable(summary.monthlyPending));
    text('monthlyCaption', summary.monthlyVisible === false ? '目前非月檢顯示期間' : '尚待完成');
    text('incidentOpen', unavailable(summary.incidentOpen));
    text('approvalPending', unavailable(summary.approvalPending));
    text('lineRemaining', unavailable(summary.lineRemaining));
  }

  function renderChecks(section) {
    if (!section || !section.available) return renderUnavailable('checkRows', 4);
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
        <td>${escapeHtml(row.usage || (row.cycle === '每月' ? '本月進度' : '無使用紀錄'))}</td>
      </tr>`).join('') : '<tr><td colspan="4" class="empty">目前沒有檢點項目</td></tr>';
  }

  function renderApprovals(section) {
    if (!section || !section.available) return renderQueueUnavailable('approvalRows');
    text('approvalsTime', '來源 ' + section.capturedAt);
    const rows = section.items || [];
    $('approvalRows').innerHTML = rows.length ? rows.map(row => `
      <article class="queue-item">
        <div><strong>${escapeHtml(row.equipmentName || row.category || '未命名設備')}</strong>
          <p>${escapeHtml(row.formType || '')} · ${escapeHtml(row.inspector || '未標示檢查人')} · ${escapeHtml(row.checkDate || '')}</p></div>
        <span class="tag ${Number(row.ageHours || 0) >= 24 ? 'critical' : 'warning'}">${row.ageHours == null ? '待簽核' : escapeHtml(row.ageHours + ' 小時')}</span>
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
      return `<article class="queue-item"><div><strong>${escapeHtml(title || '未命名事件')}</strong><p>${escapeHtml(subtitle)}</p></div><span class="tag warning">${escapeHtml(tag || '待處理')}</span></article>`;
    }).join('') : '<p class="empty">目前沒有未結案件</p>';
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
    setResourceLink('archiveLink', section.links && section.links.archive);
  }

  function setResourceLink(id, href) {
    const link = $(id);
    if (href && /^https:\/\//.test(href)) { link.href = href; link.hidden = false; }
    else { link.hidden = true; }
  }

  function renderUnavailable(tbodyId, columns) {
    $(tbodyId).innerHTML = `<tr><td colspan="${columns}" class="empty">此資料來源暫時無法取得</td></tr>`;
  }
  function renderQueueUnavailable(id) { $(id).innerHTML = '<p class="empty">此資料來源暫時無法取得</p>'; }
  function showAlert(message) { $('alertBar').textContent = message; $('alertBar').hidden = false; }
  function openDialog() {
    if (!dialog.open) {
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    }
    window.setTimeout(() => $('adminToken').focus(), 0);
  }

  function clearDashboard() {
    ['lastUpdated', 'dailyCompleted', 'dailyRequired', 'monthlyPending', 'incidentOpen',
      'approvalPending', 'lineRemaining', 'monthlyCaption', 'checksTime', 'approvalsTime', 'incidentsTime',
      'notificationTime', 'systemTime', 'quotaUsage', 'documentSlot', 'documentCount']
      .forEach(id => text(id, '--'));
    $('checkRows').innerHTML = '<tr><td colspan="4" class="empty">請先解鎖面板</td></tr>';
    ['approvalRows', 'incidentRows', 'recipientCounts', 'healthRows'].forEach(id => {
      $(id).innerHTML = '<p class="empty">請先解鎖面板</p>';
    });
    $('documentHandlers').innerHTML = '';
    $('quotaProgress').value = 0;
    $('alertBar').hidden = true;
    $('overallHealth').className = 'health-badge neutral';
    $('overallHealth').innerHTML = '<span></span>尚未連線';
    setResourceLink('archiveLink', '');
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const token = $('adminToken').value.trim();
    if (token) loadDashboard(token, { initial: true });
  });
  $('refreshButton').addEventListener('click', () => {
    const token = state.adminToken;
    if (token) loadDashboard(token); else openDialog();
  });
  $('lockButton').addEventListener('click', () => {
    state.adminToken = '';
    state.data = null;
    if (state.timer) window.clearTimeout(state.timer);
    $('adminToken').value = '';
    clearDashboard();
    openDialog();
  });
  dialog.addEventListener('cancel', event => {
    if (!state.adminToken) event.preventDefault();
  });
  document.querySelectorAll('[data-incident-tab]').forEach(button => {
    button.addEventListener('click', () => {
      state.incidentTab = button.dataset.incidentTab;
      document.querySelectorAll('[data-incident-tab]').forEach(item => item.classList.toggle('active', item === button));
      renderIncidentTab();
    });
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      const token = state.adminToken;
      if (token) loadDashboard(token);
    }
  });

  openDialog();
})();
