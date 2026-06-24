import { createHash } from 'node:crypto';

const HEADER_ALIASES = {
  outboundNo: ['發文字號'],
  documentNo: ['公文文號', '文號'],
  subject: ['主旨'],
  unit: ['承辦單位'],
  handler: ['承辦人員', '承辦人'],
  dueDate: ['限辦日期', '期限'],
};

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function decodeHtml(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html) {
  return cleanText(decodeHtml(String(html || '').replace(/<[^>]*>/g, ' ')));
}

function headerIndex(headers, aliases) {
  for (const alias of aliases) {
    const found = headers.findIndex(h => h.includes(alias));
    if (found >= 0) return found;
  }
  return -1;
}

export function parseHandler(raw) {
  const text = cleanText(raw);
  const match = text.match(/^(.+?)\s*[（(]\s*(.+?)\s*[）)]\s*$/);
  if (!match) return { name: text, unit: '' };
  return { name: cleanText(match[1]), unit: cleanText(match[2]) };
}

export function buildDocumentKey(record) {
  const base = [
    record.documentNo,
    record.outboundNo,
    record.handlerName,
    record.dueDate,
  ].map(cleanText).join('|');
  return createHash('sha256').update(base).digest('hex').slice(0, 32);
}

export function parseDispatchRowsFromTableMatrix(matrix, opts = {}) {
  const rows = matrix.map(row => row.map(cleanText)).filter(row => row.some(Boolean));
  const headerRowIndex = rows.findIndex(row =>
    row.some(cell => cell.includes('承辦人')) &&
    row.some(cell => cell.includes('公文文號') || cell.includes('發文字號'))
  );
  if (headerRowIndex < 0) {
    throw new Error('PARSE_HEADERS_MISSING: cannot locate Vital OD wait-for-publish table headers');
  }

  const headers = rows[headerRowIndex];
  const col = {
    outboundNo: headerIndex(headers, HEADER_ALIASES.outboundNo),
    documentNo: headerIndex(headers, HEADER_ALIASES.documentNo),
    unit: headerIndex(headers, HEADER_ALIASES.unit),
    handler: headerIndex(headers, HEADER_ALIASES.handler),
    dueDate: headerIndex(headers, HEADER_ALIASES.dueDate),
  };
  if (col.handler < 0 || (col.documentNo < 0 && col.outboundNo < 0)) {
    throw new Error('PARSE_REQUIRED_COLUMNS_MISSING: handler and document number columns are required');
  }

  const maxRecords = Number(opts.maxRecords || 50);
  const parsed = [];
  for (const row of rows.slice(headerRowIndex + 1)) {
    const handlerRaw = cleanText(row[col.handler] || '');
    const parsedHandler = parseHandler(handlerRaw);
    const record = {
      outboundNo: col.outboundNo >= 0 ? cleanText(row[col.outboundNo] || '') : '',
      documentNo: col.documentNo >= 0 ? cleanText(row[col.documentNo] || '') : '',
      handler: handlerRaw,
      handlerName: parsedHandler.name,
      unit: col.unit >= 0 ? cleanText(row[col.unit] || '') : parsedHandler.unit,
      dueDate: col.dueDate >= 0 ? cleanText(row[col.dueDate] || '') : '',
    };
    if (!record.handlerName || (!record.documentNo && !record.outboundNo)) continue;
    record.documentKey = buildDocumentKey(record);
    parsed.push(record);
    if (parsed.length >= maxRecords) break;
  }
  return parsed;
}

export function parseDispatchRowsFromHtml(html, opts = {}) {
  const tableMatches = String(html || '').match(/<table[\s\S]*?<\/table>/gi) || [];
  const matrices = tableMatches.map(tableHtml => {
    const rowMatches = tableHtml.match(/<tr[\s\S]*?<\/tr>/gi) || [];
    return rowMatches.map(rowHtml => {
      const cellMatches = rowHtml.match(/<t[hd][\s\S]*?<\/t[hd]>/gi) || [];
      return cellMatches.map(stripTags);
    });
  });
  let sawEmptyDispatchTable = false;
  for (const matrix of matrices) {
    try {
      const records = parseDispatchRowsFromTableMatrix(matrix, opts);
      if (records.length > 0) return records;
      sawEmptyDispatchTable = true;
    } catch (err) {
      if (!String(err.message || '').startsWith('PARSE_HEADERS_MISSING')) throw err;
    }
  }
  if (sawEmptyDispatchTable) return [];
  throw new Error('PARSE_HEADERS_MISSING: no wait-for-publish table found in HTML');
}
