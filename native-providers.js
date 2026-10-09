"use strict";
const { spawn } = require("node:child_process");
const path = require("node:path");
const supported = { test(value) { return /^(?:webshare|hellspy|fastshare|sosac|streamuj|sktorrent|sledujteto|crwiki|ceskawiki|prehrajto|stremio|bombuj|voe|mixdrop|streamtape|doodstream|streamwish|vidhide|lulustream|ct|ceskatelevize|stvr)$/.test(String(value).normalize("NFD").replace(/[\u0300-\u036f ._-]/g, "").toLowerCase()); } };
let running = 0;
async function run(request) {
  if (running >= 4) throw Object.assign(new Error("Poskytovatelé právě vyřizují jiné hledání. Zkus to za chvíli."), { status: 429 });
  running++;
  try {
    const executable = process.env.MOVLY_PROVIDER_RESOLVER || path.join(__dirname, "provider-resolver", "Movly.ProviderResolver");
    const args = executable.endsWith(".dll") ? [executable] : [];
    return await new Promise((resolve, reject) => {
      const child = spawn(args.length ? "dotnet" : executable, args, { stdio: ["pipe", "pipe", "ignore"], env: { ...process.env, DOTNET_ROLL_FORWARD: "Major" } });
      let output = "", done = false;
      const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(Object.assign(new Error("Hledání poskytovatelů překročilo časový limit."), { status: 504 })); }, 70000);
      child.stdout.on("data", chunk => { output += chunk; if (output.length > 1024 * 1024) { child.kill("SIGKILL"); finish(new Error("Poskytovatel vrátil příliš velký výsledek.")); } });
      child.on("error", () => finish(Object.assign(new Error("Resolver poskytovatelů není dostupný."), { status: 503 })));
      child.on("close", () => { try { const value = JSON.parse(output); if (value.error) throw Object.assign(new Error(value.error), { status: 422 }); finish(null, value); } catch (e) { finish(e instanceof SyntaxError ? Object.assign(new Error("Resolver poskytovatelů nevrátil platnou odpověď."), { status: 503 }) : e); } });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify(request));
    });
  } finally { running--; }
}
module.exports = { run, supported };
