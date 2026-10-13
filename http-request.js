'use strict';

class HttpError extends Error {
  constructor(status, message, payload) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function hasExactObjectKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.length === expectedKeys.length
    && expectedKeys.every((key) => Object.hasOwn(value, key));
}

function readRequestText(req, limitBytes, messages) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let settled = false;
    const rejectAndDrain = (error) => {
      if (settled) return;
      settled = true;
      chunks.length = 0;
      req.resume();
      reject(error);
    };
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > limitBytes) {
        rejectAndDrain(new HttpError(413, messages.tooLarge));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('aborted', () => rejectAndDrain(new HttpError(400, messages.aborted)));
    req.on('error', (error) => rejectAndDrain(new HttpError(400, messages.failed(error))));
  });
}

function readRequestBody(req, limitBytes = 64 * 1024) {
  return readRequestText(req, limitBytes, {
    tooLarge: 'Požadavek je příliš velký.',
    aborted: 'Přenos požadavku byl přerušen.',
    failed: (error) => `Přenos požadavku selhal: ${error.message}`,
  }).then((text) => {
    const raw = text.trim();
    if (!raw) {
      return {};
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(400, 'Požadavek nemá platný JSON.');
    }
  });
}

function readCanonicalDeviceUserCode(req) {
  const contentType = req.headers['content-type'];
  if (contentType !== 'application/json' && contentType !== 'application/json; charset=utf-8') {
    req.resume();
    throw new HttpError(415, 'Aktivace zařízení vyžaduje Content-Type application/json.');
  }

  return readRequestText(req, 256, {
    tooLarge: 'Aktivační požadavek je příliš velký.',
    aborted: 'Přenos aktivačního požadavku byl přerušen.',
    failed: (error) => `Přenos aktivačního požadavku selhal: ${error.message}`,
  }).then((raw) => {
    const match = /^\{"user_code":"([0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5})"\}$/.exec(raw);
    if (!match) {
      throw new HttpError(
        400,
        'Aktivační požadavek musí být přesně {"user_code":"XXXXX-XXXXX"} s platným kódem.',
      );
    }
    return match[1];
  });
}

function readCanonicalJSONObject(req, expectedKeys, limitBytes, label) {
  const contentType = req.headers['content-type'];
  if (contentType !== 'application/json' && contentType !== 'application/json; charset=utf-8') {
    req.resume();
    throw new HttpError(415, `${label} vyžaduje Content-Type application/json.`);
  }
  if (!Array.isArray(expectedKeys) || expectedKeys.length === 0
      || !Number.isSafeInteger(limitBytes) || limitBytes < 1) {
    req.resume();
    throw new HttpError(500, 'Server nemá platný kontrakt JSON požadavku.');
  }

  return readRequestText(req, limitBytes, {
    tooLarge: `${label} je příliš velký.`,
    aborted: `${label} byl během přenosu přerušen.`,
    failed: (error) => `${label} během přenosu selhal: ${error.message}`,
  }).then((raw) => {
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, `${label} nemá platný JSON.`);
    }
    if (!hasExactObjectKeys(payload, expectedKeys) || JSON.stringify(payload) !== raw) {
      throw new HttpError(
        400,
        `${label} musí být kanonický JSON přesně s poli ${expectedKeys.join(', ')}.`,
      );
    }
    return payload;
  });
}

module.exports = { HttpError, hasExactObjectKeys, readRequestBody, readCanonicalDeviceUserCode, readCanonicalJSONObject };
