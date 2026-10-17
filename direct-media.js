"use strict";
// Přes server nesmí jít žádné video (#153): server jen vyhledá a resolvuje
// zdroj a prohlížeči vrátí přímý odkaz poskytovatele. Zdroj, který prohlížeč
// sám otevřít nemůže, se přehraje jen v aplikaci.

// Odkazy těchto poskytovatelů platí jen pro IP adresu, ze které je resolvoval
// server (ověřeno 17. 10. 2026: VOE 403, Streamtape HTML stránka, ČT 401
// max-ip-address-count-reached).
const ipBoundProvider = /^(?:voe|streamtape|ct|ceskatelevize)$/;
// User-Agent si prohlížeč nastaví sám; jiné hlavičky (Referer, Cookie,
// Authorization…) prohlížeč u <video> poslat nemůže.
const droppableHeader = /^user-agent$/i;

const providerKey = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[̀-ͯ ._-]/g, "")
    .toLowerCase();

function appRequired(reason) {
  return Object.assign(
    new Error(
      "Tento zdroj nejde přehrát přímo v prohlížeči. Otevři ho v aplikaci Movly, nebo zkus jiný zdroj.",
    ),
    { status: 422, code: "app_required", reason },
  );
}

function directSource(link, headers, provider) {
  let url;
  try {
    url = new URL(link);
  } catch {
    throw appRequired("invalid_link");
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw appRequired("insecure_link");
  if (ipBoundProvider.test(providerKey(provider))) throw appRequired("ip_bound");
  for (const [name, value] of Object.entries(headers || {}))
    if (value !== undefined && value !== null && value !== "" && !droppableHeader.test(name))
      throw appRequired("headers");
  return {
    direct: true,
    url: url.href,
    kind: /\.m3u8$/i.test(url.pathname) ? "hls" : "file",
  };
}

module.exports = { directSource, appRequired, providerKey };
