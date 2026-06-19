/**
 * WordGod — GoogleKeywordPlannerService Tests
 *
 * Tests config validation, customer ID normalization, error handling, and
 * the async skill path. No real Google Ads API calls are made.
 *
 * Run with: npx ts-node lib/services/googleKeywordPlanner.test.ts
 */

import {
  normalizeCustomerId,
  validateGoogleAdsConfig,
  handleGoogleAdsApiError,
  GoogleAdsApiError,
} from './googleKeywordPlannerService';
import { buildCacheKey } from '../cache/keywordPlannerCache';
import { runKeywordResearchSeoTitleSkillAsync } from '../skills/keyword-seo-title';
import type { SkillInput, GoogleAdsConfig } from '../skills/keyword-seo-title/types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  console.log(`  ✓ ${message}`);
}

function assertThrows(fn: () => any, errorCode: string, message: string) {
  try {
    fn();
    throw new Error(`FAIL: Expected throw but got none — ${message}`);
  } catch (e: any) {
    if (e instanceof GoogleAdsApiError && e.code === errorCode) {
      console.log(`  ✓ ${message}`);
    } else if (e.message.startsWith('FAIL:')) {
      throw e;
    } else {
      throw new Error(`FAIL: Expected GoogleAdsApiError(${errorCode}) but got ${e.constructor.name}: ${e.message} — ${message}`);
    }
  }
}

// ─── Test: normalizeCustomerId ────────────────────────────────────────────────

function testNormalizeCustomerId() {
  console.log('\n[Unit] normalizeCustomerId');
  assert(normalizeCustomerId('123-456-7890') === '1234567890', 'removes dashes');
  assert(normalizeCustomerId('1234567890') === '1234567890', 'no change when no dashes');
  assert(normalizeCustomerId(' 123-456 ') === '123456', 'trims whitespace and removes dashes');
}

// ─── Test: validateGoogleAdsConfig ───────────────────────────────────────────

function testValidateGoogleAdsConfig() {
  console.log('\n[Unit] validateGoogleAdsConfig');

  const { valid, errors } = validateGoogleAdsConfig(null);
  assert(!valid, 'null config is invalid');
  assert(errors.length > 0, 'null config has errors');

  const goodConfig: GoogleAdsConfig = {
    developerToken: 'dev-token',
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    customerId: '1234567890',
    apiVersion: 'v20',
  };
  const { valid: v2, errors: e2 } = validateGoogleAdsConfig(goodConfig);
  assert(v2, 'valid config passes');
  assert(e2.length === 0, 'valid config has no errors');

  const badIdConfig: GoogleAdsConfig = { ...goodConfig, customerId: 'abc-bad' };
  const { valid: v3, errors: e3 } = validateGoogleAdsConfig(badIdConfig);
  assert(!v3, 'config with non-numeric customer ID is invalid');
  assert(e3.some(e => e.includes('invalid format')), 'error mentions invalid format');

  const missingToken: GoogleAdsConfig = { ...goodConfig, refreshToken: '' };
  const { valid: v4, errors: e4 } = validateGoogleAdsConfig(missingToken);
  assert(!v4, 'config with empty refreshToken is invalid');
  assert(e4.some(e => e.includes('GOOGLE_ADS_REFRESH_TOKEN')), 'error mentions REFRESH_TOKEN');
}

// ─── Test: handleGoogleAdsApiError ───────────────────────────────────────────

function testHandleApiErrors() {
  console.log('\n[Unit] handleGoogleAdsApiError — error codes');

  assertThrows(
    () => handleGoogleAdsApiError(401, '{"error":{"message":"Unauthenticated"}}'),
    'AUTH_ERROR',
    '401 → AUTH_ERROR'
  );

  assertThrows(
    () => handleGoogleAdsApiError(403, '{"error":{"message":"Permission denied"}}'),
    'PERMISSION_DENIED',
    '403 → PERMISSION_DENIED'
  );

  assertThrows(
    () => handleGoogleAdsApiError(429, '{"error":{"message":"Quota exceeded"}}'),
    'QUOTA_EXCEEDED',
    '429 → QUOTA_EXCEEDED'
  );

  assertThrows(
    () => handleGoogleAdsApiError(400, '{"error":{"message":"Invalid request"}}'),
    'BAD_REQUEST',
    '400 → BAD_REQUEST'
  );

  assertThrows(
    () => handleGoogleAdsApiError(500, 'Internal server error'),
    'API_ERROR',
    '500 → API_ERROR'
  );
}

// ─── Test: buildCacheKey ──────────────────────────────────────────────────────

