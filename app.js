"use strict";

/* HandyBridge — synct Text & Dateien zwischen Geräten über einen dedizierten Google-Drive-Ordner.
   Jede Nachricht ist eine eigene Drive-Datei (kein Read-Modify-Write auf einer gemeinsamen
   JSON-Datei) -- so gibt es keine Konflikte, wenn Handy und Laptop gleichzeitig senden. */

const SCOPE = "https://www.googleapis.com/auth/drive.file";
const FOLDER_NAME = "HandyBridge-Inbox";
const POLL_MS = 6000;
const READ_KEY = "handybridge_read_ids";
const DEVICE_KEY = "handybridge_device";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let folderId = null;
let pollTimer = null;
let messages = [];

const $ = (id) => document.getElementById(id);

function readIds() {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); }
  catch { return new Set(); }
}
function markRead(id) {
  const s = readIds();
  s.add(id);
  localStorage.setItem(READ_KEY, JSON.stringify([...s]));
}
function deviceName() { return localStorage.getItem(DEVICE_KEY) || null; }

function toast(msg, isError = false) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.toggle("error", isError);
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3500);
}

/* ---------- Auth ---------- */

function initAuth() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: HANDYBRIDGE_CLIENT_ID,
    scope: SCOPE,
    callback: (resp) => {
      if (resp.error) {
        showAuthError(resp.error);
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
      onSignedIn();
    },
  });
}

function showAuthError(err) {
  const el = $("authError");
  el.textContent = "Anmeldung fehlgeschlagen: " + err + ". Bitte config.js / OAuth-Setup prüfen (README.md).";
  el.classList.remove("hidden");
}

function signIn(interactive = true) {
  tokenClient.requestAccessToken({ prompt: interactive ? "" : "none" });
}

function signOut() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  clearInterval(pollTimer);
  $("app").classList.add("hidden");
  $("signedOutState").classList.remove("hidden");
  $("signInBtn").classList.remove("hidden");
  $("signOutBtn").classList.add("hidden");
}

async function ensureFreshToken() {
  if (accessToken && Date.now() < tokenExpiresAt) return true;
  return new Promise((resolve) => {
    const prevCallback = tokenClient.callback;
    tokenClient.callback = (resp) => {
      tokenClient.callback = prevCallback;
      if (resp.error) { resolve(false); return; }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (resp.expires_in - 60) * 1000;
      resolve(true);
    };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}

async function onSignedIn() {
  $("signedOutState").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("signInBtn").classList.add("hidden");
  $("signOutBtn").classList.remove("hidden");

  if (!deviceName()) {
    $("deviceModal").classList.remove("hidden");
  } else {
    $("deviceBadge").textContent = deviceName();
  }

  try {
    folderId = await findOrCreateFolder();
    await refreshInbox();
    startPolling();
  } catch (e) {
    console.error(e);
    toast("Fehler beim Laden: " + e.message, true);
  }
}

/* ---------- Drive REST helpers ---------- */

async function driveFetch(url, options = {}) {
  await ensureFreshToken();
  const headers = Object.assign({}, options.headers, { Authorization: "Bearer " + accessToken });
  const res = await fetch(url, Object.assign({}, options, { headers }));
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Drive API ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

async function findOrCreateFolder() {
  const q = encodeURIComponent(
    `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const listRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&spaces=drive`
  );
  const listData = await listRes.json();
  if (listData.files && listData.files.length > 0) return listData.files[0].id;

  const createRes = await driveFetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const created = await createRes.json();
  return created.id;
}

async function listMessages() {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const fields = encodeURIComponent("files(id,name,mimeType,createdTime,size,appProperties)");
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=createdTime desc&fields=${fields}&pageSize=200`
  );
  const data = await res.json();
  return data.files || [];
}

function buildMultipartBody(metadata, contentBlob, contentType) {
  const boundary = "handybridge_" + Math.random().toString(36).slice(2);
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`;
  const fileHeader = `--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`;
  const closing = `\r\n--${boundary}--`;
  const body = new Blob([metaPart, fileHeader, contentBlob, closing]);
  return { body, boundary };
}

async function uploadMessage(metadata, contentBlob, contentType) {
  const { body, boundary } = buildMultipartBody(metadata, contentBlob, contentType);
  await driveFetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    }
  );
}

async function sendText(text) {
  const now = new Date().toISOString();
  await uploadMessage(
    {
      name: `Nachricht – ${now}`,
      parents: [folderId],
      appProperties: { app: "handybridge", kind: "text", from: deviceName() || "?" },
    },
    new Blob([text], { type: "text/plain" }),
    "text/plain; charset=UTF-8"
  );
}

async function sendFile(file) {
  await uploadMessage(
    {
      name: file.name,
      parents: [folderId],
      appProperties: { app: "handybridge", kind: "file", from: deviceName() || "?" },
    },
    file,
    file.type || "application/octet-stream"
  );
}

async function trashMessage(id) {
  await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trashed: true }),
  });
}

