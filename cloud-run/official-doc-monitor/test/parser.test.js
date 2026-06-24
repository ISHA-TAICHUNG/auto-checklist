import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDispatchRowsFromHtml, parseHandler } from '../src/parser.js';

test('parseHandler extracts name and unit', () => {
  assert.deepEqual(parseHandler('張家豪(台中職訓中心)'), {
    name: '張家豪',
    unit: '台中職訓中心',
  });
});

test('parseDispatchRowsFromHtml parses Vital OD wait-for-publish table', async () => {
  const html = await readFile(new URL('../fixtures/wait-for-publish.html', import.meta.url), 'utf8');
  const records = parseDispatchRowsFromHtml(html);
  assert.equal(records.length, 2);
  assert.equal(records[0].outboundNo, '115D000001 (線)');
  assert.equal(records[0].documentNo, '測試公文001');
  assert.equal(records[0].handlerName, '張家豪');
  assert.equal(records[0].unit, '台中職訓中心');
  assert.ok(records[0].documentKey);
});

test('parseDispatchRowsFromHtml skips empty matching table when a later table has rows', () => {
  const html = `
    <table><tr><th>公文文號</th><th>發文字號</th><th>承辦人員</th></tr></table>
    <table>
      <tr><th>公文文號</th><th>發文字號</th><th>承辦人員</th><th>限辦日期</th></tr>
      <tr><td>A001</td><td>115D000003</td><td>張家豪(台中職訓中心)</td><td>115/07/03</td></tr>
    </table>
  `;
  const records = parseDispatchRowsFromHtml(html);
  assert.equal(records.length, 1);
  assert.equal(records[0].documentNo, 'A001');
});

test('parseDispatchRowsFromHtml returns empty list for a real empty dispatch table', () => {
  const html = '<table><tr><th>公文文號</th><th>發文字號</th><th>承辦人員</th></tr></table>';
  assert.deepEqual(parseDispatchRowsFromHtml(html), []);
});
