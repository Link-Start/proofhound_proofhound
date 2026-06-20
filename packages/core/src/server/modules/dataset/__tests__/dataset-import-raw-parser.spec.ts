import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import type { DatasetImportSourceFormat } from '@proofhound/shared';
import { parseRawDatasetRows } from '../dataset-import-raw-parser';

async function collectRows(
  chunks: Array<Buffer | string>,
  sourceFormat: DatasetImportSourceFormat,
  options?: { maxLineBytes?: number; maxBufferedBytes?: number },
) {
  const rows: Array<Record<string, unknown>> = [];
  for await (const row of parseRawDatasetRows(Readable.from(chunks), sourceFormat, options)) {
    rows.push(row);
  }
  return rows;
}

function buildStoredZip(entries: Array<{ path: string; data: Buffer | string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(data.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(name.byteLength, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(data.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(name.byteLength, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.byteLength + name.byteLength + data.byteLength;
  }

  const localPayload = Buffer.concat(localParts);
  const centralPayload = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPayload.byteLength, 12);
  eocd.writeUInt32LE(localPayload.byteLength, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([localPayload, centralPayload, eocd]);
}

describe('parseRawDatasetRows', () => {
  it('rejects JSONL rows over the configured line byte limit', async () => {
    await expect(collectRows(['{"text":"abcdef"}\n'], 'jsonl', { maxLineBytes: 8 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });

  it('keeps UTF-8 characters intact when JSONL chunks split a multibyte boundary', async () => {
    const encoded = Buffer.from('{"text":"split 😀 boundary"}\n', 'utf8');
    const emojiStart = encoded.indexOf(Buffer.from('😀', 'utf8'));

    const rows = await collectRows(
      [
        encoded.subarray(0, emojiStart + 1),
        encoded.subarray(emojiStart + 1, emojiStart + 3),
        encoded.subarray(emojiStart + 3),
      ],
      'jsonl',
    );

    expect(rows).toEqual([{ text: 'split 😀 boundary' }]);
  });

  it('parses CSV quoted commas, quoted newlines, and escaped quotes', async () => {
    const rows = await collectRows(
      [['sample_id,text,expected_output', 'case-1,"hello, ""world""', 'with newline",positive'].join('\n')],
      'csv',
    );

    expect(rows).toEqual([
      {
        sample_id: 'case-1',
        text: 'hello, "world"\nwith newline',
        expected_output: 'positive',
      },
    ]);
  });

  it('parses TSV rows and recognizes valid JSON array cells', async () => {
    const rows = await collectRows(
      [
        'sample_id\timage_urls\texpected_output\ncase-1\t["https://example.test/a,b.png","data:image/png;base64,AAAA"]\tpass\n',
      ],
      'tsv',
    );

    expect(rows).toEqual([
      {
        sample_id: 'case-1',
        image_urls: ['https://example.test/a,b.png', 'data:image/png;base64,AAAA'],
        expected_output: 'pass',
      },
    ]);
  });

  it('rejects CSV rows over the configured parser byte guard', async () => {
    await expect(collectRows([`id,text\n1,${'x'.repeat(32)}\n`], 'csv', { maxLineBytes: 12 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });

  it('rejects TSV rows over the configured parser byte guard', async () => {
    await expect(collectRows([`id\ttext\n1\t${'x'.repeat(32)}\n`], 'tsv', { maxLineBytes: 12 })).rejects.toThrow(
      'dataset_import_line_too_large',
    );
  });

  it('parses bounded JSON array files on the backend', async () => {
    await expect(collectRows(['[{"id":"a","text":"hello"},{"id":"b","text":"world"}]'], 'json')).resolves.toEqual([
      { id: 'a', text: 'hello' },
      { id: 'b', text: 'world' },
    ]);
  });

  it('rejects JSON array files over the configured buffered parser limit', async () => {
    await expect(collectRows(['[{"text":"', 'x'.repeat(64), '"}]'], 'json', { maxBufferedBytes: 32 })).rejects.toThrow(
      'dataset_import_file_too_large_for_buffered_parser',
    );
  });

  it('parses ZIP manifest data and inlines relative image references', async () => {
    const zip = buildStoredZip([
      { path: 'manifest.json', data: JSON.stringify({ file: 'data.csv' }) },
      { path: 'data.csv', data: 'sample_id,image,expected_output\ncase-1,images/a.png,pass\n' },
      { path: 'images/a.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ]);

    const rows = await collectRows([zip], 'zip');

    expect(rows).toEqual([
      {
        sample_id: 'case-1',
        image: 'data:image/png;base64,iVBORw==',
        expected_output: 'pass',
      },
    ]);
  });
});
