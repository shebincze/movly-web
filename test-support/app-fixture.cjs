"use strict";
// Explicit, loopback-only test upstream. Never imported by the production server.
const http = require("node:http");
const films = [
  [
    1,
    "Duna: Část druhá",
    2024,
    "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
    "/xOMo8BRK7PfcJv9JCnx7s5hj0PX.jpg",
  ],
  [
    2,
    "Oppenheimer",
    2023,
    "/ptpr0kGAckfQkJeJIt8st5dglvd.jpg",
    "/fm6KqXpk3M2HVveHwCrBSSBaO0V.jpg",
  ],
  [
    3,
    "Interstellar",
    2014,
    "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg",
    "/xJHokMbljvjADYdit5fK5VQsXEG.jpg",
  ],
  [4, "Na nože", 2019, "/pThyQovXQrw2m0s9x82twj48Jq4.jpg", null],
  [5, "Blade Runner 2049", 2017, "/gajva2L0rPYkEWjzgFlBXCAVBE5.jpg", null],
  [6, "Parazit", 2019, "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", null],
  [
    7,
    "Pán prstenů: Návrat krále",
    2003,
    "/rCzpDGLbOoPwLjy3OAm5NUPOTrC.jpg",
    null,
  ],
].map(([id, title, year, poster_path, backdrop_path]) => ({
  id,
  title,
  year,
  release_date: `${year}-01-01`,
  poster_path,
  backdrop_path,
  type: "movie",
  runtime: 167,
  genres: [{ id: 1, name: "Sci-fi" }],
  overview:
    "Paul Atreides se spojí s Chani a Fremeny a zároveň se vydá na válečnou cestu pomsty proti spiklencům, kteří zničili jeho rodinu. Předurčený k volbě mezi láskou svého života a osudem známého vesmíru se snaží zabránit budoucnosti, kterou dokáže předvídat jen on.",
}));
const series = [
  ["The Last of Us", "/uKvVjHNqB5VmOrdxqAt2F7J78ED.jpg"],
  ["Rod draka", "/z2yahl2uefxDCl0nogcRBstwruJ.jpg"],
  ["Černobyl", "/hlLXt2tOPT6RRnjiUmoxyG1LTFi.jpg"],
  ["Boj o moc", "/ySA2LUKEokNwZolf5YL5ZGNTSyQ.jpg"],
  ["Stranger Things", "/49WJfeN0moxb9IPfGn8AIqMGskD.jpg"],
  ["Perníkový táta", "/3xnWaLQjelJDDF7LT1WBo6f4BRe.jpg"],
].map(([title, poster_path], i) => ({
  id: 20 + i,
  title,
  poster_path,
  type: "tv",
  year: 2023,
}));
function createFixture({ externalListCount = 0 } = {}) {
  const feedbackFixture = require("./feedback-fixture.cjs").createFeedbackFixture();
  const lists = [
      { id: 1, name: "Na víkend", item_count: 0, is_default: false },
    ],
    items = new Map([[1, []]]);
  let next = 2,
    revoked = false;
  const notificationProfiles=new Map();
  const introModes=new Map();
  const notificationSeries=new Map();
  return async function fixture(path, method, body, token, device, headers) {
    const u = new URL(path, "http://fixture/"),
      p = u.pathname.replace(/^\//, "");
    const fail = (status, message, code) => {
      throw Object.assign(new Error(message), { status, code });
    };
    const user = {
      id: 1,
      username: "test",
      display_name: "Testovací účet",
      is_active: true,
      is_verified: true,
      ...(process.env.MOVLY_FIXTURE_FEEDBACK_ADMIN === "1" ? { role: "admin" } : {}),
    };
    if (p === "v1/auth/login") {
      if (
        body.username !== "test" ||
        body.password !==
          `sha256:${require("node:crypto").createHash("sha256").update("movly-test").digest("base64")}`
      )
        fail(401, "Neplatné přihlašovací údaje.");
      revoked = false;
      return { payload: { token: "fixture-token-only", user } };
    }
    if (!token || revoked)
      fail(401, "Přihlášení vypršelo.", "invalid_or_expired_session");
    if (p.startsWith("v1/feedback/") || p.startsWith("v1/admin/feedback/")) return feedbackFixture(path, method, body);
    if(p.startsWith("v1/notifications/")) {
      const scope=p.slice("v1/notifications/".length);
      const profile=String(headers?.["X-Profile-ID"]??"");
      if(!profile)fail(409,"Vyber profil.");
      if(!notificationProfiles.has(profile))notificationProfiles.set(profile,{defaults:{events:[],channels:[],use_defaults:false}});
      let notificationDefaults=notificationProfiles.get(profile).defaults;
      const seriesScope=profile+":"+scope;
      if(scope==="inbox"||scope==="system-inbox")return {payload:{items:[]}};
      if(scope.endsWith("/read")||scope.endsWith("/delivered"))return {payload:{}};
      if(method==="PUT") {if(scope==="defaults"){notificationDefaults=structuredClone(body);notificationProfiles.get(profile).defaults=notificationDefaults;}else notificationSeries.set(seriesScope,structuredClone(body));}
      const preferences=scope==="defaults"?notificationDefaults:notificationSeries.get(seriesScope)??{events:[],channels:[],use_defaults:true};
      return {payload:{preferences,defaults:notificationDefaults,effective:{events:preferences.use_defaults?notificationDefaults.events:preferences.events,channels:notificationDefaults.channels,use_defaults:false},subscribed:notificationSeries.has(seriesScope),capabilities:{in_app:true,desktop:true,email:true,mobile_push:false}}};
    }
    if (p === "v1/auth/me") return { payload: user };
    if (p === "v1/auth/logout") {
      revoked = true;
      return { payload: { ok: true } };
    }
    if (p === "v1/profiles/avatars")
      return {
        payload: require("./default-avatars.json"),
      };
    if (p === "v1/profiles")
      return {
        payload: [
          {
            id: 1,
            name: "Testovací profil",
            has_pin: false,
            avatar_url:
              "https://res.cloudinary.com/dsnzqq6kh/image/upload/v1768089385/avatar_wolf_jrxa0y.jpg",
          },
          {
            id: 2,
            name: "Chráněný profil",
            is_kids: true, max_certification: 7, allow_unrated: false,
            has_pin: true,
            avatar_url:
              "https://res.cloudinary.com/dsnzqq6kh/image/upload/v1768089364/avatar_panda_rgtevl.jpg",
          },
        ],
      };
    if (p.endsWith("/pin/verify")) {
      if (body.pin !== "1234")
        fail(401, "Nesprávný PIN.", "invalid_profile_pin");
      return { payload: { valid: true, grant_token: "pin-grant" } };
    }
    if (p.endsWith("/select")) {
      const id = Number(p.split("/")[2]);
      if (id === 2 && headers["X-Profile-Grant"] !== "pin-grant")
        fail(403, "Zadej PIN.", "profile_grant_required");
      return {
        payload: {
          profile_id: id,
          name: id === 1 ? "Testovací profil" : "Chráněný profil",
          grant_token: `grant-${id}`,
        },
      };
    }
    if (!headers["X-Profile-ID"] || !headers["X-Profile-Grant"])
      fail(403, "Chybí profil.", "profile_grant_required");
    if (p === "v1/playback/preferences") {
      const key = headers["X-Profile-ID"];
      if (method === "PUT") introModes.set(key, body.intro_skip_mode);
      return {payload:{intro_skip_mode:introModes.get(key) || "manual"}};
    }
    if (p === "v1/playback/segments") return {payload:{duration_ms:Number(u.searchParams.get("duration_ms")),expires_at:Math.floor(Date.now()/1000)+86400,stale:false,segments:[{id:"intro:10000:70000",kind:"intro",start_ms:10000,end_ms:70000,source:"theintrodb",auto_eligible:true}]}};
    const type = u.searchParams.get("type"),
      all = type === "tv" ? series : films;
    if (p === "v1/recommendations/action") return { payload: { status: "ok" } };
    if (p === "v1/home") {
      const make = (slug, kind, name, order, values = films.slice(0, 4)) => ({
        slug, kind, name, display_order: order, content_key: `fixture:${slug}`,
        state: "ready", items: values.map(t => ({ title: t })), collections: [], premieres: [],
        pagination: { page: Number(u.searchParams.get("page") || 1), total_pages: 2 }, has_more: Number(u.searchParams.get("page") || 1) < 2,
      });
      if (headers["X-Profile-ID"] === "2") return { payload: { version: 1, sections: [make("kids-selection", "hero", "Pro dětský profil", 1, [{ id: 77, title: "Dětský výběr (testovací data)", type: "movie", year: 2020 }])] } };
      const rows = [make("personal-hero", "hero", "Výběr pro vás", 1),
        { ...make("resume", "continue", "Pokračovat ve sledování", 2, series.slice(0, 3)), items: series.slice(0, 3).map(t => ({ title: t, watch_progress: { watch_status: "watched", next_season_number: 3, next_episode_number: 1 } })) },
        make("favourites", "rail", "Můj seznam", 3),
        { ...make("collections", "collections", "Kolekce", 4, []), collections: [{ slug: "star-wars", name: "Star Wars", total_items: 8 }] },
        make("popular", "top10", "Nejsledovanější", 5)];
      const section = u.searchParams.get("section"), collection = u.searchParams.get("collection");
      return { payload: { version: 1, sections: collection ? [make(collection, "rail", "Star Wars", 1)] : section ? rows.filter(r => r.slug === section) : rows } };
    }
    if (p === "v1/themed-lists")
      return {
        payload: {
          lists: [
            {
              slug: "marvel-mcu",
              name: "Marvel",
              total_items: 82,
              banner_url:
                "https://res.cloudinary.com/dsnzqq6kh/image/upload/v1767810410/marvel-logo-marvel-icon-free-free-vector_l9gvvd.jpg",
            },
            { slug: "science-fiction", name: "Světy sci-fi", total_items: 32 },
          ],
        },
      };
    if (p.startsWith("v1/themed-lists/"))
      return {
        payload: {
          name:
            {
              "top-home": "Doporučujeme",
              "top-watched": "Nejsledovanější",
              "popular-streaming": "Populární streamy",
              "csfd-tips": "Tipy z ČSFD",
            }[p.split("/").at(-1)] || "Marvel",
          items: films.map((title) => ({
            title,
            rating: 87,
            streams: { video_height: 2160, audio_languages: ["cze"] },
          })),
          pagination: { page: 1, total_pages: 1 },
        },
      };
    // Testovací fakta titulu a hromadné označení řady (core-API #705).
    if (/^v1\/titles\/\d+\/facts$/.test(p)) {
      const id = Number(p.split("/")[2]);
      return { payload: { title_id: id, region: "CZ", age_rating: { country: "CZ", rating: "12" },
        creators: id % 2 ? [{ id: 1, name: "Testovací tvůrce", profile_path: null }] : [],
        watch_providers: [{ provider_name: "Testovací streaming", type: "flatrate", logo_path: null, link: null, display_priority: 1 },
          { provider_name: "Testovací půjčovna", type: "rent", logo_path: null, link: null, display_priority: 2 }] } };
    }
    if (p === "v1/watch-history/season" && method === "POST")
      return { payload: { title_id: body.title_id, season_number: body.season_number, watch_status: body.watch_status, episodes_updated: 1 } };
    if (/^v1\/titles\/\d+\/similar$/.test(p))
      return {
        payload: films.slice(1, 5).map((t) => ({
          ...t,
          similar_title_id: t.id,
          title: t.title,
          type: t.type,
        })),
      };
    if (p === "v1/people/50")
      return {
        payload: {
          id: 50,
          name: "Timothée Chalamet",
          biography:
            "Americký herec známý mimo jiné rolí Paula Atreida ve filmu Duna.",
          profile_path: "/BE2sdjpgsa2rNTFa66f7upkaOP.jpg",
        },
      };
    if (p === "v1/people/50/filmography")
      return {
        payload: films.slice(0, 3).map((t) => ({ ...t, title_id: t.id })),
      };
    if (p === "v1/main/")
      return {
        payload: {
          lists: [
            {
              name:
                type === "tv"
                  ? "Seriály, které stojí za pozornost"
                  : "Populární filmy",
              slug: type === "tv" ? "popular-tv" : "popular-movies",
              items: all.map((title) => ({ title })),
              has_more: false,
            },
          ],
          total_lists: 1,
        },
      };
    if (p.startsWith("v1/main/lists/"))
      return {
        payload: {
          name: "Populární filmy",
          items: films.map((title) => ({ title })),
          has_more: false,
        },
      };
    if (p === "v1/titles/genres")
      return {
        payload: {
          genres: [
            { id: 1, name: "Sci-fi" },
            { id: 2, name: "Drama" },
          ],
        },
      };
    if (p === "v1/titles/filter")
      return {
        payload: {
          results: u.searchParams.get("genre_ids") === "2" ? [] : all,
          total: all.length,
          total_pages: 1,
          page: 1,
        },
      };
    if (p === "v1/saved-filters")
      return {
        payload: {
          items: [
            {
              id: 1,
              name: "Sci-fi 2020+",
              filter: { type: "movie", genre_ids: [1], genre_match: "any", year_from: 2020, sort_by: "rating", sort_order: "desc" },
            },
          ],
        },
      };
    if (p === "v1/search/filters") {
      // Fixture interpretation of a filter query: "sci-fi 2020+ 7+" style.
      const q = (u.searchParams.get("q") || "").toLowerCase();
      const matched = /sci|drama|20\d\d|\d\+|4k|hdr|\bcz\b/.test(q);
      return {
        payload: {
          results: matched ? films : [],
          total: matched ? films.length : 0,
          total_pages: matched ? 1 : 0,
          page: 1,
          parsed: {
            matched,
            genre_names: matched && /sci/.test(q) ? ["Sci-Fi"] : [],
            year_from: /2020/.test(q) ? 2020 : null,
            rating_from: /7\+/.test(q) ? 7 : null,
            video_height_min: /4k/.test(q) ? 2160 : null,
            hdr: /hdr/.test(q),
            audio_language: /\bcz\b/.test(q) ? "cs" : null,
            text: "",
          },
        },
      };
    }
    if (p === "v1/search") {
      const q = u.searchParams.get("q")?.toLowerCase();
      const results = [...films, ...series].filter((t) =>
        t.title.toLowerCase().includes(q),
      );
      return { payload: { results, total: results.length, took: 1 } };
    }
    if (/^v1\/titles\/\d+$/.test(p)) {
      const t = [...films, ...series].find(
        (t) => t.id === Number(p.split("/")[2]),
      );
      if (!t) fail(404, "Titul neexistuje.");
      return {
        payload: {
          ...t,
          tagline: "Osud celého vesmíru je v jeho rukou.",
          original_title: t.type === "movie" ? "Dune: Part Two" : t.title,
          ratings: [
            { source: "ČSFD", rating: 87 },
            { source: "IMDb", rating: 85 },
          ],
          videos: [
            {
              site: "YouTube",
              key: "Way9Dexny3w",
              type: "Trailer",
              language: "cs",
              official: true,
            },
          ],
          collection: t.type === "movie" ? films.slice(0, 3) : [],
          collection_info: { id: 1, name: "Duna · kolekce" },
          credits: [
            {
              person_id: 50,
              name: "Timothée Chalamet",
              character: "Paul Atreides",
              profile_path: "/BE2sdjpgsa2rNTFa66f7upkaOP.jpg",
            },
          ],
          seasons:
            t.type === "tv"
              ? [
                  {
                    season_number: 1,
                    name: "Řada 1",
                    episode_count: 2,
                    episodes: [
                      {
                        id: 2001,
                        episode_number: 1,
                        name: "Když se ztratíš ve tmě",
                        overview: "Začátek společné cesty.",
                      },
                      { id: 2002, episode_number: 2, name: "Nakažení" },
                    ],
                  },
                ]
              : [],
        },
      };
    }
    if (p === "v1/integrations/trakt/lists") {
      const lists = [
        {id:"watchlist",name:"Watchlist",description:"",items:[{id:"a",name:"Dune: Part Two",kind:"movie",year:2024,tmdb_id:693134,imdb_id:""},{id:"b",name:"The Big Bang Theory",kind:"tv",year:2007,tmdb_id:1418,imdb_id:""}]},
        {id:"fixture-large",name:"Testovací seznam",description:"Izolovaná testovací data",items:Array.from({length:25},(_,i)=>({id:String(i),name:"English title "+i,kind:"movie",year:2024,tmdb_id:693134+i,imdb_id:""}))},
      ];
      for (let list = 0; list < externalListCount; list++) lists.push({id:`fixture-preview-${list}`,name:`Preview ${list+1}`,description:"Synthetic preview",items:Array.from({length:3},(_,item)=>({id:`${list}-${item}`,name:`Preview title ${list+1}-${item+1}`,kind:"movie",year:2024,tmdb_id:700000+list*3+item,imdb_id:""}))});
      return { payload: {provider:"trakt", status:"ready", notice:"", retry_at:null, lists} };
    }
    if (p === "v1/integrations/simkl/lists") return { payload:{provider:"simkl",status:externalListCount ? "ready" : "rate_limited",notice:"",retry_at:externalListCount ? null : "2026-10-12T04:00:00Z",lists:Array.from({length:externalListCount},(_,list)=>({id:`custom:${list+1}`,name:`Simkl Preview ${list+1}`,description:"Synthetic preview",items:Array.from({length:3},(_,item)=>({id:`${list}-${item}`,name:`Preview title ${list+1}-${item+1}`,kind:"movie",year:2024,tmdb_id:800000+list*3+item,imdb_id:""}))}))} };
    if (p === "v1/titles/batch" && method === "POST") return {payload:{results:(body.items || []).map((identity,index)=>{
      const tv=identity.type==="tv", tmdbID=identity.tmdb_id;
      const name=tv?"Teorie velkého třesku":tmdbID===693134?"Duna: Část druhá":"Český titul "+tmdbID;
      const english=tv?"The Big Bang Theory":tmdbID===693134?"Dune: Part Two":"English title "+tmdbID;
      return {index,type:identity.type,tmdb_id:tmdbID,status:"found",title:{id:10000+tmdbID+(tv?1000:0),tmdb_id:tmdbID,type:identity.type,title:body.language==="en"?english:name,original_title:english,all_titles:{cs:name,en:english},...(tmdbID>=700000?{poster_path:"/assets/movly-icon-512.png"}:{})}};
    })}};
    if (/^v1\/tmdb\/\d+$/.test(p)) {
      const id=Number(p.split("/").at(-1)); const tv=u.searchParams.get("type")==="tv";
      const name=tv?"Teorie velkého třesku":id===693134?"Duna: Část druhá":"Český titul "+id;
      return {payload:{...films[0],id:10000+id+(tv?1000:0),tmdb_id:id,type:tv?"tv":"movie",title:name,all_titles:{cs:name,en:tv?"The Big Bang Theory":"Dune: Part Two"}}};
    }
    if (p === "v1/watchlists/overview")
      return {
        payload: {
          watchlists: lists.map((l) => ({ ...l, preview: items.get(l.id) })),
          total: lists.length,
          preview_limit: 12,
        },
      };
    if (p === "v1/watchlists/shared") return { payload: [] };
    if (/^v1\/watchlists\/\d+\/public-link$/.test(p))
      return { payload: { active: false } };
    if (/^v1\/watchlists\/\d+\/shares$/.test(p)) return { payload: [] };
    if (/^v1\/ratings\/title\/\d+\/my$/.test(p))
      return { payload: { has_rated: false, rating: null } };
    if (/^v1\/streaming2?\/titles\/\d+\/streams$/.test(p))
      return { payload: { streams: [] } };
    if (p === "v1/watchlists") {
      if (method === "POST") {
        const list = {
          id: next++,
          name: body.name,
          item_count: 0,
          is_default: false,
        };
        lists.push(list);
        items.set(list.id, []);
        return { payload: list };
      }
      return { payload: lists };
    }
    const match = /^v1\/watchlists\/(\d+)(?:\/items(?:\/(\d+))?)?$/.exec(p);
    if (match) {
      const id = Number(match[1]),
        list = lists.find((l) => l.id === id);
      if (!list) fail(404, "Seznam neexistuje.");
      const li = items.get(id);
      if (method === "PUT") {
        list.name = body.name;
        return { payload: list };
      }
      if (method === "POST") {
        if (li.some((i) => i.title_id === body.title_id))
          fail(409, "Titul už v seznamu je.");
        const t = [...films, ...series].find((t) => t.id === body.title_id);
        li.push({
          id: next++,
          title_id: t.id,
          original_title: t.title,
          content_type: t.type,
          poster_path: t.poster_path,
        });
        list.item_count = li.length;
        return { payload: { ok: true } };
      }
      if (method === "DELETE") {
        if (match[2]) {
          li.splice(
            li.findIndex((i) => i.id === Number(match[2])),
            1,
          );
          list.item_count = li.length;
        } else {
          lists.splice(lists.indexOf(list), 1);
          items.delete(id);
        }
        return { payload: { ok: true } };
      }
      return { payload: li };
    }
    fail(404, `Testovací API nemá tuto cestu: ${p}`);
  };
}
module.exports = { createFixture, films, series };
if (require.main === module) {
  process.env.MOVLY_API_KEY = "fixture-api-key";
  process.env.DOWNLOAD_TOKEN_SECRET = "fixture-session-secret-not-production";
  process.env.NODE_ENV = "development";
  process.env.MOVLY_API_BASE = `http://127.0.0.1:${process.env.MOVLY_FIXTURE_UPSTREAM_PORT||8087}`;
  const fixture = createFixture({externalListCount:Number(process.env.MOVLY_FIXTURE_EXTERNAL_LIST_COUNT)||0});
  const upstream = http.createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      const result = await fixture(
        req.url.slice(1),
        req.method,
        raw ? JSON.parse(raw) : null,
        req.headers.authorization?.slice(7),
        req.headers["x-session-id"],
        {
          "X-Profile-ID": req.headers["x-profile-id"],
          "X-Profile-Grant": req.headers["x-profile-grant"],
        },
      );
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result.payload));
    } catch (e) {
      res.writeHead(e.status || 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: e.message, code: e.code }));
    }
  });
  upstream.listen(Number(process.env.MOVLY_FIXTURE_UPSTREAM_PORT||8087), "127.0.0.1", () => {
    require("../server")
      .createServer()
      .listen(Number(process.env.MOVLY_FIXTURE_PORT||8086), "127.0.0.1", () =>
        console.log(
          "TEST FIXTURE ONLY http://localhost:8086/app — test / movly-test",
        ),
      );
  });
}