async function fetchMedia(id) {
  const res = await driveFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`);
  return res.blob();
}

/* ---------- Rendering ---------- */

function formatSize(bytes) {
  if (!bytes) return "";
  const n = parseInt(bytes, 10);
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(1) + " MB";
}

function formatTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" }) +
      " " + d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

async function refreshInbox() {
  const files = await listMessages();
  messages = files;
  render();
}

function render() {
  const inbox = $("inbox");
  const read = readIds();
  inbox.innerHTML = "";

  $("emptyState").classList.toggle("hidden", messages.length > 0);

  for (const m of messages) {
    const props = m.appProperties || {};
    const kind = props.kind || (m.mimeType === "text/plain" ? "text" : "file");
    const isUnread = !read.has(m.id);

    const el = document.createElement("div");
    el.className = "msg" + (isUnread ? " unread" : "");

    const icon = document.createElement("div");
    icon.className = "msg-icon";
    icon.textContent = kind === "text" ? "💬" : "📎";
    el.appendChild(icon);

    const body = document.createElement("div");
    body.className = "msg-body";

    if (kind === "text") {
      const textEl = document.createElement("div");
      textEl.className = "msg-text";
      textEl.textContent = "…";
      body.appendChild(textEl);
      fetchMedia(m.id).then((blob) => blob.text()).then((t) => { textEl.textContent = t; });
    } else {
      const nameEl = document.createElement("div");
      nameEl.className = "msg-filename";
      nameEl.textContent = m.name;
      body.appendChild(nameEl);
      const sizeEl = document.createElement("div");
      sizeEl.className = "msg-filesize";
      sizeEl.textContent = formatSize(m.size);
      body.appendChild(sizeEl);
    }

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${props.from || "?"} · ${formatTime(m.createdTime)}`;
    body.appendChild(meta);

    el.appendChild(body);

    const actions = document.createElement("div");
    actions.className = "msg-actions";

    if (kind === "text") {
      const copyBtn = document.createElement("button");
      copyBtn.textContent = "📋";
      copyBtn.title = "Kopieren";
      copyBtn.onclick = async () => {
        markRead(m.id);
        render();
        const blob = await fetchMedia(m.id);
        await navigator.clipboard.writeText(await blob.text());
        toast("In Zwischenablage kopiert");
      };
      actions.appendChild(copyBtn);
    } else {
      const dlBtn = document.createElement("button");
      dlBtn.textContent = "⬇️";
      dlBtn.title = "Herunterladen";
      dlBtn.onclick = async () => {
        markRead(m.id);
        render();
        const blob = await fetchMedia(m.id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = m.name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      };
      actions.appendChild(dlBtn);
    }

    const delBtn = document.createElement("button");
    delBtn.textContent = "🗑️";
    delBtn.className = "delete-btn";
    delBtn.title = "Löschen";
    delBtn.onclick = async () => {
      if (!confirm("Nachricht löschen?")) return;
      try {
        await trashMessage(m.id);
        messages = messages.filter((x) => x.id !== m.id);
        render();
      } catch (e) {
        toast("Löschen fehlgeschlagen: " + e.message, true);
      }
    };
    actions.appendChild(delBtn);

    el.appendChild(actions);
    inbox.appendChild(el);

    if (isUnread && kind === "text") markRead(m.id);
  }
}

