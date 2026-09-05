import test from "node:test";
import assert from "node:assert/strict";
import "../playback-status-model.js";

const m = globalThis.BngtsPlayback;
const url = "https://play.sooplive.com/alpha/123/direct?fromApi=1";
const live = (overrides = {}, adOverrides = {}) =>
  m.fromLive(
    {
      szBjId: "alpha",
      szBjNick: "알파",
      nBroadNo: 123,
      nQuickViewMode: 2,
      nFollow: 0,
      isLogin: true,
      isEmbed: false,
      isDashBoard: false,
      bOrg: false,
      isBreakTime: false,
      ...overrides,
    },
    {
      advertiseCountShouldPlay: { PREROLL: 1, MIDROLL: 1, POSTROLL: 1 },
      playEndedAdCount: 0,
      currentRollType: "PREROLL",
      isAdViewing: false,
      isAdShow: true,
      shouldLoadAdvertise() {
        throw new Error("must not call mutating checks");
      },
      ...adOverrides,
    },
    url
  );
const vodUrl = "https://vod.sooplive.com/player/123";
const playing = (info = {}, ad = {}) => live(info, { isAdViewing: true, ...ad });
const metadata = (overrides = {}) =>
  m.vodMetadata({
    title_no: 123,
    bj_id: "alpha",
    writer_nick: "알파",
    quickview: "NOT_USED",
    subscribed: false,
    active_subscription: true,
    preroll_showyn: true,
    midroll_showyn: true,
    file_type: "REVIEW",
    is_ppv: false,
    ...overrides,
  });
const vod = (data = metadata(), observed = {}, config = {}) =>
  m.fromVod(data, { titleNo: 123, ...config }, observed, vodUrl);

for (const mode of [1, 8, 9]) {
  for (const subscription of [0, 1]) {
    test(`LIVE mode ${mode}, subscription ${subscription}: no entry warning`, () => {
      const p = live({ nQuickViewMode: mode, nFollow: subscription });
      assert.equal(p.placements.pre.state, "exempt");
      assert.equal(m.playerAlerts(p).length, 0);
    });
  }
}
test("no subscription + no QuickView produces an intuitive channel-scoped warning", () => {
  const alerts = m.playerAlerts(playing());
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].title, "이 방송 미구독 · 퀵뷰 미적용");
  assert.equal(alerts[0].actions.length, 2);
});
test("current channel subscription suppresses warning without QuickView", () => {
  assert.equal(m.playerAlerts(live({ nFollow: 1 })).length, 0);
});
test("unknown -1, unknown modes and wrong channel are never treated as missing rights", () => {
  for (const patch of [{ nFollow: -1 }, { nQuickViewMode: 19 }, { szBjId: "other" }]) {
    const p = live(patch);
    if (patch.nFollow === -1 || patch.szBjId === "other") assert.equal(p.subscribed, null);
    assert.equal(m.playerAlerts(p).length, 0);
  }
});
test("takeover state explains session application without prompting another purchase", () => {
  const alert = m.playerAlerts(playing({ nQuickViewMode: 0 }))[0];
  assert.match(alert.title, /재생창에 적용/);
  assert.equal(alert.actions.length, 1);
  assert.match(alert.actions[0].href, /play\.sooplive\.com/);
});
test("subscription still suppresses entry warning when QuickView is used elsewhere", () => {
  assert.equal(m.playerAlerts(live({ nQuickViewMode: 0, nFollow: 1 })).length, 0);
});
for (const patch of [
  { isAdShow: false },
  { advertiseCountShouldPlay: { PREROLL: 0 } },
  { playEndedAdCount: 1 },
])
  test(`no actual entry ad scheduled: ${JSON.stringify(patch)}`, () => {
    assert.equal(m.playerAlerts(live({}, patch)).length, 0);
  });
