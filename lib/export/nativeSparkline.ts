/**
 * WordGod — native Excel in-cell sparkline injection.
 *
 * ExcelJS (4.4) has no API for sparklines, so we post-process the finished xlsx
 * zip and inject the Excel-2010 `x14:sparklineGroups` extension into the target
 * worksheet's XML. This draws the KP-style mini line chart directly inside a
 * cell (referencing a data range on another sheet).
 *
 * Pure buffer→buffer. No network. Designed to be fail-safe at the call site:
 * if anything here throws, the caller keeps the original workbook (which still
 * carries the text sparkline + raw monthly columns).
 */

import JSZip from 'jszip';

export interface SparklineEntry {
  /** Target cell in A1 notation on the sheet, e.g. "AE5". */
  location: string;
  /** Source data range including sheet name, e.g. "'KP Monthly'!C5:N5". */
  dataRange: string;
}

export interface SparklineInjection {
  sheetName: string;
  sparklines: SparklineEntry[];
}

// Standard OOXML extension URI for sparklines.
const SPARK_EXT_URI = '{05C60535-1F16-4fd2-B633-F4F36F0B64E0}';

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Build the `<ext>` block holding a single line-sparkline group. */
export function buildSparklineExtXml(entries: SparklineEntry[]): string {
  const items = entries
    .map(
      (e) =>
        `<x14:sparkline><xm:f>${xmlEscape(e.dataRange)}</xm:f>` +
        `<xm:sqref>${xmlEscape(e.location)}</xm:sqref></x14:sparkline>`,
    )
    .join('');
  return (
    `<ext xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main" uri="${SPARK_EXT_URI}">` +
    `<x14:sparklineGroups xmlns:xm="http://schemas.microsoft.com/office/excel/2006/main">` +
    `<x14:sparklineGroup displayEmptyCellsAs="gap">` +
    `<x14:colorSeries theme="4" tint="-0.499984740745262"/>` +
    `<x14:colorNegative theme="5"/>` +
    `<x14:colorAxis rgb="FF000000"/>` +
    `<x14:colorMarkers theme="4" tint="-0.499984740745262"/>` +
    `<x14:colorFirst theme="4" tint="0.39997558519241921"/>` +
    `<x14:colorLast theme="4" tint="0.39997558519241921"/>` +
    `<x14:colorHigh theme="4"/>` +
    `<x14:colorLow theme="4"/>` +
    `<x14:sparklines>${items}</x14:sparklines>` +
    `</x14:sparklineGroup>` +
    `</x14:sparklineGroups>` +
    `</ext>`
  );
}

/** Map a worksheet display name to its `xl/worksheets/sheetN.xml` path. */
function resolveWorksheetPath(
  workbookXml: string,
  relsXml: string,
  sheetName: string,
): string | null {
  const sheetRe = new RegExp(`<sheet\\b[^>]*\\bname="${escapeRegExp(xmlEscape(sheetName))}"[^>]*/>`, 'i');
  const sheetMatch = workbookXml.match(sheetRe);
  if (!sheetMatch) return null;
  const ridMatch = sheetMatch[0].match(/r:id="([^"]+)"/);
  if (!ridMatch) return null;

  const relRe = new RegExp(`<Relationship\\b[^>]*\\bId="${escapeRegExp(ridMatch[1])}"[^>]*/>`, 'i');
  const relMatch = relsXml.match(relRe);
  if (!relMatch) return null;
  const targetMatch = relMatch[0].match(/Target="([^"]+)"/);
  if (!targetMatch) return null;

  const target = targetMatch[1];
  if (target.startsWith('/')) return target.replace(/^\//, '');
  return `xl/${target}`;
}

/** Place the ext block as the worksheet's extLst (append if one already exists). */
function injectIntoWorksheet(worksheetXml: string, extXml: string): string {
  if (worksheetXml.includes('<extLst>')) {
    return worksheetXml.replace('</extLst>', `${extXml}</extLst>`);
  }
  if (/<\/worksheet>\s*$/.test(worksheetXml)) {
    return worksheetXml.replace(/<\/worksheet>\s*$/, `<extLst>${extXml}</extLst></worksheet>`);
  }
  // Self-closing <worksheet .../> (no children) — unlikely for a data sheet, but handle it.
  return worksheetXml.replace(/<worksheet\b([^>]*)\/>/, `<worksheet$1><extLst>${extXml}</extLst></worksheet>`);
}

/**
 * Inject native line sparklines into an existing xlsx buffer.
 * Throws on structural problems (unknown sheet, missing parts) so callers can
 * fall back to the un-injected workbook.
 */
export async function injectNativeSparklines(
  buffer: Buffer,
  injections: SparklineInjection[],
): Promise<Buffer> {
  const active = injections.filter((i) => i.sparklines.length > 0);
  if (active.length === 0) return buffer;

  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file('xl/workbook.xml')?.async('string');
  const relsXml = await zip.file('xl/_rels/workbook.xml.rels')?.async('string');
  if (!workbookXml || !relsXml) throw new Error('xl/workbook.xml or its rels not found');

  for (const inj of active) {
    const path = resolveWorksheetPath(workbookXml, relsXml, inj.sheetName);
    if (!path) throw new Error(`worksheet not found for sheet "${inj.sheetName}"`);
    const wsFile = zip.file(path);
    if (!wsFile) throw new Error(`worksheet file missing at ${path}`);
    const wsXml = await wsFile.async('string');
    const updated = injectIntoWorksheet(wsXml, buildSparklineExtXml(inj.sparklines));
    zip.file(path, updated);
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return out;
}
