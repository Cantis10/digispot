// AuthorStore.jsx
// Tracks who created each folder/file, since that's not something the
// real filesystem itself remembers for us. Lives in AsyncStorage as a
// small JSON map, same shape and same key convention as PasscodeStore:
//
//   { "Docs/Work": { author: "Alice", createdAt: 1717000000000 },
//     "Docs/Work/report.pdf": { author: "Bob", createdAt: 1717000100000 } }
//
// Keys are "segments.join('/')" for the *entry itself* — a folder's own
// path, or a file's full path including its own name — matching how
// FolderStore.jsx and server.js already key everything else. This file
// has no React in it on purpose, same reasoning as PasscodeStore: it's
// imported directly by server.js (plain JS, no hooks) as well as by
// FolderStore.jsx.
//
// Requires: @react-native-async-storage/async-storage
//   npx expo install @react-native-async-storage/async-storage

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "digispot:authors";

function keyForSegments(segments) {
  return (segments || []).join("/");
}

async function loadAll() {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.warn("AuthorStore: failed to load authors", err);
    return {};
  }
}

async function saveAll(map) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (err) {
    console.warn("AuthorStore: failed to save authors", err);
  }
}

// Full map, keyed by "Docs/Work" / "Docs/Work/report.pdf" style paths.
// Mainly useful for building a UI-side lookup without one round trip per
// entry — see FolderStore's `authors` cache and server.js's /api/files.
export async function getAllAuthors() {
  return loadAll();
}

export async function getAuthor(segments) {
  const map = await loadAll();
  return map[keyForSegments(segments)]?.author ?? null;
}

// `segments` is the entry's own full path (a folder's path, or a file's
// path including its name) — not its parent. Empty/whitespace-only
// author names are treated as "don't record one."
export async function setAuthor(segments, author) {
  const clean = String(author || "").trim();
  const map = await loadAll();
  const key = keyForSegments(segments);
  if (!clean) {
    delete map[key];
  } else {
    map[key] = { author: clean, createdAt: Date.now() };
  }
  await saveAll(map);
  return map;
}

// Delete this entry's author record, plus (for folders) every record
// nested under it — otherwise deleting a folder would leave its
// children's author entries as orphaned dead keys forever.
export async function removeAuthor(segments) {
  const prefix = keyForSegments(segments);
  const map = await loadAll();
  for (const key of Object.keys(map)) {
    if (key === prefix || key.startsWith(prefix + "/")) delete map[key];
  }
  await saveAll(map);
  return map;
}

// Rename/move support: shifts this entry's author record (and, for
// folders, every record nested under it) from the old path prefix to the
// new one, so a renamed/moved folder doesn't silently lose authorship of
// everything inside it.
export async function moveAuthor(oldSegments, newSegments) {
  const oldKey = keyForSegments(oldSegments);
  const newKey = keyForSegments(newSegments);
  if (oldKey === newKey) return loadAll();

  const map = await loadAll();
  const updated = {};
  for (const [key, value] of Object.entries(map)) {
    if (key === oldKey) {
      updated[newKey] = value;
    } else if (key.startsWith(oldKey + "/")) {
      updated[newKey + key.slice(oldKey.length)] = value;
    } else {
      updated[key] = value;
    }
  }
  await saveAll(updated);
  return updated;
}
