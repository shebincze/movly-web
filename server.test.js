'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const { after, test } = require('node:test');

process.env.MOVLY_API_KEY ||= 'test-api-key';
process.env.DOWNLOAD_TOKEN_SECRET ||= 'test-download-token-secret-123456';
process.env.NODE_ENV ||= 'test';
const manifestKeys = crypto.generateKeyPairSync('ed25519');
const manifestPublicSPKI = manifestKeys.publicKey.export({ type: 'spki', format: 'der' });
process.env.MOVLY_WINDOWS_UPDATE_PUBLIC_KEY_BASE64 = manifestPublicSPKI.subarray(-32).toString('base64');
const testStorageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'movly-web-test-'));
const testReleasesRoot = path.join(testStorageRoot, '.movly-download-releases');
const testActiveRelease = path.join(testReleasesRoot, 'test-release-1');
const testDownloadRoot = path.join(testStorageRoot, 'downloads');
fs.mkdirSync(testActiveRelease, { recursive: true });
fs.symlinkSync(testActiveRelease, testDownloadRoot, 'dir');
process.env.DOWNLOAD_ROOT = testDownloadRoot;

after(() => {
  fs.rmSync(testStorageRoot, { recursive: true, force: false });
});

const {
  createServer,
  enforceWindowsLinkRateLimit,
  HttpError,
  isPremiumActive,
  movlyApi,
  parseByteRange,
  pipeReadableFileStream,
  resetWindowsSecurityStateForTests,
  resolveClientRateLimitIP,
  statPath,
  windowsSecurityStateForTests,
} = require('./server');

function request(server, method, pathname, token = null, body = null, extraHeaders = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const headers = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== null) headers['Content-Length'] = Buffer.byteLength(body);
    const req = http.request({
      agent: false,
      hostname: '127.0.0.1',
      port: address.port,
      method,
      path: pathname,
      headers,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        const isJSON = String(res.headers['content-type'] || '').includes('application/json');
        resolve({
          status: res.statusCode,
          body: raw ? (isJSON ? JSON.parse(raw) : raw) : null,
          headers: res.headers,
        });
      });
    });
    req.on('error', reject);
    req.end(body);
  });
}

function signManifest(signed) {
  return crypto.sign(null, Buffer.from(signed, 'utf8'), manifestKeys.privateKey).toString('base64');
}

function validAccount(overrides = {}) {
  return {
    id: 42,
    username: 'free-user',
    email: null,
    display_name: null,
    coins: 0,
    role: 'user',
    is_active: true,
    is_verified: true,
    premium_until: null,
    ...overrides,
  };
}

test('Premium je aktivní pouze pro platný budoucí RFC 3339 timestamp', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');
  const logger = { error: () => assert.fail('Platné datum se nesmí logovat jako chyba.') };

  assert.equal(isPremiumActive('2026-07-13T12:00:01Z', now, logger), true);
  assert.equal(isPremiumActive('2026-07-13T14:00:01+02:00', now, logger), true);
  assert.equal(isPremiumActive('2026-07-13T12:00:00Z', now, logger), false);
  assert.equal(isPremiumActive('2026-07-13T11:59:59.999Z', now, logger), false);
});

test('Premium parser odmítne chybějící i normalizovatelná neplatná data', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');
  const diagnostics = [];
  const logger = { error: (message) => diagnostics.push(message) };

  assert.equal(isPremiumActive(null, now, logger), false);
  assert.equal(isPremiumActive('', now, logger), false);
  assert.equal(isPremiumActive('2026-02-31T12:00:00Z', now, logger), false);
  assert.equal(isPremiumActive('2026-13-01T12:00:00Z', now, logger), false);
  assert.equal(isPremiumActive('2026-07-13', now, logger), false);
  assert.equal(isPremiumActive('2026-07-14T12:00:00-00:00', now, logger), false);
  assert.equal(isPremiumActive('not-a-date', now, logger), false);
  assert.equal(isPremiumActive(' 2026-07-14T12:00:00Z ', now, logger), false);
  assert.equal(isPremiumActive(123, now, logger), false);
  assert.equal(diagnostics.length, 8);
  diagnostics.forEach((message) => assert.match(message, /Premium přístup byl zamítnut/));
});

test('Číselná konfigurace odmítne suffix místo tichého parseInt fallbacku', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: { ...process.env, MOVLY_WEB_PORT: '8080garbage' },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /celé číslo 1–65535/);
});

test('Produkční reverse proxy bez explicitního trusted allowlistu skončí chybou', () => {
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: __dirname,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      MOVLY_TRUSTED_PROXY_IPS: '',
      MOVLY_WEB_PORT: '8080',
    },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Produkce za reverzní proxy vyžaduje neprázdné MOVLY_TRUSTED_PROXY_IPS/);
});