test("dashboard and embed ORG suppress entry without assuming a subscription", () => {
  for (const patch of [{ isDashBoard: true }, { bOrg: true, isEmbed: true }]) {
    const p = live(patch);
    assert.equal(p.subscribed, false);
    assert.equal(m.playerAlerts(p).length, 0);
  }
});
test("LIVE midroll is a separate policy, even with Plus/subscription", () => {
  const p = playing(
    { nQuickViewMode: 8, nFollow: 1, isBreakTime: true },
    { currentRollType: "MIDROLL" }
  );
  const alert = m.playerAlerts(p)[0];
  assert.equal(alert.placement, "mid");
  assert.match(alert.description, /면제 대상이 아닙니다/);
  assert.deepEqual(alert.actions, []);
});
test("DIRECT/EMBED suppresses forecast midroll; only actual entry playback is notified", () => {
  const p = live({ isEmbed: true, isBreakTime: true });
  assert.equal(p.placements.mid.state, "not_scheduled");
  assert.equal(m.playerAlerts(p).length, 0);
  assert.equal(m.playerAlerts(playing({ isEmbed: true }))[0].placement, "pre");
});
test("postroll only considered at actual broadcast end", () => {
  assert.equal(live().placements.post.state, "not_scheduled");
  const p = playing({ nQuickViewMode: 8, isPreBroadEnd: true }, { currentRollType: "POSTROLL" });
  assert.equal(m.playerAlerts(p)[0].placement, "post");
  assert.deepEqual(m.playerAlerts(p)[0].actions, []);
});
test("membership changes remove the warning once actual ad playback stops", () => {
  assert.equal(m.playerAlerts(playing()).length, 1);
  assert.equal(m.playerAlerts(live({ nFollow: 1 })).length, 0);
});
test("one known exemption is enough even if the other entitlement is unknown", () => {
  assert.equal(m.playerAlerts(live({ nFollow: -1, nQuickViewMode: 1 })).length, 0);
  assert.equal(m.playerAlerts(live({ nFollow: 1, nQuickViewMode: 99 })).length, 0);
});
test("logged-out players ask for login, not another purchase", () => {
  const alert = m.playerAlerts(playing({ isLogin: false }))[0];
  assert.match(alert.title, /로그인/);
  assert.equal(alert.actions.length, 1);
  assert.match(alert.actions[0].href, /login\.sooplive/);
});
test("four streams yield alerts only for problematic streams, not four dialogs", () => {
  const players = [
    playing(),
    live({ nFollow: 1 }),
    live({ nQuickViewMode: 1 }),
    live({}, { isAdShow: false }),
  ];
  assert.equal(m.alertsForStatus({ soop: { players } }).length, 1);
});
test("active_subscription and midroll_no_reason do not determine viewer rights", () => {
  const meta = metadata({ midroll_no_reason: "custom_data_none" });
  assert.equal(meta.subscribed, false);
  assert.equal(meta.mid, true);
  assert.equal("active_subscription" in meta, false);
});
for (const value of ["QUICKVIEW_PLUS", "QUICKVIEW_PLUS_FREE"])
  test(`VOD ${value} suppresses forecasts`, () => {
    const p = vod(metadata({ quickview: value }));
    assert.equal(p.placements.pre.state, "exempt");
    assert.equal(p.placements.mid.state, "exempt");
    assert.deepEqual(m.playerAlerts(p), []);
  });
