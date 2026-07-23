/**
 * Tests for nativeSparkline — verifies the injected xlsx stays structurally
 * valid (re-openable by ExcelJS) and contains the sparkline XML.
 * Run: npx ts-node --project tsconfig.test.json lib/export/nativeSparkline.test.ts
 */
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {
  injectNativeSparklines,
  buildSparklineExtXml,
  type SparklineEntry,
} from './nativeSparkline';

let passed = 0;
function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`FAILED: ${msg}`);
  passed++;
  console.log(`  ✓ ${msg}`);
}

async function buildFixture(): Promise<Buffer> {
  // Mirror the real workbook: Keyword Master is NOT the first sheet (resolve by
  // name, not position), the sparkline target is column AE (31), and the data
  // lives on 'KP Monthly'!C:N — exactly what buildPlanWorkbook emits.
  const wb = new ExcelJS.Workbook();
  wb.addWorksheet('Overview').getCell('A1').value = 'overview';

  const master = wb.addWorksheet('Keyword Master');
  master.getRow(4).getCell(31).value = 'Trend Chart'; // column AE header
  master.getRow(5).getCell(31).value = '';
  master.getRow(6).getCell(31).value = '';

  const monthly = wb.addWorksheet('KP Monthly');
  monthly.getRow(4).values = ['No.', 'Keyword', 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  monthly.getRow(5).values = [1, 'good money', 100, 120, 90, 110, 130, 140, 150, 120, 100, 90, 110, 150];
  monthly.getRow(6).values = [2, 'money', 200, 210, 220, 190, 180, 170, 160, 150, 140, 130, 120, 110];

  const bytes = await wb.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

async function main(): Promise<void> {
  console.log('nativeSparkline');

  // ── buildSparklineExtXml ──────────────────────────────────────────────────
  console.log(' buildSparklineExtXml');
  const entries: SparklineEntry[] = [
    { location: 'AE5', dataRange: "'KP Monthly'!C5:N5" },
    { location: 'AE6', dataRange: "'KP Monthly'!C6:N6" },
  ];
  const ext = buildSparklineExtXml(entries);
  assert(ext.includes('<x14:sparklineGroups'), 'emits sparklineGroups element');
  assert(ext.includes("<xm:f>'KP Monthly'!C5:N5</xm:f>"), 'first data range present');
  assert(ext.includes('<xm:sqref>AE6</xm:sqref>'), 'second location present');
  assert((ext.match(/<x14:sparkline>/g) || []).length === 2, 'one sparkline per entry');

  // ── injectNativeSparklines: no-op when empty ──────────────────────────────
  console.log(' injectNativeSparklines');
  const fixture = await buildFixture();
  const noop = await injectNativeSparklines(fixture, [{ sheetName: 'Keyword Master', sparklines: [] }]);
  assert(noop === fixture, 'empty sparklines → original buffer returned unchanged');

  // ── injectNativeSparklines: real injection ────────────────────────────────
  const injected = await injectNativeSparklines(fixture, [
    { sheetName: 'Keyword Master', sparklines: entries },
  ]);
  assert(injected.length > 0, 'produces a non-empty buffer');
  assert(injected !== fixture, 'returns a new buffer when sparklines injected');

  // Structural validity: ExcelJS must re-open it without throwing.
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(injected as any);
  assert(!!reopened.getWorksheet('Keyword Master'), 're-opened workbook keeps Keyword Master sheet');
  assert(!!reopened.getWorksheet('KP Monthly'), 're-opened workbook keeps KP Monthly sheet');

  // The Keyword Master worksheet XML now contains the sparkline group.
  const zip = await JSZip.loadAsync(injected);
  const wbXml = await zip.file('xl/workbook.xml')!.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')!.async('string');
  const ridMatch = wbXml.match(/<sheet\b[^>]*name="Keyword Master"[^>]*r:id="([^"]+)"/);
  assert(!!ridMatch, 'workbook.xml lists the Keyword Master sheet with an r:id');
  const target = relsXml.match(new RegExp(`Id="${ridMatch![1]}"[^>]*Target="([^"]+)"`));
  assert(!!target, 'rels maps the sheet r:id to a worksheet file');
  const wsPath = `xl/${target![1].replace(/^\//, '')}`;
  const wsXml = await zip.file(wsPath)!.async('string');
  assert(wsXml.includes('<x14:sparklineGroup'), 'target worksheet XML carries the sparkline group');
  assert(wsXml.includes("<xm:f>'KP Monthly'!C5:N5</xm:f>"), 'target worksheet references KP Monthly data');
  assert(wsXml.trimEnd().endsWith('</worksheet>'), 'worksheet XML still closes correctly');

  // Unknown sheet must throw (so caller can fall back).
  let threw = false;
  try {
    await injectNativeSparklines(fixture, [{ sheetName: 'Nonexistent', sparklines: entries }]);
  } catch {
    threw = true;
  }
  assert(threw, 'unknown sheet name throws (enables caller fallback)');

  console.log(`\n✅ nativeSparkline: ${passed} assertions passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