test('Chybějící NODE_ENV nespadne tiše do development režimu', () => {
  const env = { ...process.env, MOVLY_WEB_PORT: '8080' };
  delete env.NODE_ENV;
  const result = spawnSync(process.execPath, ['server.js'], {
    cwd: __dirname,
    encoding: 'utf8',
    env,
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NODE_ENV musí být explicitně nastavené/);
});

test('HTTP byte range podporuje suffix a odmítá nejednoznačné hodnoty', () => {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-4', 10), { start: 6, end: 9 });
  assert.deepEqual(parseByteRange('bytes=-40', 10), { start: 0, end: 9 });
  assert.throws(() => parseByteRange('bytes=-', 10), (error) => error.status === 416);
  assert.throws(() => parseByteRange('bytes=1-2junk', 10), (error) => error.status === 416);
  assert.throws(() => parseByteRange('bytes=0-0', 0), (error) => error.status === 416);
});

test('Movly API timeout skončí explicitní HTTP 504 chybou', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    }, { once: true });
  });

  try {
    await assert.rejects(
      movlyApi('v1/test', 'GET', null, null, 'test-session', 10),
      (error) => error instanceof HttpError && error.status === 504,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('Obecná API proxy zachová upstream 429/503 a kanonický Retry-After', async () => {
  const originalFetch = global.fetch;
  let upstreamStatus = 429;
  let retryAfter = '17';
  global.fetch = async () => ({
    ok: false,
    status: upstreamStatus,
    headers: new Headers(retryAfter === null ? {} : { 'Retry-After': retryAfter }),
    text: async () => JSON.stringify({ message: 'Upstream je dočasně omezený.' }),
  });

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const limited = await request(server, 'GET', '/api/auth/me', 'token');
    assert.equal(limited.status, 429);
    assert.equal(limited.headers['retry-after'], '17');

    upstreamStatus = 503;
    retryAfter = '23';
    const unavailable = await request(server, 'GET', '/api/auth/me', 'token');
    assert.equal(unavailable.status, 503);
    assert.equal(unavailable.headers['retry-after'], '23');

    retryAfter = null;
    const unavailableWithoutHint = await request(server, 'GET', '/api/auth/me', 'token');
    assert.equal(unavailableWithoutHint.status, 503);
    assert.equal(unavailableWithoutHint.headers['retry-after'], undefined);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Watch Party deep link a mobilní association soubory jsou veřejné a HEAD-kompatibilní', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const party = await request(server, 'GET', '/party/ABC234');
    assert.equal(party.status, 200);
    assert.match(party.headers['content-type'], /^text\/html/);
    assert.match(party.body, /ABC234|Watch Party/i);

    const partyHead = await request(server, 'HEAD', '/party/ABC234');
    assert.equal(partyHead.status, 200);
    assert.equal(partyHead.body, null);
    assert.ok(Number(partyHead.headers['content-length']) > 0);

    const invalidParty = await request(server, 'GET', '/party/ABC01I');
    assert.equal(invalidParty.status, 404);

    const apple = await request(server, 'GET', '/.well-known/apple-app-site-association');
    assert.equal(apple.status, 200);
    assert.equal(apple.headers['content-type'], 'application/json; charset=utf-8');
    assert.deepEqual(apple.body.applinks.details[0].appIDs, ['F245LNF966.cz.movly.app']);
    assert.equal(apple.body.applinks.details[0].components[0]['/'], '/party/*');

    const android = await request(server, 'GET', '/.well-known/assetlinks.json');
    assert.equal(android.status, 200);
    assert.equal(android.body[0].target.package_name, 'cz.movly');
    assert.equal(android.body[0].target.sha256_cert_fingerprints.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('statPath vrací null jen pro ENOENT a ostatní chyby nezakrývá jako 404', () => {
  const missing = new Error('missing');
  missing.code = 'ENOENT';
  const denied = new Error('denied');
  denied.code = 'EACCES';
  const diagnostics = [];
  const logger = { error: (...args) => diagnostics.push(args) };

  assert.equal(statPath('/missing', 'test', () => { throw missing; }, logger), null);
  assert.throws(
    () => statPath('/denied', 'test', () => { throw denied; }, logger),
    (error) => error instanceof HttpError && error.status === 500,
  );
  assert.equal(diagnostics.length, 1);
});

test('Přerušená HTTP odpověď zavře otevřený file descriptor', async () => {
  const fixturePath = path.join(testStorageRoot, 'aborted-download.bin');
  fs.writeFileSync(fixturePath, Buffer.alloc(1024 * 1024, 7));
  const fd = fs.openSync(fixturePath, 'r');
  const source = fs.createReadStream(fixturePath, { fd, autoClose: true, highWaterMark: 1 });
  const response = new PassThrough();
  const closed = once(source, 'close');
  try {
    pipeReadableFileStream(source, response, 'abort test');
    response.emit('close');
    await closed;
    assert.equal(source.destroyed, true);
    assert.equal(source.closed, true);
    assert.throws(() => fs.fstatSync(fd), (error) => error?.code === 'EBADF');

    const preClosedFD = fs.openSync(fixturePath, 'r');
    const preClosedSource = fs.createReadStream(fixturePath, {
      fd: preClosedFD,
      autoClose: true,
      highWaterMark: 1,
    });
    const preClosedResponse = new PassThrough();
    preClosedResponse.destroy();
    const preClosed = once(preClosedSource, 'close');
    pipeReadableFileStream(preClosedSource, preClosedResponse, 'pre-closed abort test');
    await preClosed;
    assert.equal(preClosedSource.closed, true);
    assert.throws(() => fs.fstatSync(preClosedFD), (error) => error?.code === 'EBADF');
  } finally {
    response.destroy();
    if (!source.closed) source.destroy();
    if (fs.existsSync(fixturePath)) fs.rmSync(fixturePath);
  }
});

test('Windows download link limiter omezuje zvlášť uživatele i síťovou adresu', () => {
  const now = Date.parse('2026-07-14T12:00:00Z');
  const req = { socket: { remoteAddress: '203.0.113.10' } };

  resetWindowsSecurityStateForTests();
  const { rateLimits } = windowsSecurityStateForTests();
  for (let index = 0; index < rateLimits.user; index += 1) {
    enforceWindowsLinkRateLimit(req, 42, now);
  }
  assert.throws(
    () => enforceWindowsLinkRateLimit(req, 42, now),
    (error) => error instanceof HttpError
      && error.status === 429
      && error.payload?.code === 'windows_download_link_rate_limited',
  );

  resetWindowsSecurityStateForTests();
  for (let index = 0; index < rateLimits.ip; index += 1) {
    enforceWindowsLinkRateLimit(req, index + 1, now);
  }
  assert.throws(
    () => enforceWindowsLinkRateLimit(req, rateLimits.ip + 1, now),
    (error) => error instanceof HttpError
      && error.status === 429
      && error.payload?.code === 'windows_download_link_rate_limited',
  );
  resetWindowsSecurityStateForTests();
});

test('Client IP se přijímá jen z explicitně důvěryhodné proxy', () => {
  const trusted = new Set(['127.0.0.1']);
  assert.equal(resolveClientRateLimitIP({
    socket: { remoteAddress: '::ffff:127.0.0.1' },
    headers: { 'x-movly-client-ip': '203.0.113.44' },
  }, trusted), '203.0.113.44');
  assert.equal(resolveClientRateLimitIP({
    socket: { remoteAddress: '198.51.100.9' },
    headers: {},
  }, trusted), '198.51.100.9');
  assert.throws(
    () => resolveClientRateLimitIP({
      socket: { remoteAddress: '198.51.100.9' },
      headers: { 'x-movly-client-ip': '203.0.113.44' },
    }, trusted),
    (error) => error instanceof HttpError
      && error.status === 400
      && error.payload?.code === 'windows_download_untrusted_client_ip_header',
  );
  assert.throws(
    () => resolveClientRateLimitIP({
      socket: { remoteAddress: '127.0.0.1' },
      headers: {},
    }, trusted),
    (error) => error instanceof HttpError
      && error.status === 500
      && error.payload?.code === 'windows_download_trusted_proxy_header_missing',
  );

  resetWindowsSecurityStateForTests();
  const { rateLimits } = windowsSecurityStateForTests();
  const proxyRequest = (clientIP) => ({
    socket: { remoteAddress: '127.0.0.1' },
    headers: { 'x-movly-client-ip': clientIP },
  });
  const now = Date.parse('2026-07-14T12:00:00Z');
  for (let index = 0; index < rateLimits.ip; index += 1) {
    enforceWindowsLinkRateLimit(proxyRequest('203.0.113.44'), index + 1, now, trusted);
  }
  assert.throws(
    () => enforceWindowsLinkRateLimit(
      proxyRequest('203.0.113.44'),
      rateLimits.ip + 1,
      now,
      trusted,
    ),
    (error) => error instanceof HttpError && error.status === 429,
  );
  assert.doesNotThrow(() => enforceWindowsLinkRateLimit(
    proxyRequest('203.0.113.45'),
    rateLimits.ip + 2,
    now,
    trusted,
  ));
  resetWindowsSecurityStateForTests();
});

test('Windows podepsaný update feed je veřejný, odkazy zůstávají autentizované', async () => {
  resetWindowsSecurityStateForTests();
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(url, /\/v1\/auth\/me$/);
    assert.equal(options.headers.Authorization, 'Bearer free-user-token');
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(validAccount()),
    };
  };

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const unauthenticated = await request(server, 'GET', '/api/updates/windows');
    assert.equal(unauthenticated.status, 404);
    assert.match(unauthenticated.body.message, /Manifest/);

    const manualDownloads = await request(server, 'GET', '/api/downloads', 'free-user-token');
    assert.equal(manualDownloads.status, 403);

    const manualWindowsLink = await request(
      server,
      'POST',
      '/api/downloads/windows-x64/link',
      'free-user-token',
    );
    assert.equal(manualWindowsLink.status, 403);

    const updateFeed = await request(server, 'GET', '/api/updates/windows', 'free-user-token');
    assert.equal(updateFeed.status, 404);
    assert.match(updateFeed.body.message, /Manifest/);

    const updateInstaller = await request(
      server,
      'POST',
      '/api/updates/windows/downloads/windows-x64/link',
      'free-user-token',
    );
    assert.equal(updateInstaller.status, 404);
    assert.match(updateInstaller.body.message, /Manifest/);

    const macOSBypass = await request(
      server,
      'POST',
      '/api/updates/windows/downloads/macos-universal/link',
      'free-user-token',
    );
    assert.equal(macOSBypass.status, 404);
    assert.match(macOSBypass.body.message, /není povolený pro Windows auto-update/);
  } finally {
    global.fetch = originalFetch;
    resetWindowsSecurityStateForTests();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Legacy-v1 feed zůstává kompatibilní s buildem 90, secure update link je blokovaný', async () => {
  resetWindowsSecurityStateForTests();
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  global.fetch = async (_url, options) => {
    const account = options.headers.Authorization === 'Bearer premium-user-token'
      ? validAccount({ id: 43, username: 'premium-user', premium_until: '2099-01-01T00:00:00Z' })
      : validAccount();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(account),
    };
  };

  const manifestPath = path.join(testDownloadRoot, 'windows-manifest.json');
  const installerPath = path.join(testDownloadRoot, 'MovlySetup-x64.exe');
  const installerBody = 'legacy-manual-installer';
  const installerSha256 = crypto.createHash('sha256').update(installerBody).digest('hex');
  const legacySigned = JSON.stringify({
    version: '0.1.9',
    buildCode: 95,
    channel: 'stable',
    releasedAt: '2026-07-13',
    notes: 'Legacy manual release',
    arches: {
      arm64: {
        fileName: 'MovlySetup-arm64.exe',
        sha256: 'a'.repeat(64),
        downloadId: 'windows-arm64',
      },
      x64: {
        fileName: 'MovlySetup-x64.exe',
        sha256: installerSha256,
        sizeBytes: Buffer.byteLength(installerBody),
        downloadId: 'windows-x64',
      },
      x86: {
        fileName: 'MovlySetup-x86.exe',
        sha256: 'c'.repeat(64),
        downloadId: 'windows-x86',
      },
    },
  });
  fs.writeFileSync(manifestPath, JSON.stringify({
    signed: legacySigned,
    signature: signManifest(legacySigned),
  }), 'utf8');
  fs.writeFileSync(installerPath, installerBody, 'utf8');

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const manualLink = await request(
      server,
      'POST',
      '/api/downloads/windows-x64/link',
      'premium-user-token',
    );
    assert.equal(manualLink.status, 200);
    assert.equal(manualLink.body.windowsReleaseMode, 'legacy-v1-manual-only');
    assert.match(manualLink.body.url, /^\/secure-download\//);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /explicitní legacy-v1 režim/);

    const encodedPayload = manualLink.body.url.split('/').pop().split('.')[0];
    const tokenPayload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    assert.equal(tokenPayload.releaseId, 'test-release-1');
    assert.equal(tokenPayload.sha256, installerSha256);

    const download = await request(server, 'GET', manualLink.body.url);
    assert.equal(download.status, 200);
    assert.equal(download.body, installerBody);

    const updateFeed = await request(server, 'GET', '/api/updates/windows', 'free-user-token');
    assert.equal(updateFeed.status, 200);
    assert.equal(updateFeed.body.signed, legacySigned);
    assert.equal(updateFeed.body.signature, signManifest(legacySigned));
    assert.equal(updateFeed.body.live.x64.available, true);
    assert.equal(updateFeed.body.live.x64.sizeBytes, Buffer.byteLength(installerBody));

    const updateLink = await request(
      server,
      'POST',
      '/api/updates/windows/downloads/windows-x64/link',
      'free-user-token',
    );
    assert.equal(updateLink.status, 500);
    assert.match(updateLink.body.message, /legacy-v1.*jen pro ruční Premium stažení/);

    const incompleteSigned = JSON.stringify({ ...JSON.parse(legacySigned), security: false });
    fs.writeFileSync(manifestPath, JSON.stringify({
      signed: incompleteSigned,
      signature: signManifest(incompleteSigned),
    }), 'utf8');
    const incompleteManualLink = await request(
      server,
      'POST',
      '/api/downloads/windows-x64/link',
      'premium-user-token',
    );
    assert.equal(incompleteManualLink.status, 500);
    assert.match(incompleteManualLink.body.message, /neúplná secure-v2 metadata/);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    resetWindowsSecurityStateForTests();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (fs.existsSync(manifestPath)) fs.rmSync(manifestPath);
    if (fs.existsSync(installerPath)) fs.rmSync(installerPath);
  }
});

test('Windows update link přijme jen target z validního aktuálního manifestu', async () => {
  resetWindowsSecurityStateForTests();
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    const account = options.headers.Authorization === 'Bearer premium-user-token'
      ? validAccount({ id: 43, username: 'premium-user', premium_until: '2099-01-01T00:00:00Z' })
      : validAccount();
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify(account),
    };
  };

  const manifestPath = path.join(testDownloadRoot, 'windows-manifest.json');
  const installerPath = path.join(testDownloadRoot, 'MovlySetup-x64.exe');
  const installerBody = 'test-installer';
  const installerSha256 = crypto.createHash('sha256').update(installerBody).digest('hex');
  const signed = JSON.stringify({
    version: '1.2.3',
    buildCode: 4,
    channel: 'stable',
    releasedAt: '2026-07-14',
    notes: '',
    security: false,
    authenticodeCertificateSha256: 'b'.repeat(64),
    arches: {
      arm64: {
        fileName: 'MovlySetup-arm64.exe',
        sha256: 'c'.repeat(64),
        downloadId: 'windows-arm64',
      },
      x64: {
        fileName: 'MovlySetup-x64.exe',
        sha256: installerSha256,
        sizeBytes: Buffer.byteLength(installerBody),
        downloadId: 'windows-x64',
      },
      x86: {
        fileName: 'MovlySetup-x86.exe',
        sha256: 'd'.repeat(64),
        downloadId: 'windows-x86',
      },
    },
  });
  const signature = signManifest(signed);
  fs.writeFileSync(manifestPath, JSON.stringify({ signed, signature }), 'utf8');
  fs.writeFileSync(installerPath, installerBody, 'utf8');

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  try {
    const feed = await request(server, 'GET', '/api/updates/windows', 'free-user-token');
    assert.equal(feed.status, 200);
    assert.equal(feed.body.live.x64.available, true);
    assert.equal(JSON.parse(feed.body.signed).arches.x64.sizeBytes, Buffer.byteLength(installerBody));

    const head = await request(server, 'HEAD', '/api/updates/windows');
    assert.equal(head.status, 200);
    assert.equal(head.body, null);
    assert.ok(Number(head.headers['content-length']) > 0);

    const link = await request(
      server,
      'POST',
      '/api/updates/windows/downloads/windows-x64/link',
      'free-user-token',
    );
    assert.equal(link.status, 200);
    assert.match(link.body.url, /^\/secure-download\//);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 1);

    const invalidRange = await request(
      server,
      'GET',
      link.body.url,
      null,
      null,
      { Range: 'bytes=999-' },
    );
    assert.equal(invalidRange.status, 416);
    assert.equal(invalidRange.headers['content-range'], `bytes */${Buffer.byteLength(installerBody)}`);

    const premiumManualLink = await request(
      server,
      'POST',
      '/api/downloads/windows-x64/link',
      'premium-user-token',
    );
    assert.equal(premiumManualLink.status, 200);
    assert.equal(premiumManualLink.body.windowsReleaseMode, 'secure-v2');
    const encodedManualPayload = premiumManualLink.body.url.split('/').pop().split('.')[0];
    const manualPayload = JSON.parse(Buffer.from(encodedManualPayload, 'base64url').toString('utf8'));
    assert.equal(manualPayload.releaseId, 'test-release-1');
    assert.equal(manualPayload.sha256, installerSha256);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 1);

    const firstHead = await request(server, 'HEAD', link.body.url);
    assert.equal(firstHead.status, 200);
    assert.equal(Number(firstHead.headers['content-length']), Buffer.byteLength(installerBody));
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 1);

    const reusedDownload = await request(server, 'GET', link.body.url);
    assert.equal(reusedDownload.status, 200);
    assert.equal(reusedDownload.body, installerBody);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 1);

    fs.writeFileSync(installerPath, 'tampered-installer-with-a-different-size', 'utf8');
    const changedHead = await request(server, 'HEAD', link.body.url);
    assert.equal(changedHead.status, 500);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 2);

    const changedGet = await request(server, 'GET', link.body.url);
    assert.equal(changedGet.status, 500);
    assert.equal(changedGet.body.code, 'windows_release_integrity_mismatch');
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 2);

    fs.writeFileSync(installerPath, installerBody, 'utf8');
    const restoredHead = await request(server, 'HEAD', link.body.url);
    assert.equal(restoredHead.status, 200);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 3);
    const repeatedHead = await request(server, 'HEAD', link.body.url);
    assert.equal(repeatedHead.status, 200);
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 3);

    const { rateLimits } = windowsSecurityStateForTests();
    for (let index = 1; index < rateLimits.user; index += 1) {
      const allowedLink = await request(
        server,
        'POST',
        '/api/updates/windows/downloads/windows-x64/link',
        'free-user-token',
      );
      assert.equal(allowedLink.status, 200);
    }
    const rateLimitedLink = await request(
      server,
      'POST',
      '/api/updates/windows/downloads/windows-x64/link',
      'free-user-token',
    );
    assert.equal(rateLimitedLink.status, 429);
    assert.equal(rateLimitedLink.body.code, 'windows_download_link_rate_limited');
    assert.equal(rateLimitedLink.headers['retry-after'], '60');
    assert.equal(windowsSecurityStateForTests().integrityHashComputations, 3);

    const canonicalInstallerPath = fs.realpathSync(installerPath);
    const swapBackupPath = `${canonicalInstallerPath}.verified-fd-backup`;
    const originalCreateReadStream = fs.createReadStream;
    let swappedBeforeDelivery = false;
    fs.createReadStream = function createReadStreamWithDeterministicSwap(streamPath, options) {
      if (!swappedBeforeDelivery
          && streamPath === canonicalInstallerPath
          && Number.isInteger(options?.fd)
          && options.autoClose === true) {
        fs.renameSync(canonicalInstallerPath, swapBackupPath);
        fs.writeFileSync(canonicalInstallerPath, 'evil-installer', 'utf8');
        swappedBeforeDelivery = true;
      }
      return originalCreateReadStream(streamPath, options);
    };
    try {
      const raceSafeDownload = await request(server, 'GET', link.body.url);
      assert.equal(raceSafeDownload.status, 200);
      assert.equal(raceSafeDownload.body, installerBody);
      assert.equal(swappedBeforeDelivery, true);
    } finally {
      fs.createReadStream = originalCreateReadStream;
      if (fs.existsSync(canonicalInstallerPath)) fs.rmSync(canonicalInstallerPath);
      if (fs.existsSync(swapBackupPath)) fs.renameSync(swapBackupPath, canonicalInstallerPath);
    }

    const partialSigned = JSON.stringify({
      ...JSON.parse(signed),
      arches: { x64: JSON.parse(signed).arches.x64 },
    });
    fs.writeFileSync(manifestPath, JSON.stringify({
      signed: partialSigned,
      signature: signManifest(partialSigned),
    }), 'utf8');
    const partialManifest = await request(server, 'GET', '/api/updates/windows', 'free-user-token');
    assert.equal(partialManifest.status, 500);
    assert.match(partialManifest.body.message, /přesně arm64, x64 a x86/);

    fs.writeFileSync(manifestPath, JSON.stringify({ signed, signature }), 'utf8');
    const nextRelease = path.join(testReleasesRoot, 'test-release-2');
    fs.mkdirSync(nextRelease);
    fs.writeFileSync(path.join(nextRelease, 'MovlySetup-x64.exe'), 'new-release-installer');
    fs.writeFileSync(path.join(nextRelease, 'windows-manifest.json'), JSON.stringify({ signed, signature }));
    const nextLink = path.join(testStorageRoot, '.downloads-next');
    fs.symlinkSync(nextRelease, nextLink, 'dir');
    fs.renameSync(nextLink, testDownloadRoot);
    const pinnedDownload = await request(server, 'GET', link.body.url);
    assert.equal(pinnedDownload.status, 200);
    assert.equal(pinnedDownload.body, installerBody);
  } finally {
    global.fetch = originalFetch;
    resetWindowsSecurityStateForTests();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (fs.existsSync(testDownloadRoot)) fs.rmSync(testDownloadRoot);
    fs.symlinkSync(testActiveRelease, testDownloadRoot, 'dir');
    const activeManifest = path.join(testActiveRelease, 'windows-manifest.json');
    const activeInstaller = path.join(testActiveRelease, 'MovlySetup-x64.exe');
    if (fs.existsSync(activeManifest)) fs.rmSync(activeManifest);
    if (fs.existsSync(activeInstaller)) fs.rmSync(activeInstaller);
    const nextRelease = path.join(testReleasesRoot, 'test-release-2');
    if (fs.existsSync(nextRelease)) fs.rmSync(nextRelease, { recursive: true });
  }
});

