'use strict';

const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { test } = require('node:test');
const { HttpError, readRequestBody, readCanonicalDeviceUserCode, readCanonicalJSONObject } = require('./http-request');

function request(contentType = 'application/json') {
  const req = new PassThrough();
  req.headers = { 'content-type': contentType };
  return req;
}

async function parse(reader, text) {
  const req = request();
  const result = reader(req);
  req.end(text);
  return result;
}

const variants = [
  { name: 'general JSON', read: (req) => readRequestBody(req, 64), limit: 64 },
  { name: 'device code', read: readCanonicalDeviceUserCode, limit: 256 },
  { name: 'canonical object', read: (req) => readCanonicalJSONObject(req, ['value'], 64, 'Úprava'), limit: 64 },
];

function status(code) {
  return (error) => error instanceof HttpError && error.status === code;
}

test('JSON decoding preserves UTF-8 split across chunks and the exact byte limit', async () => {
  const payload = Buffer.from('{"value":"žluťoučký"}');
  const req = request();
  const result = readRequestBody(req, payload.length);
  for (const byte of payload) req.write(Buffer.from([byte]));
  req.end();
  assert.deepEqual(await result, { value: 'žluťoučký' });
});

test('ordinary JSON keeps whitespace, empty-body and malformed-body behavior', async () => {
  assert.deepEqual(await parse(readRequestBody, '  '), {});
  assert.deepEqual(await parse(readRequestBody, ' {"value":1}\n'), { value: 1 });
  await assert.rejects(parse(readRequestBody, '{broken'), status(400));
});

test('device activation accepts only the exact user-code representation', async () => {
  assert.equal(await parse(readCanonicalDeviceUserCode, '{"user_code":"ABCDE-12345"}'), 'ABCDE-12345');
  for (const text of [' {"user_code":"ABCDE-12345"}', '{"user_code":"ABCDE-12345","extra":1}', '{"user_code":"abcde-12345"}', '{"user_code":"OOOOO-12345"}']) {
    await assert.rejects(parse(readCanonicalDeviceUserCode, text), status(400));
  }
});

test('canonical objects reject alternate encodings, duplicate keys and extra fields', async () => {
  const reader = (req) => readCanonicalJSONObject(req, ['value'], 128, 'Úprava');
  assert.deepEqual(await parse(reader, '{"value":1}'), { value: 1 });
  for (const text of ['{"value": 1}', '{"value":1,"value":1}', '{"value":1.0}', '{"value":1,"extra":2}', '[]', 'null']) {
    await assert.rejects(parse(reader, text), status(400));
  }
});

test('content type and invalid contracts still fail synchronously', () => {
  for (const reader of [readCanonicalDeviceUserCode, variants[2].read]) {
    assert.throws(() => reader(request('text/plain')), status(415));
  }
  assert.throws(() => readCanonicalJSONObject(request(), [], 64, 'Úprava'), status(500));
  assert.throws(() => readCanonicalJSONObject(request(), ['value'], 0, 'Úprava'), status(500));
});

for (const variant of variants) {
  test(`${variant.name}: oversize bodies drain without destroying the stream`, async () => {
    const req = request();
    const result = variant.read(req);
    const rejected = assert.rejects(result, status(413));
    req.write(Buffer.alloc(variant.limit + 1, 'x'));
    req.emit('error', new Error('late failure'));
    req.end('ignored tail');
    await rejected;
    assert.equal(req.destroyed, false);
  });

  test(`${variant.name}: abort and transport failures reject once`, async () => {
    for (const event of ['aborted', 'error']) {
      const req = request();
      const result = variant.read(req);
      const rejected = assert.rejects(result, status(400));
      req.write('{');
      req.emit(event, new Error('connection lost'));
      req.end('}');
      await rejected;
    }
  });
}
