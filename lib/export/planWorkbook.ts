import 'server-only';

import ExcelJS from 'exceljs';
import type { PipelineResult } from '../pipeline/wordgodPipeline';
import { isDirectMetricSource } from '../pipeline/keywordMetricPolicy';
import { textSparkline, threeMonthChange, formatPercentChange } from '../pipeline/kpMetrics';
import { injectNativeSparklines, type SparklineInjection, type SparklineEntry } from './nativeSparkline';

const KP_MONTHLY_SHEET = 'KP Monthly';

/** True when a keyword carries a usable KP monthly series. */
function hasTrend(trend: number[] | undefined): trend is number[] {
  return Array.isArray(trend) && trend.filter((v) => typeof v === 'number' && isFinite(v)).length >= 2;
}

const BRAND_GREEN = '00B900';
const DARK_GREEN = '087A36';
const LIGHT_GREEN = 'EAF8EE';
const LIGHT_BLUE = 'EAF2FF';
const LIGHT_AMBER = 'FFF7DF';
const LIGHT_RED = 'FDECEC';
const BORDER = 'D9E2DC';
const TEXT = '183028';
const MUTED = '60756D';
const WHITE = 'FFFFFF';

function solid(color: string): ExcelJS.Fill {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
}

function thinBorder(): Partial<ExcelJS.Borders> {
  const side: Partial<ExcelJS.Border> = { style: 'thin', color: { argb: BORDER } };
  return { top: side, left: side, bottom: side, right: side };
}

function titleBand(sheet: ExcelJS.Worksheet, title: string, subtitle: string, lastColumn: number): void {
  sheet.mergeCells(1, 1, 1, lastColumn);
  sheet.getCell(1, 1).value = title;
  sheet.getCell(1, 1).font = { name: 'Aptos Display', size: 20, bold: true, color: { argb: WHITE } };
  sheet.getCell(1, 1).fill = solid(DARK_GREEN);
  sheet.getCell(1, 1).alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(1).height = 34;

  sheet.mergeCells(2, 1, 2, lastColumn);
  sheet.getCell(2, 1).value = subtitle;
  sheet.getCell(2, 1).font = { name: 'Aptos', size: 10, color: { argb: 'D9F4E2' } };
  sheet.getCell(2, 1).fill = solid(DARK_GREEN);
  sheet.getCell(2, 1).alignment = { vertical: 'middle', horizontal: 'left' };
  sheet.getRow(2).height = 22;
}

function styleHeader(row: ExcelJS.Row): void {
  row.height = 28;
  row.eachCell(cell => {
    cell.fill = solid(BRAND_GREEN);
    cell.font = { name: 'Aptos', size: 10, bold: true, color: { argb: WHITE } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = thinBorder();
  });
}

function styleDataRows(sheet: ExcelJS.Worksheet, startRow: number, endRow: number, numericColumns: number[] = []): void {
  for (let rowNumber = startRow; rowNumber <= endRow; rowNumber++) {
    const row = sheet.getRow(rowNumber);
    row.height = 24;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      cell.font = { name: 'Aptos', size: 10, color: { argb: TEXT } };
      cell.fill = solid(rowNumber % 2 === 0 ? WHITE : 'F8FBF9');
      cell.border = thinBorder();
      cell.alignment = {
        vertical: 'top',
        horizontal: numericColumns.includes(columnNumber) ? 'right' : 'left',
        wrapText: true,
      };
    });
  }
}

