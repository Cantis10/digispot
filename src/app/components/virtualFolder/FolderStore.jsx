// FolderStore.jsx
// State for the folder browser, backed directly by the real filesystem —
// no virtual tree, no AsyncStorage. A "folder" here is an actual Directory
// under the app's DigiSpot root, and a "file" is an actual File on disk.
// The disk *is* the state, so there's nothing to hydrate and nothing that
// can drift out of sync with what server.js serves over the LAN.
//
// Wrap your app (or the relevant screen) in <FolderProvider> and use the
// useFolders() hook anywhere below it.
//
// A folder's "location" is expressed as `segments`: an array of path
// component names relative to the DigiSpot root, e.g. [] for the root,
// or ["Photos", "2024"] for a nested folder. This mirrors how you'd type
// a path on a normal filesystem, and maps 1:1 onto server.js's ?path=
// query param.

import { Directory, File, Paths } from "expo-file-system";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getAllAuthors,
  moveAuthor as persistMoveAuthor,
  removeAuthor as persistRemoveAuthor,
  setAuthor as persistSetAuthor,
} from "./Authorstore";
import {
  getFolderPasscode as fetchFolderPasscode,
  getAllPasscodes,
  removeFolderPasscode as persistRemoveFolderPasscode,
  setFolderPasscode as persistSetFolderPasscode,
} from "./Passcodestore";