test('Přímý web upload je explicitně zrušený a nic nezapíše', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const targetPath = path.join(testDownloadRoot, 'MovlySetup-arm64.exe');
  try {
    const retired = await request(
      server,
      'PUT',
      '/api/upload/MovlySetup-arm64.exe',
      null,
      '123456789',
    );
    assert.equal(retired.status, 410);
    assert.match(retired.body.message, /zrušen/);
    assert.equal(fs.existsSync(targetPath), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    if (fs.existsSync(targetPath)) fs.rmSync(targetPath);
  }
});

test('Příliš velké JSON tělo vrátí 413 bez resetu spojení', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await request(
      server,
      'POST',
      '/api/auth/login',
      null,
      JSON.stringify({ username: 'user', password: 'x'.repeat(70 * 1024) }),
    );
    assert.equal(response.status, 413);
    assert.match(response.body.message, /příliš velký/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Aktivační stránka je dostupná na čisté /activate URL', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await request(server, 'GET', '/activate?user_code=ABCDE-FGHJK');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.body, /Připojit televizi/);
    assert.match(response.body, /activate\.js/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Správa zařízení je dostupná na čisté /devices URL', async () => {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  try {
    const response = await request(server, 'GET', '/devices');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-type'], /text\/html/);
    assert.match(response.body, /Zařízení a přihlášení/);
    assert.match(response.body, /devices\.js/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Proxy aktivace přijímá jen kanonický JSON a validuje odpověď API', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/auth/device/preview')) {
      return new Response(JSON.stringify({
        status: 'pending',
        display_name: 'Obývací pokoj',
        platform: 'android',
        device_type: 'tv',
        app_version: '2.0.0',
        expires_at: '2026-07-15T12:10:00Z',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith('/v1/auth/device/approve')) {
      return new Response(JSON.stringify({ status: 'approved', unexpected: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ message: 'unexpected test route' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const token = '0123456789abcdef0123456789abcdef';
  const canonicalBody = '{"user_code":"ABCDE-FGHJK"}';
  try {
    const missingContentType = await request(
      server,
      'POST',
      '/api/device-authorization/preview',
      token,
      canonicalBody,
    );
    assert.equal(missingContentType.status, 415);
    assert.equal(calls.length, 0);

    const duplicateKey = await request(
      server,
      'POST',
      '/api/device-authorization/preview',
      token,
      '{"user_code":"ABCDE-FGHJK","user_code":"ABCDE-FGHJK"}',
      { 'Content-Type': 'application/json' },
    );
    assert.equal(duplicateKey.status, 400);
    assert.equal(calls.length, 0);

    const preview = await request(
      server,
      'POST',
      '/api/device-authorization/preview',
      token,
      canonicalBody,
      { 'Content-Type': 'application/json' },
    );
    assert.equal(preview.status, 200);
    assert.equal(preview.body.display_name, 'Obývací pokoj');
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /\/v1\/auth\/device\/preview$/);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(calls[0].options.headers['Api-Key'], 'test-api-key');
    assert.deepEqual(JSON.parse(calls[0].options.body), { user_code: 'ABCDE-FGHJK' });

    const invalidDecisionContract = await request(
      server,
      'POST',
      '/api/device-authorization/approve',
      token,
      canonicalBody,
      { 'Content-Type': 'application/json; charset=utf-8' },
    );
    assert.equal(invalidDecisionContract.status, 502);
    assert.match(invalidDecisionContract.body.message, /nepotvrdilo očekávaný stav approved/);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Správa zařízení proxyuje přesné kontrakty, stránkování a mutace', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  const deviceID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const sessionID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const timestamp = '2026-07-15T12:00:00Z';
  const device = {
    id: deviceID,
    display_name: 'Obývací pokoj',
    platform: 'android-tv',
    device_type: 'tv',
    app_version: '2.4.0',
    created_at: timestamp,
    last_seen_at: timestamp,
    is_current: true,
  };
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/auth/devices?limit=2&offset=0')) {
      return new Response(JSON.stringify({
        devices: [device], total: 1, limit: 2, offset: 0, has_more: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (String(url).endsWith('/v1/auth/sessions?limit=50&offset=0')) {
      return new Response(JSON.stringify({
        sessions: [{
          id: sessionID,
          device_id: deviceID,
          device_name: 'Obývací pokoj',
          device_type: 'tv',
          created_at: timestamp,
          last_seen_at: timestamp,
          idle_expires_at: '2026-08-15T12:00:00Z',
          absolute_expires_at: '2026-10-15T12:00:00Z',
          is_active: true,
          is_current: true,
        }],
        total: 1,
        limit: 50,
        offset: 0,
        has_more: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (String(url).endsWith(`/v1/auth/devices/${deviceID}`) && options.method === 'PATCH') {
      return new Response(JSON.stringify({ ...device, display_name: 'Ložnice' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if ((String(url).endsWith(`/v1/auth/devices/${deviceID}`) || String(url).endsWith(`/v1/auth/devices/${deviceID}?purge=true`))
        && options.method === 'DELETE') {
      return new Response(null, { status: 204 });
    }
    return new Response(JSON.stringify({ message: 'unexpected test route' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const token = '0123456789abcdef0123456789abcdef';
  try {
    const duplicatePagination = await request(server, 'GET', '/api/devices?limit=2&limit=3', token);
    assert.equal(duplicatePagination.status, 400);
    assert.equal(calls.length, 0);

    const devices = await request(server, 'GET', '/api/devices?limit=2&offset=0', token);
    assert.equal(devices.status, 200);
    assert.equal(devices.headers['cache-control'], 'no-store');
    assert.equal(devices.body.devices[0].id, deviceID);
    assert.equal(calls[0].options.headers.Authorization, `Bearer ${token}`);
    assert.equal(calls[0].options.headers['Api-Key'], 'test-api-key');

    const sessions = await request(server, 'GET', '/api/sessions', token);
    assert.equal(sessions.status, 200);
    assert.equal(sessions.body.sessions[0].id, sessionID);

    const nonCanonicalRename = await request(
      server,
      'PATCH',
      `/api/devices/${deviceID}`,
      token,
      '{"display_name": "Ložnice"}',
      { 'Content-Type': 'application/json' },
    );
    assert.equal(nonCanonicalRename.status, 400);
    assert.equal(calls.length, 2);

    const renamed = await request(
      server,
      'PATCH',
      `/api/devices/${deviceID}`,
      token,
      '{"display_name":"Ložnice"}',
      { 'Content-Type': 'application/json' },
    );
    assert.equal(renamed.status, 200);
    assert.equal(renamed.body.display_name, 'Ložnice');
    assert.deepEqual(JSON.parse(calls[2].options.body), { display_name: 'Ložnice' });

    const revoked = await request(server, 'DELETE', `/api/devices/${deviceID}`, token);
    assert.equal(revoked.status, 204);
    assert.equal(revoked.body, null);

    const uppercaseID = await request(server, 'DELETE', `/api/devices/${deviceID.toUpperCase()}`, token);
    assert.equal(uppercaseID.status, 400);
    assert.equal(calls.length, 4);

    // Odstranit = purge=true se propaguje přesně; jiné hodnoty a cizí parametry padají fail-closed.
    const purged = await request(server, 'DELETE', `/api/devices/${deviceID}?purge=true`, token);
    assert.equal(purged.status, 204);
    assert.equal(calls.length, 5);
    assert.ok(calls[4].url.endsWith(`/v1/auth/devices/${deviceID}?purge=true`));
    const invalidPurge = await request(server, 'DELETE', `/api/devices/${deviceID}?purge=maybe`, token);
    assert.equal(invalidPurge.status, 400);
    const unknownParam = await request(server, 'DELETE', `/api/devices/${deviceID}?force=true`, token);
    assert.equal(unknownParam.status, 400);
    const sessionPurge = await request(server, 'DELETE', `/api/sessions/${sessionID}?purge=true`, token);
    assert.equal(sessionPurge.status, 400);
    assert.equal(calls.length, 5);
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Správa zařízení odmítne nekonzistentní upstream a neuhodne Retry-After', async () => {
  const originalFetch = global.fetch;
  let mode = 'contract';
  global.fetch = async () => {
    if (mode === 'contract') {
      return new Response(JSON.stringify({
        devices: [], total: 1, limit: 50, offset: 0, has_more: false,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ message: 'rate limited' }), {
      status: 429,
      headers: mode === 'valid-rate' ? { 'Content-Type': 'application/json', 'Retry-After': '17' } : { 'Content-Type': 'application/json' },
    });
  };

  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const token = '0123456789abcdef0123456789abcdef';
  try {
    const inconsistent = await request(server, 'GET', '/api/devices', token);
    assert.equal(inconsistent.status, 502);
    assert.match(inconsistent.body.message, /nekonzistentní stránku/);

    mode = 'missing-rate';
    const missingRetryAfter = await request(server, 'GET', '/api/devices', token);
    assert.equal(missingRetryAfter.status, 502);
    assert.match(missingRetryAfter.body.message, /Retry-After/);

    mode = 'valid-rate';
    const rateLimited = await request(server, 'GET', '/api/devices', token);
    assert.equal(rateLimited.status, 429);
    assert.equal(rateLimited.headers['retry-after'], '17');
  } finally {
    global.fetch = originalFetch;
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test('Webová aplikace zveřejní jen shell a chrání serverové zdroje', async () => {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const route of ['/app', '/app/']) {
      const response = await request(server, 'GET', route);
      assert.equal(response.status, 200);
      assert.match(response.body, /app\/main.js/);
      assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
    }
    const anonymous = await request(server, 'GET', '/api/app/main');
    assert.equal(anonymous.status, 401);
    assert.equal(anonymous.headers['cache-control'], 'no-store');
    for (const route of ['/app-server.js', '/app-server.test.js', '/app-data.test.js', '/test-support/app-fixture.cjs', '/design/catalog-concept.png']) {
      assert.equal((await request(server, 'GET', route)).status, 404, route);
    }
    assert.equal((await request(server, 'GET', '/app/main.js')).headers['cache-control'], 'no-cache');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