test("VOD ordinary QuickView and subscription are handled independently", () => {
  assert.match(
    m.playerAlerts(vod(metadata({ quickview: "QUICKVIEW" }), { pre: "playing" }))[0].title,
    /일반 퀵뷰/
  );
  assert.equal(
    m.playerAlerts(vod(metadata({ subscribed: true, quickview: "QUICKVIEW" }))).length,
    0
  );
});
test("VOD showyn alone does not produce a warning before actual playback conditions", () => {
  assert.equal(m.playerAlerts(vod()).length, 0);
});
test("Catch uses its own observed ad, not VOD entitlement", () => {
  const p = vod(metadata({ file_type: "CATCH", quickview: "QUICKVIEW_PLUS" }), {
    catch: "playing",
  });
  assert.equal(p.placements.pre.state, "not_scheduled");
  assert.equal(m.playerAlerts(p).length, 1);
  assert.deepEqual(m.playerAlerts(p)[0].actions, []);
});
test("PPV, preview, no-fill and ended ads do not cause missing-benefit warnings", () => {
  assert.equal(m.playerAlerts(vod(metadata({ is_ppv: true }))).length, 0);
  assert.equal(m.playerAlerts(vod(metadata(), {}, { isPreview: true })).length, 0);
  for (const state of ["no_fill", "not_scheduled", "unknown", "exempt"]) {
    assert.equal(m.playerAlerts(vod(metadata(), { pre: state })).length, 0);
  }
});
test("errors and observed contradictions never recommend buying another entitlement", () => {
  assert.deepEqual(m.playerAlerts(vod(metadata(), { pre: "error" })), []);
  const contradiction = m.playerAlerts(vod(metadata({ subscribed: true }), { pre: "playing" }))[0];
  assert.deepEqual(contradiction.actions, []);
});
test("VOD metadata from another content is ignored", () => {
  const p = vod(metadata({ title_no: 999, subscribed: true }), { pre: "playing" });
  assert.equal(p.subscribed, null);
  assert.deepEqual(m.playerAlerts(p)[0].actions, []);
});
test("inactive/mismatched core cannot leak an old video's ad state", () => {
  assert.equal(m.playerAlerts(vod(metadata(), { pre: "playing" }, { titleNo: 999 })).length, 0);
});
test("only exact trusted page origins can receive status", () => {
  assert.equal(m.isStatusPage("https://bngts.com/multiview"), true);
  assert.equal(m.isStatusPage("http://localhost:50001/"), true);
  for (const value of [
    "http://localhost:3000/",
    "https://evil.bngts.com/",
    "https://bngts.com.evil.test/",
    "http://bngts.com/",
  ]) {
    assert.equal(m.isStatusPage(value), false);
  }
});
test("chat-only frames, wrong origins and cross-channel payloads are rejected", () => {
  assert.equal(m.contextFromUrl("https://play.sooplive.com/alpha?vtype=chat"), null);
  assert.equal(m.sanitizePlayer(live(), "https://evil.test/alpha"), null);
  assert.equal(m.sanitizePlayer(live(), "https://play.sooplive.com/beta"), null);
});
test("bridge strips secrets and arbitrary HTML/links; no unknown coercion", () => {
  const p = m.sanitizePlayer(
    {
      ...live(),
      subscribed: -1,
      quickview: "1",
      cookie: "secret",
      userId: "private",
      token: "secret",
      url: "https://evil.test",
      placements: { pre: { state: "bogus", token: "secret" } },
    },
    url
  );
  assert.equal(p.subscribed, null);
  assert.equal(p.quickview, "unknown");
  assert.doesNotMatch(JSON.stringify(p), /secret|private|evil\.test/);
  assert.deepEqual(m.playerAlerts(p), []);
});

test("multiview never shows account-only login, scheduled ads, errors or unknown platforms", () => {
  for (const state of ["unknown", "eligible", "not_scheduled", "exempt", "no_fill", "error"]) {
    const player = { ...live({ isLogin: false }), placements: { pre: { state } } };
    assert.deepEqual(m.alertsForStatus({
      soop: { loggedIn: false, players: [player] },
      chzzk: { loggedIn: false }, youtube: { loggedIn: false },
    }), [], state);
  }
  assert.deepEqual(m.alertsForStatus({ chzzk: { loggedIn: false } }), []);
  assert.equal(m.loginAlertsForStatus({ chzzk: { loggedIn: false } }).length, 1);
});

test("LIVE actual playback wins over stale exemption metadata without purchase advice", () => {
  for (const patch of [{ nFollow: 1 }, { nQuickViewMode: 1 }, { nQuickViewMode: 8 }]) {
    const player = playing(patch);
    assert.equal(player.placements.pre.state, "playing");
    const alert = m.alertsForStatus({ soop: { players: [player] } })[0];
    assert.match(alert.description, /실제 광고 상태가 다릅니다/);
    assert.deepEqual(alert.actions, []);
  }
});

test("ad starts and stops independently per broadcast, not merely per logged-out platform", () => {
  const alpha = playing();
  const beta = { ...live({ isLogin: false }), streamerId: "beta", label: "베타" };
  const status = { soop: { players: [alpha, beta] }, chzzk: { loggedIn: false } };
  assert.equal(m.alertsForStatus(status).length, 1);
  beta.placements.pre.state = "playing";
  assert.equal(m.alertsForStatus(status).length, 2);
  alpha.placements.pre.state = "not_scheduled";
  assert.equal(m.alertsForStatus(status).length, 1);
  beta.placements.pre.state = "no_fill";
  assert.deepEqual(m.alertsForStatus(status), []);
});