function testBuildCacheKey() {
  console.log('\n[Unit] buildCacheKey');

  const input1: SkillInput = {
    business_name: 'Test',
    seed_keywords: ['วีซ่า', 'เชงเก้น'],
    target_country: 'Thailand',
    target_language: 'th',
    volume_source: 'google_keyword_planner_api',
  };
  const input2: SkillInput = {
    ...input1,
    seed_keywords: ['เชงเก้น', 'วีซ่า'], // reversed — should give same key
  };
  const input3: SkillInput = {
    ...input1,
    target_country: 'USA', // different country
  };

  const k1 = buildCacheKey(input1);
  const k2 = buildCacheKey(input2);
  const k3 = buildCacheKey(input3);

  assert(typeof k1 === 'string' && k1.length === 16, 'cache key is 16-char string');
  assert(k1 === k2, 'seed order does not affect cache key');
  assert(k1 !== k3, 'different country = different key');
}

// ─── Test: async skill — fallback when API not configured ─────────────────────

async function testAsyncSkillFallback() {
  console.log('\n[Integration] runKeywordResearchSeoTitleSkillAsync — fallback when no credentials');

  // Unset any real creds to force fallback path
  const savedEnv: Record<string, string | undefined> = {};
  const KEYS = [
    'GOOGLE_ADS_DEVELOPER_TOKEN', 'GOOGLE_ADS_CLIENT_ID', 'GOOGLE_ADS_CLIENT_SECRET',
    'GOOGLE_ADS_REFRESH_TOKEN', 'GOOGLE_ADS_CUSTOMER_ID',
  ];
  for (const k of KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }

  try {
    const result = await runKeywordResearchSeoTitleSkillAsync({
      business_name: 'WordGod Test',
      business_type: 'content website',
      category: 'Visa / Travel',
      seed_keywords: ['วีซ่าญี่ปุ่น', 'วีซ่าเชงเก้น'],
      number_of_results: 20,
      volume_source: 'google_keyword_planner_api',
      output_mode: 'simple_csv',
    });

    assert(result.system_name === 'WordGod', 'system_name = WordGod');
    assert(result.rows.length > 0, 'fallback produces rows from seed expansion');
    assert(result.metadata.fallback_used === true, 'metadata.fallback_used = true');
    assert(result.metadata.api_success === false, 'metadata.api_success = false');
    assert(result.metadata.warnings.length > 0, 'fallback warning is in metadata');
    assert(result.metadata.warnings[0].includes('Google Ads API failed'), 'warning mentions API failure');
    assert(result.metadata.has_missing_volume === true, 'metadata.has_missing_volume = true (estimated volumes)');

    console.log(`  → ${result.rows.length} rows from fallback | warning: ${result.metadata.warnings[0]}`);
  } finally {
    for (const k of KEYS) {
      if (savedEnv[k] !== undefined) process.env[k] = savedEnv[k];
    }
  }
}

// ─── Test: async skill — metadata when non-API volume_source ──────────────────

async function testAsyncSkillNonApiMode() {
  console.log('\n[Integration] runKeywordResearchSeoTitleSkillAsync — estimated mode (no API)');

  const result = await runKeywordResearchSeoTitleSkillAsync({
    business_name: 'WordGod Test',
    category: 'Beauty & Personal Care',
    seed_keywords: ['สิว', 'ครีม'],
    number_of_results: 10,
    volume_source: 'estimated',
    output_mode: 'full_csv',
  });

  assert(result.system_name === 'WordGod', 'system_name = WordGod');
  assert(result.rows.length > 0, 'has rows');
  assert(result.metadata.api_success === false, 'api_success = false in estimated mode');
  assert(result.metadata.fallback_used === false, 'fallback_used = false in estimated mode');

  // Competition columns should be undefined (no Google Ads data)
  const row = result.rows[0] as any;
  if ('Competition' in row) {
    assert(row['Competition'] === undefined || row['Competition'] === '', 'Competition empty in estimated mode');
  } else {
    console.log('  ✓ Competition column not present in estimated mode (correct)');
  }
}

// ─── Run All ──────────────────────────────────────────────────────────────────

async function runAll() {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  WordGod — Google Keyword Planner Service');
  console.log('  Integration & Unit Tests');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  let passed = 0;
  let failed = 0;

  const syncTests = [
    testNormalizeCustomerId,
    testValidateGoogleAdsConfig,
    testHandleApiErrors,
    testBuildCacheKey,
  ];

  for (const t of syncTests) {
    try { t(); passed++; }
    catch (e: any) { console.error(`  ✗ ${e.message}`); failed++; }
  }

  const asyncTests = [testAsyncSkillFallback, testAsyncSkillNonApiMode];
  for (const t of asyncTests) {
    try { await t(); passed++; }
    catch (e: any) { console.error(`  ✗ ${e.message}`); failed++; }
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failed > 0) process.exit(1);
}

runAll();
