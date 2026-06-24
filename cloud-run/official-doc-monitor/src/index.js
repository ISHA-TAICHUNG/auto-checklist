import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { loadConfig, validateConfig } from './config.js';
import { parseDispatchRowsFromHtml } from './parser.js';
import { scrapeVitalOdDispatches } from './official-doc-client.js';
import { sendToAppsScript } from './apps-script-client.js';
import { logger } from './logger.js';
import { redactError } from './redact.js';

async function collectRecords(config) {
  if (config.mockHtmlPath) {
    const html = await readFile(config.mockHtmlPath, 'utf8');
    logger.info('using mock html fixture', { file: basename(config.mockHtmlPath) });
    return parseDispatchRowsFromHtml(html, { maxRecords: config.maxRecords });
  }
  return scrapeVitalOdDispatches(config);
}

async function main() {
  const startedAt = new Date().toISOString();
  const batchId = `vital-od-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const config = await loadConfig();
  validateConfig(config);

  logger.info('official document monitor started', {
    batchId,
    date: config.date,
    slot: config.slot,
    dryRun: config.dryRun,
    notify: config.notify,
    mock: Boolean(config.mockHtmlPath),
  });

  let records = [];
  let status = 'ok';
  let errorSummary = '';
  let scrapeError = null;
  try {
    records = await collectRecords(config);
    if (records.length === 0) status = 'ok_empty';
  } catch (err) {
    scrapeError = err;
    status = 'failed';
    errorSummary = redactError(err).slice(0, 500);
    logger.error('official document monitor scrape failed', err);
  } finally {
    const finishedAt = new Date().toISOString();
    const payload = {
      batchId,
      date: config.date,
      slot: config.slot,
      startedAt,
      finishedAt,
      status,
      dryRun: config.dryRun,
      notify: config.notify,
      errorSummary,
      records,
    };
    try {
      const result = await sendToAppsScript(config, payload);
      logger.info('official document monitor finished', {
        batchId,
        fetchedCount: records.length,
        appsScript: result,
      });
    } catch (err) {
      logger.error('official document monitor Apps Script report failed', err);
      if (!scrapeError) throw err;
    }
  }
  if (scrapeError) throw scrapeError;
}

main().catch(err => {
  logger.error('official document monitor fatal error', err);
  process.exitCode = 1;
});