// Root directory everything lives under. This is the same directory
// server.js mounts as the static "/files" route — the app and the LAN
// server are just two views onto one real folder tree.
export function getRootDir() {
  const dir = new Directory(Paths.document, "DigiSpot");
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

function dirFromSegments(segments) {
  return (segments || []).reduce(
    (dir, name) => new Directory(dir, name),
    getRootDir(),
  );
}

// ---------------------------- context ----------------------------
const FolderContext = createContext(undefined);

export function FolderProvider({ children }) {
  // There's no in-memory tree to keep consistent with disk, so mutations
  // just bump this counter to tell listDir() callers to re-read.
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  // Which folders currently have a passcode set, keyed the same way
  // PasscodeStore keys its map ("Docs/Work"). This is only a UI-side cache
  // for showing a 🔒 badge without an async round trip per folder card —
  // PasscodeStore (AsyncStorage) stays the source of truth, and server.js
  // reads it independently for the actual /folder?password= lookup.
  const [passcodeKeys, setPasscodeKeys] = useState(new Set());

  const refreshPasscodeKeys = useCallback(() => {
    getAllPasscodes().then((all) => setPasscodeKeys(new Set(Object.keys(all))));
  }, []);

  useEffect(() => {
    refreshPasscodeKeys();
  }, [refreshPasscodeKeys]);

  // Who created each entry — a UI-side cache over AuthorStore (AsyncStorage),
  // same pattern as passcodeKeys above, so listDir can attach an `author` to
  // every row without an async round trip per folder card / file row.
  const [authors, setAuthors] = useState({});

  const refreshAuthors = useCallback(() => {
    getAllAuthors().then(setAuthors);
  }, []);

  useEffect(() => {
    refreshAuthors();
  }, [refreshAuthors]);

  const listDir = useCallback(
    (segments) => {
      const dir = dirFromSegments(segments);
      if (!dir.exists) return { folders: [], files: [] };

      const entries = dir.list();
      const folders = entries
        .filter((e) => e instanceof Directory)
        .map((e) => ({
          name: e.name,
          uri: e.uri,
          author: authors[[...segments, e.name].join("/")]?.author ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      const files = entries
        .filter((e) => e instanceof File)
        .map((e) => ({
          name: e.name,
          uri: e.uri,
          size: e.size,
          author: authors[[...segments, e.name].join("/")]?.author ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return { folders, files };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, authors],
  );

  // `author` is who to credit for this folder — pass the current user's
  // display name; omitted/empty just means no author gets recorded.
  const createFolder = useCallback(
    (segments, name, author) => {
      const clean = (name || "").trim() || "Untitled folder";
      const dir = new Directory(dirFromSegments(segments), clean);
      if (!dir.exists) dir.create({ intermediates: true });
      persistSetAuthor([...segments, clean], author).then(refreshAuthors);
      refresh();
    },
    [refresh, refreshAuthors],
  );

  // isDir tells us whether to construct a Directory or File handle for
  // `name` — the two classes are distinct, so callers (which already know
  // whether they clicked a folder or a file row) pass this along rather
  // than us guessing from disk.
  const deleteEntry = useCallback(
    (segments, name, isDir) => {
      const parent = dirFromSegments(segments);
      const entry = isDir
        ? new Directory(parent, name)
        : new File(parent, name);
      if (entry.exists) entry.delete(); // real recursive delete for folders
      persistRemoveAuthor([...segments, name]).then(refreshAuthors);
      refresh();
    },
    [refresh, refreshAuthors],
  );

  const renameEntry = useCallback(
    (segments, oldName, newName, isDir) => {
      const clean = (newName || "").trim();
      if (!clean || clean === oldName) return;
      const parent = dirFromSegments(segments);
      const entry = isDir
        ? new Directory(parent, oldName)
        : new File(parent, oldName);
      const destination = isDir
        ? new Directory(parent, clean)
        : new File(parent, clean);
      entry.move(destination);
      persistMoveAuthor([...segments, oldName], [...segments, clean]).then(
        refreshAuthors,
      );
      refresh();
    },
    [refresh, refreshAuthors],
  );

  const moveEntry = useCallback(
    (fromSegments, name, toSegments, isDir) => {
      const fromParent = dirFromSegments(fromSegments);
      const toParent = dirFromSegments(toSegments);
      // Refuse to move a folder inside itself or one of its own children —
      // walking the real fs path is simpler than the old descendant-id scan.
      if (isDir) {
        const fromPath = new Directory(fromParent, name).uri;
        if (
          toParent.uri === fromPath ||
          toParent.uri.startsWith(fromPath + "/")
        )
          return;
      }
      const entry = isDir
        ? new Directory(fromParent, name)
        : new File(fromParent, name);
      entry.move(toParent);
      persistMoveAuthor([...fromSegments, name], [...toSegments, name]).then(
        refreshAuthors,
      );
      refresh();
    },
    [refresh, refreshAuthors],
  );

  // pickedFiles: [{ uri, name }] — uri should be a file:// URI (e.g. from
  // DocumentPicker with copyToCacheDirectory: true) since content:// reads
  // aren't guaranteed to survive past the current picking session.
  // `author` is who to credit for every file in this batch.
  const importFiles = useCallback(
    (segments, pickedFiles, author) => {
      const dir = dirFromSegments(segments);
      const results = [];
      pickedFiles.forEach(({ uri, name }) => {
        const clean = name || "Untitled file";
        try {
          const source = new File(uri);
          const dest = new File(dir, clean);
          source.copy(dest, { overwrite: true });
          persistSetAuthor([...segments, clean], author);
          results.push({ ok: true, name: clean });
        } catch (err) {
          results.push({ ok: false, name: clean, error: err });
        }
      });
      refreshAuthors();
      refresh();
      return results;
    },
    [refresh, refreshAuthors],
  );

  const getPath = useCallback((segments) => segments || [], []);

  // Long-press → "Set passcode" flow. `passcode` is stored as typed
  // (trimmed); passing an empty string clears it, same as removePasscode.
  const setPasscode = useCallback(
    async (segments, passcode) => {
      await persistSetFolderPasscode(segments, passcode);
      refreshPasscodeKeys();
    },
    [refreshPasscodeKeys],
  );

  const removePasscode = useCallback(
    async (segments) => {
      await persistRemoveFolderPasscode(segments);
      refreshPasscodeKeys();
    },
    [refreshPasscodeKeys],
  );

  // Sync check for render (folder grid badges) — backed by the
  // passcodeKeys cache above, not a fresh AsyncStorage read.
  const hasPasscode = useCallback(
    (segments) => passcodeKeys.has((segments || []).join("/")),
    [passcodeKeys],
  );

  // Async read of the actual passcode value, e.g. to prefill an "edit"
  // modal or show it back to the folder's owner.
  const getPasscode = useCallback(
    (segments) => fetchFolderPasscode(segments),
    [],
  );

  // Sync read for render — backed by the `authors` cache above, not a
  // fresh AsyncStorage read. `segments` here is the entry's own full path
  // (e.g. [...currentPath, folder.name]), same convention as hasPasscode.
  const getAuthor = useCallback(
    (segments) => authors[(segments || []).join("/")]?.author ?? null,
    [authors],
  );

  const value = useMemo(
    () => ({
      getRootDir,
      listDir,
      createFolder,
      deleteEntry,
      renameEntry,
      moveEntry,
      importFiles,
      getPath,
      refresh,
      setPasscode,
      removePasscode,
      hasPasscode,
      getPasscode,
      getAuthor,
    }),
    [
      listDir,
      createFolder,
      deleteEntry,
      renameEntry,
      moveEntry,
      importFiles,
      getPath,
      refresh,
      setPasscode,
      removePasscode,
      hasPasscode,
      getPasscode,
      getAuthor,
    ],
  );

  return (
    <FolderContext.Provider value={value}>{children}</FolderContext.Provider>
  );
}

export function useFolders() {
  const ctx = useContext(FolderContext);
  if (!ctx) throw new Error("useFolders must be used within a FolderProvider");
  return ctx;
}
