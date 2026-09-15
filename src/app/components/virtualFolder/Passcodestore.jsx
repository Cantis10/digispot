// PasscodeStore.js
// Persists per-folder passcodes so a folder can be unlocked remotely over
// the LAN (via /folder?password=...) without exposing every folder by
// default. This is the one piece of state in the app that *isn't* the
// filesystem itself, so it lives in AsyncStorage as a small JSON map:
//
//   { "Docs/Work": "12345", "Photos": "0000" }
//
// Keys are the same "segments.join('/')" shape FolderStore and server.js
// already use to name a folder's location, so a passcode always maps 1:1
// onto a real Directory.
//
// This file has no React in it on purpose — server.js is plain JS (it's
// not a component and can't use hooks), so both it and FolderStore.jsx
// import these same functions directly.
//
// Requires: @react-native-async-storage/async-storage
//   npx expo install @react-native-async-storage/async-storage

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "digispot:folderPasscodes";

function keyForSegments(segments) {
  return (segments || []).join("/");
}

async function loadAll() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("PasscodeStore: failed to load passcodes", err);
    return {};
  }
}

async function saveAll(map) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("PasscodeStore: failed to save passcodes", err);
  }
}

// Full map, keyed by "Docs/Work" style path. Mainly useful for building a
// UI-side "which folders are locked" lookup without one round trip per
// folder — see FolderStore's passcodeKeys.
export async function getAllPasscodes() {
  return loadAll();
}

export async function getFolderPasscode(segments) {
  const map = await loadAll();
  return map[keyForSegments(segments)] ?? null;
}

// Pass an empty/whitespace-only passcode to clear it (same as
// removeFolderPasscode) rather than storing a blank string.
export async function setFolderPasscode(segments, passcode) {
  const clean = String(passcode || "").trim();
  const map = await loadAll();
  const key = keyForSegments(segments);
  if (!clean) {
    delete map[key];
  } else {
    map[key] = clean;
  }
  await saveAll(map);
  return map;
}

export async function removeFolderPasscode(segments) {
  const map = await loadAll();
  delete map[keyForSegments(segments)];
  await saveAll(map);
  return map;
}

// Reverse lookup for the server: given a password typed into
// /folder?password=..., find which folder (as a segments array) it
// unlocks. Returns null if no folder currently has that passcode set.
// Passcodes aren't required to be unique — first match wins — so reuse
// the same code across folders only if you don't need to tell them apart
// from a URL.
export async function findFolderByPasscode(password) {
  if (!password) return null;
  const map = await loadAll();
  const entry = Object.entries(map).find(([, code]) => code === password);
  if (!entry) return null;
  const [key] = entry;
  return key ? key.split("/").filter(Boolean) : [];
}
