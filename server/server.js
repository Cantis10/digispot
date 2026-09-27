import { Asset } from "expo-asset";
import { Directory, File, Paths } from "expo-file-system";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { Buffer } from "react-native-nitro-buffer";
import { createConfigServer } from "react-native-nitro-http-server";
import {
  ACCESSIBILITY,
  getFolderAccessibility,
} from "../src/app/components/virtualFolder/AccessibilityStore";
import {
  getAllAuthors,
  setAuthor as persistSetAuthor,
} from "../src/app/components/virtualFolder/Authorstore";
import {
  findFolderByPasscode,
  getFolderPasscode,
} from "../src/app/components/virtualFolder/Passcodestore";

let pages = {};
let staticFiles = {};
let serverInstance = null;
const clients = new Map();

async function loadHTML() {
  const files = {
    "/": require("../web/index.html"),
    "/about": require("../web/about.html"),
    "/login": require("../web/login.html"),
    "/folder": require("../web/folderView.html"),
  };

  for (const path in files) {
    const asset = Asset.fromModule(files[path]);
    await asset.downloadAsync();
    pages[path] = await FileSystem.readAsStringAsync(asset.localUri);
  }

  const bundledStaticFiles = {
    "/style.css": {
      module: require("../web/style.css"),
      contentType: "text/css; charset=utf-8",
      encoding: FileSystem.EncodingType.UTF8,
    },
    "/logo.png": {
      module: require("../web/logo.png"),
      contentType: "image/png",
      encoding: FileSystem.EncodingType.Base64,
    },
  };

  for (const [path, config] of Object.entries(bundledStaticFiles)) {
    const asset = Asset.fromModule(config.module);
    await asset.downloadAsync();
    const contents = await FileSystem.readAsStringAsync(asset.localUri, {
      encoding: config.encoding,
    });
    staticFiles[path] = {
      contentType: config.contentType,
      body:
        config.encoding === FileSystem.EncodingType.Base64
          ? Buffer.from(contents, "base64")
          : contents,
    };
  }
  // Older pages refer to the logo in this location. Keep the URL working
  // while the asset itself remains a single bundled file.
  staticFiles["/Images/DigiSpot_Logo.png"] = staticFiles["/logo.png"];
}

async function ensureDigiSpotDir() {
  const dir = new Directory(Paths.document, "DigiSpot");
  if (!dir.exists) {
    await dir.create({ intermediates: true });
  }
  return dir;
}

function digiSpotDir() {
  return new Directory(Paths.document, "DigiSpot");
}

function parsePathParam(raw) {
  if (!raw || raw === "root") return [];
  return raw
    .split("/")
    .filter(Boolean)
    .filter((seg) => seg !== "." && seg !== "..");
}

function sanitizeName(raw, fallback) {
  const clean = String(raw || "").trim();
  if (!clean || clean === "." || clean === "..") return fallback;
  if (clean.includes("/") || clean.includes("\\")) return fallback;
  return clean;
}

function parseJsonBody(request) {
  const raw = request.body ?? request.rawBody ?? request.data;
  if (raw === undefined || raw === null || raw === "") return {};
  try {
    if (typeof raw === "string") return JSON.parse(raw);
    if (raw instanceof Uint8Array) {
      return JSON.parse(Buffer.from(raw).toString("utf8"));
    }
    if (typeof raw === "object") return raw;
  } catch (err) {
    console.warn("Failed to parse request body as JSON:", err);
  }
  return {};
}

function dirFromSegments(segments) {
  return segments.reduce(
    (dir, name) => new Directory(dir, name),
    digiSpotDir(),
  );
}

function downloadUrlFor(segments, name, password, passcodes = {}) {
  const parts = [...segments, name].map(encodeURIComponent);
  const params = new URLSearchParams();
  if (password) params.set("password", password);
  if (Object.keys(passcodes).length)
    params.set("passcodes", JSON.stringify(passcodes));
  const queryString = params.toString();
  const query = queryString ? `?${queryString}` : "";
  return `/files/${parts.join("/")}${query}`;
}

async function hasMatchingPasscode(segments, passcodes) {
  const expected = await getFolderPasscode(segments);
  return !!expected && passcodes?.[segments.join("/")] === expected;
}