function configureSheet(sheet: ExcelJS.Worksheet, freezeRow = 4): void {
  sheet.views = [{ state: 'frozen', ySplit: freezeRow, showGridLines: false }];
  sheet.properties.defaultRowHeight = 22;
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function applyPriorityFormatting(sheet: ExcelJS.Worksheet, range: string): void {
  sheet.addConditionalFormatting({
    ref: range,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'P1', priority: 1, style: { fill: solid('DDF5E5'), font: { color: { argb: '087A36' }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'P2', priority: 2, style: { fill: solid(LIGHT_AMBER), font: { color: { argb: '9A6700' }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'P3', priority: 3, style: { fill: solid(LIGHT_RED), font: { color: { argb: 'B42318' }, bold: true } } },
    ],
  });
}

function buildOverview(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const plan = result.plan!;
  const sheet = workbook.addWorksheet('Overview');
  configureSheet(sheet, 4);
  titleBand(sheet, 'WordGod SEO Content Plan', `สร้างเมื่อ ${plan.summary.generatedAt} • ข้อมูลคีย์เวิร์ด ${plan.summary.keywordCount.toLocaleString()} รายการ`, 8);

  sheet.getCell('A4').value = 'การตั้งค่าแผน';
  sheet.getCell('A4').font = { bold: true, color: { argb: DARK_GREEN }, size: 12 };
  const settings = [
    ['โหมด', plan.config.mode === 'full_plan' ? 'Full SEO Content Plan' : 'Quick Keyword Research'],
    ['ธุรกิจ / Niche', plan.config.niche],
    ['เริ่มเดือน', plan.config.startMonth],
    ['ระยะเวลา', plan.config.months],
    ['บทความต่อเดือน', plan.config.articlesPerMonth],
    ['Metric Mode', result.meta.metric_mode === 'api_only' ? 'API เท่านั้น' : 'API + คำแนะนำ'],
    ['CPC Currency', 'THB (บังคับทั้งระบบ)'],
  ];
  settings.forEach((entry, index) => {
    const row = 5 + index;
    sheet.getCell(row, 1).value = entry[0];
    sheet.getCell(row, 2).value = entry[1];
    sheet.getCell(row, 1).font = { bold: true, color: { argb: MUTED } };
    sheet.getCell(row, 2).font = { color: { argb: TEXT } };
    sheet.getCell(row, 1).fill = solid(LIGHT_GREEN);
    sheet.getCell(row, 2).fill = solid(WHITE);
    sheet.getCell(row, 1).border = thinBorder();
    sheet.getCell(row, 2).border = thinBorder();
  });

  const keywordEnd = Math.max(result.keywords.length + 4, 5);
  const contentEnd = Math.max(plan.contentItems.length + 4, 5);
  const calendarEnd = Math.max(plan.calendar.length + 4, 5);
  const cards = [
    { range: 'D4:E6', label: 'คีย์เวิร์ดทั้งหมด', formula: `=COUNTA('Keyword Master'!$B$5:$B$${keywordEnd})`, result: result.keywords.length, fill: LIGHT_GREEN },
    { range: 'F4:G6', label: 'Volume API จริง', formula: `=COUNTIF('Keyword Master'!$V$5:$V$${keywordEnd},"high")`, result: result.meta.api_backed_count, fill: LIGHT_BLUE },
    { range: 'D8:E10', label: 'บทความใน Calendar', formula: `=COUNTA('12-Month Calendar'!$G$5:$G$${calendarEnd})`, result: plan.calendar.length, fill: LIGHT_AMBER },
    { range: 'F8:G10', label: 'Content Items', formula: `=COUNTA('Content Plan'!$B$5:$B$${contentEnd})`, result: plan.contentItems.length, fill: 'F2ECFF' },
  ];
  for (const card of cards) {
    sheet.mergeCells(card.range);
    const cell = sheet.getCell(card.range.split(':')[0]);
    cell.value = { formula: card.formula, result: card.result };
    cell.fill = solid(card.fill);
    cell.border = thinBorder();
    cell.font = { size: 24, bold: true, color: { argb: DARK_GREEN } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    const start = card.range.split(':')[0];
    const startCell = sheet.getCell(start);
    const columnNumber = startCell.fullAddress.col;
    const column = sheet.getColumn(columnNumber).letter;
    const row = startCell.fullAddress.row + 3;
    sheet.mergeCells(`${column}${row}:${sheet.getColumn(columnNumber + 1).letter}${row}`);
    const labelCell = sheet.getCell(`${column}${row}`);
    labelCell.value = card.label;
    labelCell.font = { bold: true, color: { argb: MUTED } };
    labelCell.alignment = { horizontal: 'center' };
  }

  sheet.getCell('A13').value = 'Quality Assurance';
  sheet.getCell('A13').font = { bold: true, color: { argb: DARK_GREEN }, size: 12 };
  const qaRows = [
    ['สถานะ', plan.qa.passes ? 'PASS' : 'REVIEW'],
    ['บทความที่ขอ', plan.qa.requestedArticles],
    ['บทความที่จัดได้', plan.qa.scheduledArticles],
    ['เป้าหมายคีย์เวิร์ด', result.meta.requested_count],
    ['Volume API จริง', result.meta.api_backed_count],
    ['Keyword แนะนำ', result.meta.derived_count + result.meta.estimated_count],
    ['คีย์เวิร์ดซ้ำ', plan.qa.duplicateKeywords.length],
    ['ชื่อบทความซ้ำ', plan.qa.duplicateTitles.length],
    ['ไม่มี Money Page', plan.qa.missingMoneyPages],
    ['ไม่มี Internal Link', plan.qa.missingInternalLinks],
    ['ไม่มี Organic KD', plan.qa.missingOrganicDifficulty],
    ['ไม่มี CPC (THB)', plan.qa.missingCpc],
    ['Calendar นอก Keyword Master', plan.qa.calendarOutsideKeywordMaster],
  ];
  sheet.getRow(14).values = ['รายการตรวจ', 'ผล'];
  styleHeader(sheet.getRow(14));
  qaRows.forEach((row, index) => sheet.getRow(15 + index).values = row);
  styleDataRows(sheet, 15, 14 + qaRows.length, [2]);

  sheet.getCell('D13').value = 'คำเตือน / สิ่งที่ควรตรวจเพิ่ม';
  sheet.getCell('D13').font = { bold: true, color: { argb: DARK_GREEN }, size: 12 };
  const warnings = [...plan.qa.warnings, ...result.meta.warnings];
  if (warnings.length === 0) warnings.push('ไม่พบข้อผิดพลาดสำคัญ');
  warnings.forEach((warning, index) => {
    sheet.mergeCells(14 + index, 4, 14 + index, 8);
    const cell = sheet.getCell(14 + index, 4);
    cell.value = `• ${warning}`;
    cell.fill = solid(index % 2 === 0 ? LIGHT_AMBER : WHITE);
    cell.font = { color: { argb: TEXT }, size: 10 };
    cell.border = thinBorder();
    cell.alignment = { wrapText: true, vertical: 'top' };
    sheet.getRow(14 + index).height = 30;
  });

  const sourceRow = Math.max(14 + qaRows.length, 13 + warnings.length) + 2;
  sheet.getCell(sourceRow, 1).value = 'แหล่งข้อมูล';
  sheet.getCell(sourceRow, 1).font = { bold: true, color: { argb: DARK_GREEN } };
  sheet.mergeCells(sourceRow + 1, 1, sourceRow + 2, 8);
  const sourceCell = sheet.getCell(sourceRow + 1, 1);
  sourceCell.value = 'CPC ทุกแถวใช้ THB เท่านั้น • Google Keyword Planner ใช้ค่าเดิมเมื่อบัญชีเป็น THB หรือแปลงจากสกุลอื่น • DataForSEO แปลงจาก USD เป็น THB • อัตราอ้างอิงมีวันที่กำกับ • ถ้าแปลงไม่ได้จะเว้น CPC ว่าง ไม่แสดงค่าผิดสกุล • คำแนะนำจาก AI เว้น Volume/CPC';
  sourceCell.fill = solid(LIGHT_BLUE);
  sourceCell.border = thinBorder();
  sourceCell.alignment = { wrapText: true, vertical: 'middle' };
  sheet.columns = [18, 28, 4, 16, 16, 16, 16, 18].map(width => ({ width }));
}

function buildKeywordMaster(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const sheet = workbook.addWorksheet('Keyword Master');
  configureSheet(sheet, 4);
  const headers = [
    'No.', 'Keyword', 'Pillar', 'Volume', 'AI Estimate (Reference)', 'Organic KD', 'CPC (THB)', 'Competition', 'Competition Index',
    'Intent', 'Funnel', 'Keyword Type', 'Content Type', 'Opportunity', 'P Score', 'Priority',
    'AEO Opportunity', 'AI Search Score', 'Money Page?', 'Metric Source', 'As Of', 'Confidence', 'Title (H1)',
    'CPC Original Currency', 'CPC to THB Rate', 'CPC FX As Of',
    'Top of page bid (low)', 'Top of page bid (high)', 'Three month change', 'KP Trend', 'Trend Chart',
  ];
  titleBand(sheet, 'Keyword Master', 'ชุดคีย์เวิร์ดหลัก พร้อมแหล่งข้อมูลและความมั่นใจของ Metric', headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));

  const itemByKeyword = new Map(result.plan?.contentItems.map(item => [normalizeKey(item.primaryKeyword), item]) ?? []);
  result.keywords.forEach((keyword, index) => {
    const item = itemByKeyword.get(normalizeKey(keyword.keyword));
    const direct = isDirectMetricSource(keyword.volume_source);
    const trend = direct && hasTrend(keyword.monthly_trend) ? keyword.monthly_trend : undefined;
    sheet.getRow(index + 5).values = [
      index + 1,
      keyword.keyword,
      item?.pillar ?? keyword.parent_topic ?? keyword.keyword_group ?? null,
      direct ? keyword.volume : null,
      keyword.estimated_volume ?? null,
      keyword.organic_difficulty ?? null,
      direct && typeof keyword.cpc === 'number' && keyword.cpc > 0 ? keyword.cpc : null,
      keyword.competition,
      keyword.competition_index,
      keyword.intent,
      item?.funnel ?? null,
      keyword.keyword_type,
      keyword.content_type,
      keyword.opportunity_score,
      keyword.priority_score ?? null,
      item?.priority ?? keyword.priority,
      keyword.aeo_opportunity ?? null,
      keyword.ai_search_priority_score ?? keyword.ai_search_score ?? null,
      item?.moneyPage || keyword.money_page_opportunity ? 'YES' : null,
      keyword.metric_source ?? keyword.volume_source,
      keyword.metric_as_of ?? result.meta.generated_at.slice(0, 10),
      keyword.metric_confidence ?? null,
      keyword.title,
      keyword.cpc_original_currency ?? null,
      keyword.cpc_to_thb_rate ?? null,
      keyword.cpc_rate_as_of ?? null,
      // ── KP-native columns (27-31) ──
      direct && typeof keyword.cpc_low === 'number' && keyword.cpc_low > 0 ? keyword.cpc_low : null,
      direct && typeof keyword.cpc_high === 'number' && keyword.cpc_high > 0 ? keyword.cpc_high : null,
      trend ? formatPercentChange(threeMonthChange(trend)) : '-',
      trend ? textSparkline(trend) : '-',
      '', // native sparkline target — chart injected post-write
    ];
  });
  const endRow = Math.max(result.keywords.length + 4, 5);
  styleDataRows(sheet, 5, endRow, [1, 4, 5, 6, 7, 9, 14, 15, 18, 27, 28, 29]);
  sheet.autoFilter = { from: 'A4', to: `AE${endRow}` };
  sheet.getColumn(4).numFmt = '#,##0';
  sheet.getColumn(5).numFmt = '#,##0';
  sheet.getColumn(6).numFmt = '0';
  sheet.getColumn(7).numFmt = '#,##0.00';
  sheet.getColumn(14).numFmt = '0';
  sheet.getColumn(15).numFmt = '0';
  sheet.getColumn(27).numFmt = '#,##0.00';
  sheet.getColumn(28).numFmt = '#,##0.00';
  sheet.getColumn(16).eachCell((cell, rowNumber) => {
    if (rowNumber >= 5) cell.dataValidation = { type: 'list', allowBlank: false, formulae: ['"P1,P2,P3"'] };
  });
  applyPriorityFormatting(sheet, `P5:P${endRow}`);
  const widths = [7, 28, 20, 12, 18, 12, 12, 15, 14, 20, 10, 18, 20, 12, 12, 10, 18, 14, 13, 18, 13, 12, 48, 20, 16, 14,
    16, 16, 14, 16, 14];
  sheet.columns.forEach((column, index) => column.width = widths[index] ?? 16);
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

function buildContentPlanSheet(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const plan = result.plan!;
  const sheet = workbook.addWorksheet('Content Plan');
  const keywordByName = new Map(result.keywords.map(keyword => [normalizeKey(keyword.keyword), keyword]));
  configureSheet(sheet, 4);
  const headers = [
    'ID', 'Type', 'Title', 'Primary Keyword', 'Secondary Keywords', 'Pillar', 'Funnel', 'Intent',
    'Money Page', 'Internal Links', 'Anchor Text', 'Priority', 'Status', 'Slug', 'Volume', 'Organic KD',
    'CPC (THB)', 'Opportunity', 'AI Search Score',
  ];
  titleBand(sheet, 'Content Plan', 'Pillar / Cluster / Tool พร้อม Money Page และ Internal Linking', headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));
  plan.contentItems.forEach((item, index) => {
    const keyword = keywordByName.get(normalizeKey(item.primaryKeyword));
    const hasDirectMetric = isDirectMetricSource(keyword?.volume_source);
    sheet.getRow(index + 5).values = [
      item.id, item.type, item.title, item.primaryKeyword, item.secondaryKeywords.join(' | '), item.pillar,
      item.funnel, item.intent, item.moneyPage, item.internalLinks.join(' | '), item.suggestedAnchorText,
      item.priority, item.status, item.slug, hasDirectMetric ? item.volume : null, item.organicDifficulty ?? null, hasDirectMetric && typeof item.cpc === 'number' && item.cpc > 0 ? item.cpc : null,
      item.opportunityScore, item.aiSearchScore ?? null,
    ];
  });
  const endRow = Math.max(plan.contentItems.length + 4, 5);
  styleDataRows(sheet, 5, endRow, [15, 16, 17, 18, 19]);
  sheet.autoFilter = { from: 'A4', to: `S${endRow}` };
  sheet.getColumn(12).eachCell((cell, rowNumber) => {
    if (rowNumber >= 5) cell.dataValidation = { type: 'list', allowBlank: false, formulae: ['"P1,P2,P3"'] };
  });
  sheet.getColumn(13).eachCell((cell, rowNumber) => {
    if (rowNumber >= 5) cell.dataValidation = { type: 'list', allowBlank: false, formulae: ['"New,Refresh"'] };
  });
  applyPriorityFormatting(sheet, `L5:L${endRow}`);
  const widths = [14, 12, 50, 28, 34, 20, 10, 18, 36, 45, 24, 10, 12, 26, 12, 12, 12, 12, 14];
  sheet.columns.forEach((column, index) => column.width = widths[index] ?? 16);
  sheet.getColumn(15).numFmt = '#,##0';
  sheet.getColumn(17).numFmt = '#,##0.00';
}

function buildPillarMap(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const plan = result.plan!;
  const sheet = workbook.addWorksheet('Pillar Map');
  configureSheet(sheet, 4);
  const headers = ['Pillar', 'Pillar Keyword', 'Money Page', 'Monthly Quota', 'Total Items', 'P1', 'P2', 'P3', 'TOFU', 'MOFU', 'BOFU'];
  titleBand(sheet, 'Pillar Map', 'ภาพรวมโครงสร้าง Topic Cluster และสัดส่วนบทความต่อ Pillar', headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));
  plan.pillars.forEach((pillar, index) => {
    sheet.getRow(index + 5).values = [
      pillar.name, pillar.pillarKeyword, pillar.moneyPage, pillar.monthlyQuota, pillar.totalItems,
      pillar.p1, pillar.p2, pillar.p3, pillar.tofu, pillar.mofu, pillar.bofu,
    ];
  });
  const endRow = Math.max(plan.pillars.length + 4, 5);
  styleDataRows(sheet, 5, endRow, [4, 5, 6, 7, 8, 9, 10, 11]);
  sheet.autoFilter = { from: 'A4', to: `K${endRow}` };
  sheet.columns = [24, 28, 40, 15, 15, 10, 10, 10, 10, 10, 10].map(width => ({ width }));
}

function buildCalendar(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const plan = result.plan!;
  const sheet = workbook.addWorksheet('12-Month Calendar');
  configureSheet(sheet, 4);
  const headers = [
    'Sequence', 'Month No.', 'Month', 'Publish Date', 'Pillar', 'Type', 'Title', 'Primary Keyword',
    'Funnel', 'Priority', 'Money Page', 'Internal Links', 'Status', 'Content Item ID',
  ];
  titleBand(sheet, `${plan.config.months}-Month Content Calendar`, `${plan.config.articlesPerMonth} บทความ/เดือน • เริ่ม ${plan.config.startMonth}`, headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));
  plan.calendar.forEach((entry, index) => {
    sheet.getRow(index + 5).values = [
      entry.sequence, entry.monthIndex, entry.month, new Date(`${entry.publishDate}T00:00:00Z`), entry.pillar,
      entry.contentType, entry.title, entry.primaryKeyword, entry.funnel, entry.priority, entry.moneyPage,
      entry.internalLinks.join(' | '), entry.status, entry.contentItemId,
    ];
  });
  const endRow = Math.max(plan.calendar.length + 4, 5);
  styleDataRows(sheet, 5, endRow, [1, 2]);
  sheet.autoFilter = { from: 'A4', to: `N${endRow}` };
  sheet.getColumn(4).numFmt = 'yyyy-mm-dd';
  applyPriorityFormatting(sheet, `J5:J${endRow}`);
  const widths = [11, 11, 12, 15, 22, 12, 52, 28, 10, 10, 38, 48, 12, 16];
  sheet.columns.forEach((column, index) => column.width = widths[index] ?? 16);
}

function buildCalendarSummary(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const plan = result.plan!;
  const sheet = workbook.addWorksheet('Calendar Summary');
  configureSheet(sheet, 4);
  titleBand(sheet, 'Calendar Summary', 'สูตรสรุปจำนวนบทความรายเดือน, Priority, Funnel และ Pillar', 10);
  const calendarEnd = Math.max(plan.calendar.length + 4, 5);
  const monthHeaders = ['Month', 'Articles', 'P1', 'P2', 'P3', 'TOFU', 'MOFU', 'BOFU'];
  sheet.getRow(4).values = monthHeaders;
  styleHeader(sheet.getRow(4));
  for (let index = 0; index < plan.config.months; index++) {
    const row = index + 5;
    const month = plan.calendar.find(entry => entry.monthIndex === index + 1)?.month
      ?? plan.config.startMonth;
    sheet.getCell(row, 1).value = month;
    sheet.getCell(row, 2).value = { formula: `=COUNTIF('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row})`, result: 0 };
    sheet.getCell(row, 3).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P1")`, result: 0 };
    sheet.getCell(row, 4).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P2")`, result: 0 };
    sheet.getCell(row, 5).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P3")`, result: 0 };
    sheet.getCell(row, 6).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"TOFU")`, result: 0 };
    sheet.getCell(row, 7).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"MOFU")`, result: 0 };
    sheet.getCell(row, 8).value = { formula: `=COUNTIFS('12-Month Calendar'!$C$5:$C$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"BOFU")`, result: 0 };
  }
  styleDataRows(sheet, 5, 4 + plan.config.months, [2, 3, 4, 5, 6, 7, 8]);

  const pillarStart = 7 + plan.config.months;
  sheet.getCell(pillarStart, 1).value = 'Pillar Summary';
  sheet.getCell(pillarStart, 1).font = { bold: true, size: 12, color: { argb: DARK_GREEN } };
  sheet.getRow(pillarStart + 1).values = ['Pillar', 'Articles', 'P1', 'P2', 'P3', 'TOFU', 'MOFU', 'BOFU'];
  styleHeader(sheet.getRow(pillarStart + 1));
  plan.pillars.forEach((pillar, index) => {
    const row = pillarStart + 2 + index;
    sheet.getCell(row, 1).value = pillar.name;
    sheet.getCell(row, 2).value = { formula: `=COUNTIF('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row})`, result: 0 };
    sheet.getCell(row, 3).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P1")`, result: 0 };
    sheet.getCell(row, 4).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P2")`, result: 0 };
    sheet.getCell(row, 5).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$J$5:$J$${calendarEnd},"P3")`, result: 0 };
    sheet.getCell(row, 6).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"TOFU")`, result: 0 };
    sheet.getCell(row, 7).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"MOFU")`, result: 0 };
    sheet.getCell(row, 8).value = { formula: `=COUNTIFS('12-Month Calendar'!$E$5:$E$${calendarEnd},A${row},'12-Month Calendar'!$I$5:$I$${calendarEnd},"BOFU")`, result: 0 };
  });
  styleDataRows(sheet, pillarStart + 2, pillarStart + 1 + Math.max(plan.pillars.length, 1), [2, 3, 4, 5, 6, 7, 8]);
  sheet.columns = [24, 14, 10, 10, 10, 10, 10, 10, 4, 4].map(width => ({ width }));
}

function buildCompetitorSheet(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const sheet = workbook.addWorksheet('Competitor & Rank');
  configureSheet(sheet, 4);
  const headers = [
    'Keyword', 'อันดับเว็บเรา (Your Rank)', 'Top 5?', 'ความมั่นใจ (Confidence)', 'อันดับเดิม (Existing Rank)',
    'ตำแหน่งคู่แข่ง (Competitor Pos)', 'โดเมนคู่แข่ง (Competitor Domain)', 'ลิงก์คู่แข่ง (Competitor URL)', 'ชื่อหน้า (Title)',
  ];
  titleBand(sheet, 'Competitor & Rank', 'อันดับเว็บไซต์เราเทียบกับคู่แข่งใน SERP (DataForSEO)', headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));

  const qualifying = result.keywords.filter(keyword =>
    keyword.site_rank !== undefined ||
    (keyword.competitors && keyword.competitors.length > 0) ||
    keyword.existing_rank !== undefined
  );

  let rowIndex = 5;
  if (qualifying.length === 0) {
    sheet.mergeCells(rowIndex, 1, rowIndex, headers.length);
    sheet.getCell(rowIndex, 1).value = 'ยังไม่มีข้อมูลอันดับ/คู่แข่ง (ต้องมี site_url + DataForSEO creds)';
    rowIndex += 1;
  } else {
    qualifying.forEach(keyword => {
      const yourRank = keyword.site_rank === null || keyword.site_rank === undefined ? 'ไม่ติดใน SERP' : keyword.site_rank;
      const top5 = keyword.rank_in_top5 === true ? '✓' : '';
      const confidence = keyword.rank_confidence ?? '';
      const existingRank = keyword.existing_rank ?? '';
      const competitors = keyword.competitors ?? [];
      if (competitors.length > 0) {
        competitors.forEach(competitor => {
          sheet.getRow(rowIndex).values = [
            keyword.keyword, yourRank, top5, confidence, existingRank,
            competitor.position, competitor.domain, competitor.url, competitor.title,
          ];
          rowIndex += 1;
        });
      } else {
        sheet.getRow(rowIndex).values = [
          keyword.keyword, yourRank, top5, confidence, existingRank,
          null, null, null, null,
        ];
        rowIndex += 1;
      }
    });
  }

  const endRow = Math.max(rowIndex - 1, 5);
  styleDataRows(sheet, 5, endRow, [2, 6]);
  sheet.autoFilter = { from: 'A4', to: `I${endRow}` };
  const widths = [28, 16, 8, 14, 14, 14, 24, 44, 40];
  sheet.columns.forEach((column, index) => column.width = widths[index] ?? 16);
}

// KP monthly-volume matrix: one row per keyword (aligned to Keyword Master row
// numbers) with the trailing 12-month series in columns C..N. Feeds the native
// in-cell sparklines drawn in Keyword Master.
function buildKpMonthlySheet(workbook: ExcelJS.Workbook, result: PipelineResult): void {
  const sheet = workbook.addWorksheet(KP_MONTHLY_SHEET);
  configureSheet(sheet, 4);
  const monthHeaders = Array.from({ length: 12 }, (_, i) => String(i + 1));
  const headers = ['No.', 'Keyword', ...monthHeaders];
  titleBand(sheet, 'KP Monthly', 'ปริมาณค้นหารายเดือน 12 เดือน (เก่า → ล่าสุด) • ที่มา: Google Keyword Planner', headers.length);
  sheet.getRow(4).values = headers;
  styleHeader(sheet.getRow(4));

  result.keywords.forEach((keyword, index) => {
    const direct = isDirectMetricSource(keyword.volume_source);
    const trend = direct && hasTrend(keyword.monthly_trend)
      ? keyword.monthly_trend.filter((v) => typeof v === 'number' && isFinite(v)).slice(-12)
      : [];
    const row: (string | number | null)[] = [index + 1, keyword.keyword, ...Array(12).fill(null)];
    // Right-align the series so the latest month always lands in column N (14).
    const start = 2 + (12 - trend.length); // 0-based offset into `row`
    trend.forEach((v, i) => { row[start + i] = v; });
    sheet.getRow(index + 5).values = row;
  });

  const endRow = Math.max(result.keywords.length + 4, 5);
  styleDataRows(sheet, 5, endRow, [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  for (let c = 3; c <= 14; c++) sheet.getColumn(c).numFmt = '#,##0';
  sheet.autoFilter = { from: 'A4', to: `N${endRow}` };
  const widths = [7, 28, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9];
  sheet.columns.forEach((column, index) => column.width = widths[index] ?? 9);
}

// Build the Keyword-Master native sparkline spec: one line chart per keyword
// row that has a KP monthly series, sourced from the KP Monthly sheet.
function buildSparklineInjection(result: PipelineResult): SparklineInjection {
  const sparklines: SparklineEntry[] = [];
  result.keywords.forEach((keyword, index) => {
    const direct = isDirectMetricSource(keyword.volume_source);
    if (!direct || !hasTrend(keyword.monthly_trend)) return;
    const row = index + 5;
    sparklines.push({ location: `AE${row}`, dataRange: `'${KP_MONTHLY_SHEET}'!C${row}:N${row}` });
  });
  return { sheetName: 'Keyword Master', sparklines };
}

export async function buildPlanWorkbook(result: PipelineResult): Promise<Buffer> {
  if (!result.plan) throw new Error('Full content plan is required for XLSX export');

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'WordGod';
  workbook.company = 'Convert Cake';
  workbook.subject = 'SEO Keyword Research and Content Plan';
  workbook.title = `WordGod ${result.plan.config.months}-Month SEO Content Plan`;
  workbook.created = new Date(result.meta.generated_at);
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  buildOverview(workbook, result);
  buildKeywordMaster(workbook, result);
  buildContentPlanSheet(workbook, result);
  buildPillarMap(workbook, result);
  buildCalendar(workbook, result);
  buildCalendarSummary(workbook, result);
  buildCompetitorSheet(workbook, result);
  buildKpMonthlySheet(workbook, result);

  const bytes = await workbook.xlsx.writeBuffer();
  const base = Buffer.from(bytes);

  // Native in-cell sparklines are injected post-write (ExcelJS has no API for
  // them). Fail-safe: if injection throws, ship the un-injected workbook — it
  // still carries the "KP Trend" text sparkline and the KP Monthly raw columns.
  try {
    return await injectNativeSparklines(base, [buildSparklineInjection(result)]);
  } catch (err) {
    console.error('[export] native sparkline injection skipped:', err instanceof Error ? err.message : err);
    return base;
  }
}