/* ---------- Polling ---------- */

function isComposing() {
  return document.activeElement === $("textInput");
}

function startPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    if (document.visibilityState === "visible" && !isComposing()) refreshInbox().catch(() => {});
  }, POLL_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && accessToken && !isComposing()) refreshInbox().catch(() => {});
});
window.addEventListener("focus", () => {
  if (accessToken && !isComposing()) refreshInbox().catch(() => {});
});

/* ---------- Compose ---------- */

let pendingFile = null;

function updateSendEnabled() {
  $("sendBtn").disabled = !($("textInput").value.trim() || pendingFile);
}

function wireCompose() {
  $("textInput").addEventListener("input", updateSendEnabled);
  $("textInput").addEventListener("blur", () => {
    if (accessToken) refreshInbox().catch(() => {});
  });

  $("fileInput").addEventListener("change", () => {
    pendingFile = $("fileInput").files[0] || null;
    const preview = $("filePreview");
    if (pendingFile) {
      preview.textContent = `${pendingFile.name} (${formatSize(pendingFile.size)})`;
      preview.classList.remove("hidden");
    } else {
      preview.classList.add("hidden");
    }
    updateSendEnabled();
  });

  $("sendBtn").addEventListener("click", async () => {
    const text = $("textInput").value.trim();
    $("sendBtn").disabled = true;
    $("uploadProgress").classList.remove("hidden");
    try {
      if (pendingFile) {
        await sendFile(pendingFile);
        pendingFile = null;
        $("fileInput").value = "";
        $("filePreview").classList.add("hidden");
      }
      if (text) {
        await sendText(text);
        $("textInput").value = "";
      }
      await refreshInbox();
      toast("Gesendet");
    } catch (e) {
      toast("Senden fehlgeschlagen: " + e.message, true);
    } finally {
      $("uploadProgress").classList.add("hidden");
      updateSendEnabled();
    }
  });
}

/* ---------- Init ---------- */

function wireStatic() {
  $("signInBtn").addEventListener("click", () => signIn(true));
  $("signInBtnBig").addEventListener("click", () => signIn(true));
  $("signOutBtn").addEventListener("click", signOut);
  $("refreshBtn").addEventListener("click", () => refreshInbox().catch((e) => toast(e.message, true)));

  $("deviceBadge").addEventListener("click", () => $("deviceModal").classList.remove("hidden"));
  document.querySelectorAll(".device-choice").forEach((btn) => {
    btn.addEventListener("click", () => {
      localStorage.setItem(DEVICE_KEY, btn.dataset.device);
      $("deviceBadge").textContent = btn.dataset.device;
      $("deviceModal").classList.add("hidden");
    });
  });
}

window.onGisLoaded = () => {
  if (!HANDYBRIDGE_CLIENT_ID || HANDYBRIDGE_CLIENT_ID.startsWith("PASTE_")) {
    showAuthError("keine Client-ID in config.js eingetragen");
    return;
  }
  initAuth();
  $("signInBtn").disabled = false;
  $("signInBtnBig").disabled = false;
};

window.onGisFailed = () => {
  showAuthError("Google-Anmeldeskript konnte nicht geladen werden (Internetverbindung prüfen)");
};

window.addEventListener("DOMContentLoaded", () => {
  $("signInBtn").disabled = true;
  $("signInBtnBig").disabled = true;
  wireStatic();
  wireCompose();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
