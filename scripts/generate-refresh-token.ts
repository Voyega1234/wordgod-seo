/**
 * WordGod — Google Ads OAuth Refresh Token Generator
 *
 * Run once to get a refresh token for Google Ads API access.
 *
 * Usage:
 *   npx ts-node scripts/generate-refresh-token.ts
 *
 * Prerequisites:
 *   1. Set GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env.local
 *   2. Add http://localhost:3030/oauth-callback to your OAuth client's redirect URIs
 *   3. Run this script, open the URL, authorize, paste the code back
 *
 * Output: GOOGLE_ADS_REFRESH_TOKEN to add to .env.local
 */

import * as readline from 'readline';
import * as https from 'https';
import * as http from 'http';
import * as url from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as querystring from 'querystring';

// Load .env.local manually (no dotenv dependency needed)
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise(resolve => rl.question(question, resolve));
}

async function exchangeCode(clientId: string, clientSecret: string, code: string, redirectUri: string): Promise<any> {
  const body = querystring.stringify({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path: '/token',
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  loadEnvLocal();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  console.log('\n=== WordGod — Google Ads Refresh Token Generator ===\n');

  const clientId = process.env.GOOGLE_ADS_CLIENT_ID
    || await ask(rl, 'Enter GOOGLE_ADS_CLIENT_ID: ');
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET
    || await ask(rl, 'Enter GOOGLE_ADS_CLIENT_SECRET: ');

  const REDIRECT_URI = 'http://localhost:3030/oauth-callback';
  const SCOPES = 'https://www.googleapis.com/auth/adwords';

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    querystring.stringify({
      client_id: clientId,
      redirect_uri: REDIRECT_URI,
      response_type: 'code',
      scope: SCOPES,
      access_type: 'offline',
      prompt: 'consent',
    });

  console.log('\n1. Open this URL in your browser:\n');
  console.log(authUrl);
  console.log('\n2. Sign in and authorize access.\n');
  console.log('3. You will be redirected to localhost:3030. Copy the "code" parameter from the URL.\n');

  // Try to start a local server to capture the code automatically
  let capturedCode: string | null = null;
  const server = http.createServer((req, res) => {
    const parsed = url.parse(req.url || '', true);
    const code = parsed.query.code as string;
    const error = parsed.query.error as string;

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h2>Authorization failed: ${error}</h2><p>Return to terminal.</p>`);
      capturedCode = '';
      server.close();
      return;
    }

    if (code) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h2>WordGod: Authorization successful!</h2><p>Return to terminal.</p>`);
      capturedCode = code;
      server.close();
    }
  });

  let autoCode: string | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      server.listen(3030, () => {
        console.log('Waiting for redirect on http://localhost:3030/oauth-callback ...\n');
        resolve();
      });
      server.on('error', reject);
    });

    // Wait up to 3 minutes for auto-capture
    await new Promise<void>((resolve) => {
      const timer = setInterval(() => {
        if (capturedCode !== null) {
          clearInterval(timer);
          resolve();
        }
      }, 500);
      setTimeout(() => { clearInterval(timer); resolve(); }, 180_000);
    });
    autoCode = capturedCode || undefined;
  } catch {
    // Port in use — fall through to manual entry
    server.close();
  }

  const code = autoCode || await ask(rl, 'Paste the authorization code here: ');

  if (!code) {
    console.error('\nNo authorization code provided. Exiting.');
    rl.close();
    process.exit(1);
  }

  console.log('\nExchanging code for tokens...');

  try {
    const tokens = await exchangeCode(clientId.trim(), clientSecret.trim(), code.trim(), REDIRECT_URI);

    if (tokens.error) {
      console.error('\nToken exchange failed:', tokens.error, tokens.error_description);
      rl.close();
      process.exit(1);
    }

    console.log('\n=== SUCCESS ===\n');
    console.log('Add these to your .env.local:\n');
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}`);
    if (tokens.access_token) {
      console.log(`\n(Access token valid for ~1 hour, not needed in .env.local)`);
    }
    console.log('\nDo NOT commit .env.local to git.\n');
  } catch (err: any) {
    console.error('\nFailed to exchange code:', err.message);
    rl.close();
    process.exit(1);
  }

  rl.close();
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
