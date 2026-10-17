// Watch Party: webový přehrávač sleduje hodiny místnosti (#146).
//
// Port „připraveného seeku“ z Android #915 a Apple #1073/#1078 pro HTML5/hls.js.
// Seek v hrající místnosti video pozastaví a přistane o naměřenou rezervu
// napřed. play() přijde, až je přistání načtené a hodiny místnosti k němu
// dojdou (bez doby startu). Opožděné přistání dostane nejvýš jeden retry,
// start jedno ověření a velký trvalý drift nejvýš dva nové seeky na jednu
// trajektorii místnosti. Smyčka seeků proto nevznikne. Malý ustálený drift
// doladí rychlost ±5 %. Cíl v načteném bufferu se dorovná přímo (MSE seek
// v bufferu je levný); pauza s malou odchylkou mimo buffer nic nenačítá.
// Čistý stavový automat: přehrávač provede každý krok (seek, pak play/pause,
// pak rychlost). Čas `now` je monotónní v ms, pozice jsou sekundy titulu.

export const PARTY_SYNC = Object.freeze({
  tolerance: 0.3, // nad tímto driftem začne slew
  slewStop: 0.1, // slew končí pod touto odchylkou
  slewFraction: 0.05,
  prepare: 1, // změna trajektorie místnosti připraví seek jen nad touto odchylkou
  bufferedNudge: 0.3, // přímý seek v bufferu nad touto odchylkou po změně trajektorie
  pausedBuffered: 0.3, // pozastavená místnost: seek v bufferu
  pausedUnbuffered: 1, // pozastavená místnost: seek mimo buffer (načítání) až nad touto odchylkou
  waitingTolerance: 0.5, // čekání na start musí stát na přesné pozici (připravenost ≤ 0,5 s)
  jumpTolerance: 0.5, // přepočet hodin do této odchylky není změna trajektorie
  loadedTolerance: 0.5,
  retryLate: 1, // přistání opožděné víc než o tolik dostane jeden retry
  verify: 1, // start mimo místnost o víc než tolik dostane jedno ověření
  settleMs: 1000,
  largeDrift: 2,
  largeDriftHoldMs: 2000,
  maxDriftResyncs: 2,
  timeoutMs: 20000,
  productionTimeoutMs: 60000, // čekání na výrobu serveru, dokud postupuje
  productionStallMs: 8000,
  productionMargin: 1, // přistání musí být vyrobené s touto rezervou
  startTimeoutMs: 5000,
  defaultSeekLatency: { buffered: 0.1, unbuffered: 1.5 },
  maxSeekLatency: 6,
  defaultStartLatency: 0.15,
  maxStartLatency: 1.5,
  leadMargin: 0.2,
  minLead: 0.3,
  maxLead: 8,
  endGuard: 3,
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
// Dolní medián posledních tří vzorků (jako Windows/Apple).
const median = (list, fallback) => (list.length ? [...list].sort((a, b) => a - b)[(list.length - 1) >> 1] : fallback);

export function bufferedAt(ranges, time, ahead = 1) {
  if (!Array.isArray(ranges) || !Number.isFinite(time)) return false;
  return ranges.some(([start, end]) => time >= start - 0.05 && time + ahead <= end);
}

export function createPartyFollower(config = PARTY_SYNC) {
  const c = config;
  let pending = null;
  let last = null;
  const seekSamples = { buffered: [], unbuffered: [] };
  const startSamples = [];
  let pausedSeek = null;
  let settledAt = null;
  let verifyDue = false;
  let verifyUsed = false;
  let driftSince = null;
  let driftResyncs = 0;
  let slew = 1;

  const startLatency = () => median(startSamples, c.defaultStartLatency);
  const lead = (buffered) =>
    clamp(median(seekSamples[buffered ? "buffered" : "unbuffered"], c.defaultSeekLatency[buffered ? "buffered" : "unbuffered"])
      + startLatency() + c.leadMargin, c.minLead, c.maxLead);
  const record = (list, value, max) => {
    list.push(clamp(value, 0, max));
    if (list.length > 3) list.splice(0, list.length - 3);
  };
  const step = (play, seekTo = null, diagnostic = null) => ({ seekTo, play, rate: play ? slew : 1, diagnostic });

  // Skok trajektorie je změna stavu místnosti (pauza, seek); přepočet hodin
  // v toleranci jím není.
  function follow(now, target, playing) {
    let jumped = true;
    let delta = 0;
    if (last) {
      const expected = last.target + (last.playing ? (now - last.now) / 1000 : 0);
      delta = target - expected;
      jumped = last.playing !== playing || Math.abs(delta) > c.jumpTolerance;
    }
    const resumed = Boolean(last && !last.playing && playing);
    last = { now, target, playing };
    if (jumped) {
      driftSince = null;
      driftResyncs = 0;
      verifyUsed = false;
    }
    return { jumped, resumed, delta };
  }

  function begin(now, target, input, retry, reason) {
    let landing = Math.max(0, target);
    const buffered = bufferedAt(input.buffered, landing);
    landing += lead(buffered);
    if (Number.isFinite(input.duration) && input.duration > 0) landing = Math.min(landing, Math.max(0, input.duration - c.endGuard));
    pending = { landing, startedAt: now, seekAt: now, retry, buffered, loadedAt: null, releasedAt: null, production: null };
    slew = 1;
    settledAt = null;
    const label = `prepared_seek ${reason} target=${target.toFixed(2)} landing=${landing.toFixed(2)}${buffered ? " buffered" : ""}${retry ? " retry" : ""}`;
    if (!buffered && Number.isFinite(input.produced) && landing + c.productionMargin > input.produced) {
      // Cíl ještě není vyrobený a seek mimo `seekable` by prohlížeč přistřihl
      // k okraji. Jeden seek k okraji nechá hls.js načítat nové segmenty
      // (server tak pokračuje ve výrobě) a přistání přijde, až bude vyrobené.
      pending.production = { since: now, produced: input.produced, progressAt: now };
      return step(false, Math.max(0, input.produced - 0.5), `${label} await_production produced=${input.produced.toFixed(2)}`);
    }
    return step(false, landing, label);
  }

  function settle(now) {
    pending = null;
    settledAt = now;
    verifyDue = true;
  }

  function tick(input) {
    const { now, position, seeking, ready, playing, target, roomPlaying, waiting } = input;
    const { jumped, resumed } = follow(now, target, roomPlaying);
    const known = Number.isFinite(position);
    if (!roomPlaying) {
      // Pozastavená místnost je pevný cíl: nejvýš jeden seek na cíl. Malá
      // odchylka mimo buffer nic nenačítá, rozdíl pauzy se při pokračování
      // vyrovná slewem.
      pending = null;
      slew = 1;
      settledAt = null;
      verifyDue = false;
      if (jumped) pausedSeek = null;
      if (!known || seeking || pausedSeek === target) return step(false);
      const offsetAbs = Math.abs(position - target);
      const limit = waiting ? c.waitingTolerance : bufferedAt(input.buffered, target, 0.2) ? c.pausedBuffered : c.pausedUnbuffered;
      if (offsetAbs <= limit) return step(false);
      pausedSeek = target;
      return step(false, Math.max(0, target), `paused_seek target=${target.toFixed(2)} offset=${offsetAbs.toFixed(2)}`);
    }
    pausedSeek = null;

    if (pending) {
      if (jumped && !resumed) return begin(now, target, input, false, "room_jump");
      if (pending.production) {
        const wait = pending.production;
        if (Number.isFinite(input.produced) && input.produced > wait.produced + 0.1) {
          wait.produced = input.produced;
          wait.progressAt = now;
        }
        if (now - wait.since > c.productionTimeoutMs || now - wait.progressAt > c.productionStallMs) {
          settle(now);
          return step(true, null, "prepared_seek abandoned production");
        }
        // Hodiny místnosti mezitím běží: přistání se posouvá, dokud ho výroba nepředběhne.
        const landing = Math.max(pending.landing, target + lead(false));
        if (!Number.isFinite(input.produced) || landing + c.productionMargin > input.produced) return step(false);
        pending.production = null;
        pending.landing = landing;
        pending.seekAt = now;
        return step(false, landing, `prepared_seek produced landing=${landing.toFixed(2)} wait_ms=${Math.round(now - wait.since)}`);
      }
      if (now - pending.seekAt > c.timeoutMs) {
        settle(now);
        return step(true, null, "prepared_seek abandoned timeout");
      }
      const late = target + startLatency() - pending.landing;
      if (!pending.loadedAt) {
        if (known && !seeking && ready && Math.abs(position - pending.landing) <= c.loadedTolerance) {
          pending.loadedAt = now;
          record(seekSamples[pending.buffered ? "buffered" : "unbuffered"], (now - pending.seekAt) / 1000, c.maxSeekLatency);
        } else {
          if (late > c.retryLate && !pending.retry) {
            // Načtení trvá déle, než rezerva počítala: jeden retry s naměřenou dobou.
            record(seekSamples[pending.buffered ? "buffered" : "unbuffered"], (now - pending.seekAt) / 1000 + late, c.maxSeekLatency);
            return begin(now, target, input, true, `retry late=${late.toFixed(2)}`);
          }
          return step(false);
        }
      }
      if (!pending.releasedAt) {
        if (late < 0) return step(false);
        if (late > c.retryLate && !pending.retry) return begin(now, target, input, true, `retry late=${late.toFixed(2)}`);
        pending.releasedAt = now;
        return step(true, null, `prepared_seek release late=${late.toFixed(2)} hold_ms=${now - pending.startedAt}`);
      }
      const advanced = known ? position - pending.landing : 0;
      if (advanced > 0.05) {
        const startedAt = now - Math.min(advanced * 1000, now - pending.releasedAt);
        record(startSamples, (startedAt - pending.releasedAt) / 1000, c.maxStartLatency);
        const releasedAt = pending.releasedAt;
        settle(now);
        return step(true, null, `prepared_seek playing start_ms=${Math.round(startedAt - releasedAt)}`);
      }
      if (now - pending.releasedAt > c.startTimeoutMs) {
        settle(now);
        return step(true, null, "prepared_seek abandoned no_start");
      }
      return step(true);
    }

    if (!known) return step(true);
    const drift = position - target;
    if (jumped && !seeking) {
      // Změna trajektorie (pokračování, seek hosta): cíl v bufferu se dorovná
      // přímo, jinak připravený seek. Malý rozdíl po pokračování doladí slew.
      if (Math.abs(drift) > c.bufferedNudge && bufferedAt(input.buffered, target + 0.1, 0.5) && (playing || resumed)) {
        settledAt = now;
        verifyDue = true;
        const landing = target + median(seekSamples.buffered, c.defaultSeekLatency.buffered);
        return step(true, landing, `buffered_seek target=${target.toFixed(2)} drift=${drift.toFixed(2)}`);
      }
      if (Math.abs(drift) > c.prepare) return begin(now, target, input, false, resumed ? "resume" : "room_jump");
      if (resumed) {
        settledAt = now;
        verifyDue = true;
        return step(true, null, `resume drift=${drift.toFixed(2)}`);
      }
    }
    if (!playing || seeking || (settledAt !== null && now - settledAt < c.settleMs)) return step(true);
    if (verifyDue) {
      verifyDue = false;
      if (Math.abs(drift) > c.verify && !verifyUsed) {
        verifyUsed = true;
        return begin(now, target, input, true, `verify drift=${drift.toFixed(2)}`);
      }
    }
    if (Math.abs(drift) > c.largeDrift) {
      if (driftSince === null) driftSince = now;
      if (now - driftSince >= c.largeDriftHoldMs && driftResyncs < c.maxDriftResyncs) {
        driftResyncs++;
        driftSince = null;
        return begin(now, target, input, false, `drift=${drift.toFixed(2)}`);
      }
    } else driftSince = null;
    if (slew === 1 ? Math.abs(drift) > c.tolerance : Math.abs(drift) < c.slewStop || Math.sign(drift) === Math.sign(slew - 1))
      slew = slew === 1 ? (drift < 0 ? 1 + c.slewFraction : 1 - c.slewFraction) : 1;
    return step(true);
  }

  return {
    tick,
    get active() { return pending !== null; },
    get lead() { return lead(false); },
  };
}
