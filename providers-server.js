"use strict";
const crypto = require("node:crypto");
const hash = (kind, data) => crypto.createHash(kind).update(data).digest();
function md5crypt(password, saltInput) {
  const p = Buffer.from(password),
    salt = saltInput
      .replace(/^\$1\$/, "")
      .split("$")[0]
      .slice(0, 8),
    s = Buffer.from(salt);
  const alt = hash("md5", Buffer.concat([p, s, p])),
    chunks = [p, Buffer.from("$1$"), s];
  for (let n = p.length; n > 0; n -= 16)
    chunks.push(alt.subarray(0, Math.min(16, n)));
  for (let n = p.length; n > 0; n >>= 1)
    chunks.push(n & 1 ? Buffer.from([0]) : p.subarray(0, 1));
  let d = hash("md5", Buffer.concat(chunks));
  for (let i = 0; i < 1000; i++)
    d = hash(
      "md5",
      Buffer.concat([
        i & 1 ? p : d,
        ...(i % 3 ? [s] : []),
        ...(i % 7 ? [p] : []),
        i & 1 ? d : p,
      ]),
    );
  const alphabet =
    "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const enc = (v, n) => {
    let out = "";
    while (n--) {
      out += alphabet[v & 63];
      v >>= 6;
    }
    return out;
  };
  return (
    `$1$${salt}$` +
    [
      [0, 6, 12],
      [1, 7, 13],
      [2, 8, 14],
      [3, 9, 15],
      [4, 10, 5],
    ]
      .map(([a, b, c]) => enc((d[a] << 16) | (d[b] << 8) | d[c], 4))
      .join("") +
    enc(d[11], 2)
  );
}
const xml = (text, key) =>
  text
    .match(new RegExp(`<${key}>([\\s\\S]*?)</${key}>`))?.[1]
    ?.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
async function webshare(endpoint, body) {
  const response = await fetch(`https://webshare.cz/api/${endpoint}/`, {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body),
  });
  if (!response.ok)
    throw Object.assign(new Error("Webshare je momentálně nedostupný."), {
      status: 502,
    });
  const text = await response.text();
  if (text.length > 2000000 || xml(text, "status") !== "OK")
    throw Object.assign(
      new Error(xml(text, "message") || "Webshare požadavek odmítl."),
      { status: 422 },
    );
  return text;
}
async function login(username, password) {
  const salt = xml(
    await webshare("salt", { username_or_email: username }),
    "salt",
  );
  if (!salt) throw new Error("Webshare nevrátil přihlašovací údaje.");
  const hashed = hash("sha1", Buffer.from(md5crypt(password, salt))).toString(
    "hex",
  );
  const text = await webshare("login", {
    username_or_email: username,
    password: hashed,
    keep_logged_in: "1",
    digest: hash("md5", Buffer.from(`${username}:Webshare:${hashed}`)).toString(
      "hex",
    ),
  });
  const token = xml(text, "wst") || xml(text, "token");
  if (!token || token.length > 1024)
    throw new Error("Webshare nevrátil platnou relaci.");
  const data = await webshare("user_data", { wst: token });
  return {
    token,
    username: xml(data, "username") || username,
    vip: xml(data, "vip") === "1",
  };
}
async function resolve(token, ident) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ident || ""))
    throw Object.assign(
      new Error("Zdroj nemá platný Webshare identifikátor."),
      { status: 422 },
    );
  const link = xml(
    await webshare("file_link", {
      ident,
      wst: token,
      download_type: "video_stream",
      force_https: "1",
    }),
    "link",
  );
  if (!link)
    throw Object.assign(new Error("Webshare neposkytl odkaz k přehrání."), {
      status: 422,
    });
  return link;
}
async function searchFiles(provider, query, token) {
  if (provider === "webshare") {
    const text = await webshare("search", {
      what: query,
      wst: token,
      offset: "0",
      limit: "200",
      sort: "rating",
    });
    return [...text.matchAll(/<file>([\s\S]*?)<\/file>/g)]
      .map(([, f]) => ({
        provider_name: "Webshare",
        source_stream_id: xml(f, "ident"),
        file_name: xml(f, "name"),
        file_size: Number(xml(f, "size")) || null,
      }))
      .filter((f) => /^[a-zA-Z0-9_-]{1,128}$/.test(f.source_stream_id));
  }
  if (provider === "hellspy") {
    const response = await fetch(
      `https://api.hellspy.to/gw/search?${new URLSearchParams({ query, offset: "0", limit: "200" })}`,
      { redirect: "error", signal: AbortSignal.timeout(12000) },
    );
    if (!response.ok)
      throw new Error(`Hellspy hledání selhalo (${response.status}).`);
    const text = await response.text();
    if (text.length > 2000000)
      throw new Error("Hellspy vrátil příliš velkou odpověď.");
    const data = JSON.parse(text);
    if (!Array.isArray(data.items))
      throw new Error("Hellspy nevrátil platné výsledky.");
    return data.items
      .filter((f) => Number.isSafeInteger(f.id) && f.id > 0)
      .map((f) => ({
        provider_name: "Hellspy",
        source_stream_id: `${f.id}${typeof f.fileHash === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(f.fileHash) ? `/${f.fileHash}` : ""}`,
        file_name: f.title,
        file_size: f.size,
        available: Boolean(f.fileHash),
      }));
  }
  throw new Error("Nepodporovaný poskytovatel.");
}
module.exports = { login, resolve, md5crypt, searchFiles };
