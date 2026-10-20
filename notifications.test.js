"use strict";
const {test} = require("node:test");
const assert = require("node:assert/strict");
const notifications = import("./app/notifications.js");
const snapshot = (events, defaults = events) => ({effective:{events},defaults:{events:defaults}});

test("movie subscription never inherits or submits an episode event", async () => {
  const {notificationEventsForTitle, notificationSelection} = await notifications;
  assert.deepEqual(notificationEventsForTitle("movie"), ["stream_available", "czsk_available"]);
  assert.deepEqual(notificationSelection(snapshot(["episode_released", "czsk_available"]), null, "movie"), ["czsk_available"]);
  assert.deepEqual(notificationSelection(snapshot([], ["episode_released"]), null, "movie"), ["stream_available"]);
  assert.deepEqual(notificationSelection(snapshot([]), ["episode_released", "czsk_available"], "movie"), ["czsk_available"]);
  assert.deepEqual(notificationSelection(snapshot([]), [], "movie"), []);
});

test("series retain all events and current selection without changing profile defaults", async () => {
  const {notificationEventsForTitle, notificationSelection} = await notifications;
  assert.deepEqual(notificationEventsForTitle("tv"), ["episode_released", "stream_available", "czsk_available"]);
  const value = snapshot(["episode_released"], ["stream_available"]);
  const before = structuredClone(value);
  assert.deepEqual(notificationSelection(value, null, "tv"), ["episode_released"]);
  assert.deepEqual(value, before);
});

test("movie labels describe streams and verified audio in all interface languages", async () => {
  const {notificationLabel} = await import("./app/notification-labels.js");
  const {setUILanguage} = await import("./app/i18n.js");
  for (const [language, movie, audio] of [["cs", "film", "audio"], ["sk", "film", "audio"], ["en", "movie", "audio"]]) {
    setUILanguage(language);
    assert.match(notificationLabel("NotificationsMovie").toLowerCase(), new RegExp(movie));
    assert.match(notificationLabel("Notifications_movie_stream_available").toLowerCase(), new RegExp(movie));
    assert.match(notificationLabel("Notifications_movie_czsk_available").toLowerCase(), new RegExp(audio));
    assert.doesNotMatch(notificationLabel("NotificationsMovieFutureOnly"), /díl|epizó|episode/);
  }
  setUILanguage("cs");
});
