// Sdílené formátování hodnocení a kvality (DESIGN §10): „92 %“ s nezlomitelnou
// mezerou a štítky 4K / HD místo surového rozlišení.
export function ratingPercent(value) {
  const number = Number(value);
  if (value === null || value === undefined || value === "" || !Number.isFinite(number)) return null;
  return Math.round(Math.min(100, Math.max(0, number)));
}
export function formatRating(value) {
  const percent = ratingPercent(value);
  return percent === null ? null : `${percent} %`;
}
// Štítek kvality podle rozměrů videa; pod HD se štítek nezobrazuje.
export function qualityLabel(height, width = 0) {
  const h = Number(height) || 0, w = Number(width) || 0;
  if (w >= 3800 || h >= 2100) return "4K";
  if (w >= 1200 || h >= 700) return "HD";
  return null;
}
// Štítek kvality z textového rozlišení ("2160p", "1080p", "4K").
export function qualityFromResolution(value) {
  const text = String(value || "").trim();
  if (/^(?:4k|uhd)$/i.test(text)) return "4K";
  const match = /^(\d{3,4})p$/i.exec(text);
  return match ? qualityLabel(Number(match[1])) : null;
}
export function hdrLabel(type) {
  const text = String(type || "").trim();
  return text && !/^sdr$/i.test(text) ? "HDR" : null;
}
// Název žánru podle jazyka rozhraní; API posílá `name_cs` a obecné `name`
// (anglicky), slovenština bere český název, pokud chybí vlastní.
export function genreName(genre, language = "cs") {
  if (!genre) return "";
  const own = genre[`name_${language}`];
  if (typeof own === "string" && own) return own;
  if (language === "en") return genre.name || genre.name_cs || "";
  return genre.name_cs || genre.name || "";
}
