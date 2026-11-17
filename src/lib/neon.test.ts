import test from "node:test";
import assert from "node:assert/strict";

import { parseNeonCommand } from "./neon.ts";

test("detects a chill mood request", () => {
  const action = parseNeonCommand("play something chill");
  assert.equal(action.type, "play_by_mood");
  assert.equal(action.mood, "chill");
});

test("detects a request to like the current song", () => {
  const action = parseNeonCommand("like this song");
  assert.equal(action.type, "like_song");
});

test("detects a playlist creation request", () => {
  const action = parseNeonCommand("make me a gym playlist");
  assert.equal(action.type, "create_playlist");
  assert.equal(action.name, "Gym Mix");
});

test("detects a command to play something similar", () => {
  const action = parseNeonCommand("play something like this");
  assert.equal(action.type, "play_similar");
});

test("detects a wake-word + mood request", () => {
  const action = parseNeonCommand("hey neon, play something romantic");
  assert.equal(action.type, "play_by_mood");
  assert.equal(action.mood, "romantic");
});

test("detects a pause command with a wake word", () => {
  const action = parseNeonCommand("neon pause");
  assert.equal(action.type, "pause");
});

test("detects a radio request", () => {
  const action = parseNeonCommand("start radio for me");
  assert.equal(action.type, "play_similar");
});