async function canAccessSubpath(rootSegments, subSegments, passcodes) {
  for (let i = 0; i < subSegments.length; i++) {
    const segments = [...rootSegments, ...subSegments.slice(0, i + 1)];
    const accessibility = await getFolderAccessibility(segments);
    if (accessibility === ACCESSIBILITY.PRIVATE) return false;
    if (
      accessibility === ACCESSIBILITY.PROTECTED &&
      !(await hasMatchingPasscode(segments, passcodes))
    )
      return false;
  }
  return true;
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  });
  return out;
}

function generateClientId() {
  return `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function identifyClient(request) {
  const cookieHeader = request.headers?.cookie ?? request.headers?.Cookie;
  const cookies = parseCookies(cookieHeader);
  let clientId = cookies.clientId;
  let setCookieHeader = null;

  if (!clientId) {
    clientId = generateClientId();
    setCookieHeader = `clientId=${clientId}; Path=/; Max-Age=31536000`;
  }

  return { clientId, setCookieHeader };
}

function withClientTracking(innerHandler) {
  return async function (request) {
    const { clientId, setCookieHeader } = identifyClient(request);
    request.clientId = clientId;

    const response = await innerHandler(request);

    if (setCookieHeader) {
      response.headers = {
        ...(response.headers || {}),
        "Set-Cookie": setCookieHeader,
      };
    }
    return response;
  };
}

function registerClient(request, searchParams) {
  const clientId = request.clientId ?? "unknown";
  const ip =
    request.remoteAddress ?? request.headers?.["x-forwarded-for"] ?? null;

  const existing = clients.get(clientId);
  const incomingName = searchParams.get("name");
  const name = incomingName || existing?.name || "Unknown";

  clients.set(clientId, {
    clientId,
    ip,
    lastSeen: Date.now(),
    userAgent: request.headers?.["user-agent"],
    name: name,
  });

  console.log(
    "Registered client:",
    clientId,
    name,
    request.headers?.["user-agent"],
  );
}

// ======================== FILE SERVING ========================

const MIME_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  zip: "application/zip",
  txt: "text/plain",
  json: "application/json",
  html: "text/html",
};

function mimeTypeFor(name) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  return MIME_TYPES[ext] || "application/octet-stream";
}

// Walk every ancestor folder of a file path and apply the same rules used
// everywhere else: PRIVATE is always forbidden, PROTECTED requires that the
// supplied password unlocked that folder (or an ancestor of it). This is
// what the old static "/files" mount skipped entirely — it served bytes
// straight off disk before any of this ran.
async function authorizeFileAccess(fileSegments, password, passcodes = {}) {
  const folderSegments = fileSegments.slice(0, -1);

  let unlockedRoot = [];
  if (password) {
    unlockedRoot = await findFolderByPasscode(password);
    if (!unlockedRoot) {
      return { allowed: false, statusCode: 403, message: "Invalid passcode" };
    }
  }

  for (let i = 0; i < folderSegments.length; i++) {
    const ancestor = folderSegments.slice(0, i + 1);
    const accessibility = await getFolderAccessibility(ancestor);

    if (accessibility === ACCESSIBILITY.PRIVATE) {
      return { allowed: false, statusCode: 403, message: "Access forbidden" };
    }

    if (accessibility === ACCESSIBILITY.PROTECTED) {
      const isRootPasscode =
        unlockedRoot.length > 0 &&
        unlockedRoot.length === ancestor.length &&
        unlockedRoot.every((seg, idx) => seg === ancestor[idx]);

      if (
        !isRootPasscode &&
        !(await hasMatchingPasscode(ancestor, passcodes))
      ) {
        return {
          allowed: false,
          statusCode: 401,
          requiresPassword: true,
          message: "Password required",
        };
      }
    }
  }

  return { allowed: true, statusCode: 200, message: "OK" };
}

// ======================== ACCESSIBILITY & PASSWORD CHECKS ========================

// Check if a folder is accessible and if password is required
async function checkFolderAccessibility(segments, providedPassword) {
  try {
    const accessibility = await getFolderAccessibility(segments);

    // PRIVATE folders are completely hidden and always forbidden
    if (accessibility === ACCESSIBILITY.PRIVATE) {
      return {
        allowed: false,
        statusCode: 403,
        requiresPassword: false,
        message: "Access forbidden",
      };
    }

    // PROTECTED folders require a valid passcode
    if (accessibility === ACCESSIBILITY.PROTECTED) {
      if (!providedPassword) {
        return {
          allowed: false,
          statusCode: 401,
          requiresPassword: true,
          message: "Password required",
        };
      }
      // Password was already validated by findFolderByPasscode
      return {
        allowed: true,
        statusCode: 200,
        requiresPassword: true,
        message: "OK",
      };
    }

    // PUBLIC folders are always allowed
    return {
      allowed: true,
      statusCode: 200,
      requiresPassword: false,
      message: "OK",
    };
  } catch (error) {
    console.warn("Error checking accessibility:", error);
    return {
      allowed: true,
      statusCode: 200,
      requiresPassword: false,
      message: "OK",
    };
  }
}

// Check if a folder in a path needs a password to access
// This is for checking nested folders
async function checkFolderPasswordRequired(segments) {
  try {
    const accessibility = await getFolderAccessibility(segments);
    return (
      accessibility === ACCESSIBILITY.PROTECTED ||
      accessibility === ACCESSIBILITY.PRIVATE
    );
  } catch (error) {
    console.warn("Error checking password requirement:", error);
    return false;
  }
}

// ======================== ROUTE HANDLER ========================

async function handler(request) {
  const { method, path, query } = request;

  const [pathname, pathQuery = ""] = (path || "").split("?");
  const reqPath = pathname;
  const queryString = pathQuery || (typeof query === "string" ? query : "");
  const searchParams = new URLSearchParams(queryString || "");

  console.log(
    "Incoming:",
    method,
    reqPath,
    queryString ? `?${queryString}` : "",
  );

  registerClient(request, searchParams);

  // GET /folder?password=12345 — Load the folder page
  // Password is optional here (but nested access will require it if folder is protected)
  if (method === "GET" && reqPath === "/folder") {
    const password = searchParams.get("password");

    // If password provided, validate it
    let segments = [];
    if (password) {
      segments = await findFolderByPasscode(password);
      if (!segments) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "text/plain" },
          body: "Invalid passcode",
        };
      }

      // Check if this folder is PRIVATE (should never be accessible)
      const accessibility = await getFolderAccessibility(segments);
      if (accessibility === ACCESSIBILITY.PRIVATE) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "text/plain" },
          body: "Access forbidden",
        };
      }
    }

    const page = pages["/folder"];
    if (!page) {
      return { statusCode: 404, body: "404 Not Found" };
    }
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: page,
    };
  }

  if (reqPath === "/api/clientList") {
    const clients = getClients();

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clients),
    };
  }

  // GET /api/files?password=xyz&subpath=nested/path
  // - Lists folder contents
  // - PRIVATE folders are hidden from listings
  // - PROTECTED folders require password when nested
  if (reqPath === "/api/files") {
    try {
      const password = searchParams.get("password");
      const subpathRaw = searchParams.get("subpath");
      const sub = parsePathParam(subpathRaw);
      let passcodes = {};
      try {
        passcodes = JSON.parse(searchParams.get("passcodes") || "{}");
      } catch {}

      // Find the root folder (protected by password)
      let unlocked = [];
      if (password) {
        unlocked = await findFolderByPasscode(password);
        if (!unlocked) {
          return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Invalid passcode" }),
          };
        }
      }

      const segments = [...unlocked, ...sub];

      // Check if the root (unlocked) folder is PRIVATE
      if (unlocked.length > 0) {
        const rootAccessibility = await getFolderAccessibility(unlocked);
        if (rootAccessibility === ACCESSIBILITY.PRIVATE) {
          return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Access forbidden" }),
          };
        }
      }

      // Every protected descendant requires its own passcode. The URL's
      // passcode only unlocks the folder that established the page root.
      if (sub.length > 0) {
        for (let i = 0; i < sub.length; i++) {
          const pathSegments = [...unlocked, ...sub.slice(0, i + 1)];
          const accessibility = await getFolderAccessibility(pathSegments);
          if (
            accessibility === ACCESSIBILITY.PROTECTED &&
            !(await hasMatchingPasscode(pathSegments, passcodes))
          ) {
            return {
              statusCode: 401,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                error: "Password required",
                requiresPassword: true,
              }),
            };
          }
        }

        // Check if trying to access a PRIVATE folder
        for (let i = 0; i < sub.length; i++) {
          const pathSegments = [...unlocked, ...sub.slice(0, i + 1)];
          const accessibility = await getFolderAccessibility(pathSegments);
          if (accessibility === ACCESSIBILITY.PRIVATE) {
            return {
              statusCode: 403,
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ error: "Access forbidden" }),
            };
          }
        }
      }

      const dir = dirFromSegments(segments);

      if (!dir.exists) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Folder not found" }),
        };
      }

      const entries = dir.list();
      const authorMap = await getAllAuthors();
      const authorFor = (name) =>
        authorMap[[...segments, name].join("/")]?.author ?? null;

      // Build folder list, filtering out PRIVATE folders and marking PROTECTED ones
      const folders = [];
      for (const e of entries) {
        if (!(e instanceof Directory)) continue;

        const childSegments = [...segments, e.name];
        const childAccessibility = await getFolderAccessibility(childSegments);

        // Skip PRIVATE folders - don't show them at all
        if (childAccessibility === ACCESSIBILITY.PRIVATE) {
          console.log(`Hiding PRIVATE folder: ${childSegments.join("/")}`);
          continue;
        }

        folders.push({
          name: e.name,
          type: "Folder",
          author: authorFor(e.name),
          passwordRequired: childAccessibility === ACCESSIBILITY.PROTECTED,
        });
      }

      const files = entries
        .filter((e) => e instanceof File)
        .map((e) => ({
          name: e.name,
          size: e.size,
          type: "File",
          downloadUrl: downloadUrlFor(segments, e.name, password, passcodes),
          author: authorFor(e.name),
        }));

      // Determine if current folder requires password for further navigation
      let currentFolderPasswordRequired = false;
      if (segments.length > 0) {
        const currentAccessibility = await getFolderAccessibility(segments);
        currentFolderPasswordRequired =
          currentAccessibility === ACCESSIBILITY.PROTECTED;
      }

      const result = {
        path: segments.join("/"),
        folders,
        files,
        currentFolderPasswordRequired,
        requiresPasswordForNested: currentFolderPasswordRequired,
      };

      console.log("Folder API result:", result);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(result),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // POST /api/folder — Create a folder
  if (method === "POST" && reqPath === "/api/folder") {
    try {
      const body = parseJsonBody(request);
      const password = body.password ?? searchParams.get("password");

      const unlocked = password ? await findFolderByPasscode(password) : [];

      if (password && !unlocked) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid passcode" }),
        };
      }

      // Check if parent folder is PRIVATE
      if (unlocked.length > 0) {
        const accessibility = await getFolderAccessibility(unlocked);
        if (accessibility === ACCESSIBILITY.PRIVATE) {
          return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Access forbidden" }),
          };
        }
      }

      const sub = parsePathParam(body.subpath ?? searchParams.get("subpath"));
      const passcodes = body.passcodes || {};
      if (!(await canAccessSubpath(unlocked, sub, passcodes))) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Password required",
            requiresPassword: true,
          }),
        };
      }
      const parentSegments = [...unlocked, ...sub];
      const name = sanitizeName(body.name, "Untitled folder");
      const segments = [...parentSegments, name];

      const parentDir = dirFromSegments(parentSegments);
      if (!parentDir.exists) {
        return {
          statusCode: 404,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Folder not found" }),
        };
      }

      const dir = dirFromSegments(segments);
      if (!dir.exists) dir.create({ intermediates: true });

      const author = String(body.author || "").trim() || "Guest";
      await persistSetAuthor(segments, author);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ok: true, name, author }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // POST /api/upload — Upload a file
  if (method === "POST" && reqPath === "/api/upload") {
    try {
      const body = parseJsonBody(request);
      const password = body.password ?? searchParams.get("password");

      const unlocked = password ? await findFolderByPasscode(password) : [];

      if (password && !unlocked) {
        return {
          statusCode: 403,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Invalid passcode" }),
        };
      }

      // Check if folder is PRIVATE
      if (unlocked.length > 0) {
        const accessibility = await getFolderAccessibility(unlocked);
        if (accessibility === ACCESSIBILITY.PRIVATE) {
          return {
            statusCode: 403,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Access forbidden" }),
          };
        }
      }

      if (!body.dataBase64) {
        return {
          statusCode: 400,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ error: "Missing dataBase64" }),
        };
      }

      const sub = parsePathParam(body.subpath ?? searchParams.get("subpath"));
      const passcodes = body.passcodes || {};
      if (!(await canAccessSubpath(unlocked, sub, passcodes))) {
        return {
          statusCode: 401,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: "Password required",
            requiresPassword: true,
          }),
        };
      }
      const parentSegments = [...unlocked, ...sub];
      const parentDir = dirFromSegments(parentSegments);
      if (!parentDir.exists) parentDir.create({ intermediates: true });

      const name = sanitizeName(body.name, "Untitled file");
      const segments = [...parentSegments, name];
      const file = new File(parentDir, name);

      await FileSystem.writeAsStringAsync(file.uri, body.dataBase64, {
        encoding: FileSystem.EncodingType.Base64,
      });

      const author = String(body.author || "").trim() || "Guest";
      await persistSetAuthor(segments, author);

      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ok: true,
          name,
          author,
          downloadUrl: downloadUrlFor(
            parentSegments,
            name,
            password,
            passcodes,
          ),
        }),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // GET /files/<segments...>?password=... — serve a single file's bytes.
  // This replaces the old static "/files" mount, which served the whole
  // DigiSpot directory (dir_list enabled) with no accessibility or
  // passcode check at all — PROTECTED and even PRIVATE folders were fully
  // browsable/downloadable if you just knew or guessed the path.
  if (method === "GET" && reqPath.startsWith("/files/")) {
    try {
      const raw = reqPath.slice("/files/".length);
      const fileSegments = raw
        .split("/")
        .filter(Boolean)
        .map((seg) => decodeURIComponent(seg))
        .filter((seg) => seg !== "." && seg !== "..");

      if (fileSegments.length === 0) {
        return { statusCode: 404, body: "404 Not Found" };
      }

      const password = searchParams.get("password");
      let passcodes = {};
      try {
        passcodes = JSON.parse(searchParams.get("passcodes") || "{}");
      } catch {}
      const auth = await authorizeFileAccess(fileSegments, password, passcodes);
      if (!auth.allowed) {
        return {
          statusCode: auth.statusCode,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            error: auth.message,
            ...(auth.requiresPassword ? { requiresPassword: true } : {}),
          }),
        };
      }

      const folderSegments = fileSegments.slice(0, -1);
      const name = fileSegments[fileSegments.length - 1];
      const dir = dirFromSegments(folderSegments);
      const file = new File(dir, name);

      if (!file.exists) {
        return { statusCode: 404, body: "404 Not Found" };
      }

      const base64 = await FileSystem.readAsStringAsync(file.uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      return {
        statusCode: 200,
        headers: {
          "Content-Type": mimeTypeFor(name),
          "Content-Disposition": `inline; filename="${encodeURIComponent(name)}"`,
        },
        body: Buffer.from(base64, "base64"),
      };
    } catch (error) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error.message }),
      };
    }
  }

  // API: Connected clients
  if (reqPath === "/api/clients") {
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Array.from(clients.values())),
    };
  }

  // Public, bundled website assets. Keep this map explicit so a URL cannot
  // read arbitrary files from the app or the user's document directory.
  if (method === "GET" && staticFiles[reqPath]) {
    const asset = staticFiles[reqPath];
    return {
      statusCode: 200,
      headers: {
        "Content-Type": asset.contentType,
        "Cache-Control": "public, max-age=86400",
      },
      body: asset.body,
    };
  }

  // HTML routes
  const page = pages[reqPath];
  if (page) {
    return {
      statusCode: 200,
      headers: { "Content-Type": "text/html" },
      body: page,
    };
  }

  return {
    statusCode: 404,
    body: "404 Not Found",
  };
}

export async function startServer(port = 8080) {
  if (serverInstance) return serverInstance;

  await loadHTML();
  const digiSpotDir = await ensureDigiSpotDir();

  const config = {
    // No static mounts: /files/* is now served from inside handler() so
    // every download goes through authorizeFileAccess() first. A static
    // mount here would bypass that check entirely (that was the bug).
    mounts: [],
    verbose: "info",
  };

  serverInstance = await createConfigServer(
    port,
    withClientTracking(handler),
    config,
    { host: "0.0.0.0" },
  );

  const ip = await Network.getIpAddressAsync();
  console.log(`Server listening at http://${ip}:${serverInstance.port}`);

  return serverInstance;
}

export async function stopServer() {
  if (serverInstance) {
    await serverInstance.stop();
    serverInstance = null;
  }
}

export function getServer() {
  return serverInstance;
}

export function getClients() {
  return Array.from(clients.values());
}

export async function getServerUrl() {
  if (!serverInstance) return null;
  const ip = await Network.getIpAddressAsync();
  return `http://${ip}:${serverInstance.port}`;
}
