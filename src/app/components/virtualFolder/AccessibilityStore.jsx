// AccessibilityStore.jsx
// Persists per-folder accessibility settings. A folder can be:
//   - "public": fully accessible, no password needed
//   - "protected": accessible only with a passcode
//   - "private": completely inaccessible (hidden from guests even with password)
//
// This is stored in AsyncStorage as a JSON map:
//   { "Docs/Work": "protected", "Photos": "private" }
//
// Keys follow the same "segments.join('/')" format as PasscodeStore and FolderStore.
//
// This file has no React in it on purpose — server.js is plain JS, so both it
// and FolderStore.jsx import these same functions directly.
//
// Requires: @react-native-async-storage/async-storage

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "digispot:folderAccessibility";

// Accessibility modes
export const ACCESSIBILITY = {
  PUBLIC: "public", // Fully accessible
  PROTECTED: "protected", // Accessible with passcode
  PRIVATE: "private", // Completely inaccessible
};

function keyForSegments(segments) {
  return (segments || []).join("/");
}

async function loadAll() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn(
      "AccessibilityStore: failed to load accessibility settings",
      err,
    );
    return {};
  }
}

async function saveAll(map) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn(
      "AccessibilityStore: failed to save accessibility settings",
      err,
    );
  }
}

// Get all accessibility settings
export async function getAllAccessibility() {
  return loadAll();
}

// Get a folder's accessibility mode. Defaults to "public" if not set.
export async function getFolderAccessibility(segments) {
  const map = await loadAll();
  return map[keyForSegments(segments)] ?? ACCESSIBILITY.PUBLIC;
}

// Set a folder's accessibility mode
export async function setFolderAccessibility(segments, mode) {
  if (!Object.values(ACCESSIBILITY).includes(mode)) {
    throw new Error(`Invalid accessibility mode: ${mode}`);
  }
  const map = await loadAll();
  const key = keyForSegments(segments);
  map[key] = mode;
  await saveAll(map);
  return map;
}

// Remove accessibility setting (reverts to public)
export async function removeFolderAccessibility(segments) {
  const map = await loadAll();
  delete map[keyForSegments(segments)];
  await saveAll(map);
  return map;
}
