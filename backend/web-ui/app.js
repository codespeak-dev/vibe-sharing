// Fetch uploads and render the table

let internalEmails = new Set();
let allUploads = [];

async function fetchUploads() {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/uploads`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    redirectToLogin();
    return [];
  }

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  const data = await response.json();
  return data.uploads;
}

async function fetchSlackThreads() {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/slack-threads`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  return data.threads;
}

async function fetchInternalEmails() {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/internal-emails`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) return [];
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  return data.emails;
}

async function addInternalEmail(email) {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/internal-emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ email }),
  });

  if (response.status === 401) {
    redirectToLogin();
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr) {
  if (!isoStr) return "\u2014";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function applyFilter() {
  const showInternal = document.getElementById("show-internal").checked;
  const filtered = showInternal
    ? allUploads
    : allUploads.filter(
        (u) => !u.userEmail || !internalEmails.has(u.userEmail.toLowerCase())
      );
  renderUploads(filtered);
}

function renderUploads(uploads) {
  const tbody = document.getElementById("uploads-body");
  const empty = document.getElementById("empty-state");

  if (uploads.length === 0) {
    tbody.innerHTML = "";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  tbody.innerHTML = uploads
    .map(
      (u) => `
    <tr data-upload-id="${escapeHtml(u.uploadId)}">
      <td>${escapeHtml(u.filename)}</td>
      <td>${formatSize(u.sizeBytes)}</td>
      <td>${formatUser(u)}</td>
      <td>${formatRepoUrl(u.repoUrl)}</td>
      <td>${formatDate(u.confirmedAt || u.createdAt)}</td>
      <td><a href="${escapeHtml(u.downloadUrl)}" class="download-link">Download</a></td>
    </tr>`
    )
    .join("");
}

function renderSlackThreads(threads) {
  const tbody = document.getElementById("threads-body");
  const section = document.getElementById("slack-threads-section");

  if (!threads || threads.length === 0) {
    section.style.display = "none";
    return;
  }

  section.style.display = "block";
  tbody.innerHTML = threads
    .map(
      (t) => `
    <tr>
      <td>${escapeHtml(t.groupKey)}</td>
      <td>${escapeHtml(t.channel)}</td>
      <td>${formatDate(t.createdAt)}</td>
      <td>${t.expiresAt ? formatDate(new Date(t.expiresAt * 1000).toISOString()) : "\u2014"}</td>
    </tr>`
    )
    .join("");
}

function formatUser(u) {
  const name = u.userName || u.userEmail || "\u2014";
  if (u.userEmail) {
    let html = `<a href="mailto:${escapeHtml(u.userEmail)}" class="download-link">${escapeHtml(name)}</a>`;
    if (!internalEmails.has(u.userEmail.toLowerCase())) {
      html += ` <button class="btn-mark-internal" data-email="${escapeHtml(u.userEmail)}">Hide</button>`;
    }
    return html;
  }
  return escapeHtml(name);
}

function formatRepoUrl(raw) {
  if (!raw) return "\u2014";

  const patterns = [
    /^(?:git@|ssh:\/\/git@|git\+ssh:\/\/git@)github\.com[:/](.+?)(?:\.git)?\/?$/,
    /^(?:git\+https?:\/\/|git:\/\/|https?:\/\/)github\.com\/(.+?)(?:\.git)?\/?$/,
    /^github\.com\/(.+?)(?:\.git)?\/?$/,
  ];

  for (const pat of patterns) {
    const m = raw.match(pat);
    if (m) {
      const path = m[1].replace(/\/$/, "");
      const parts = path.split("/");
      const label = parts.slice(0, 2).join("/");
      const href = `https://github.com/${path}`;
      return `<a href="${escapeHtml(href)}" class="download-link" target="_blank">${escapeHtml(label)}</a>`;
    }
  }

  if (raw.match(/^https?:\/\//)) {
    return `<a href="${escapeHtml(raw)}" class="download-link" target="_blank">${escapeHtml(raw)}</a>`;
  }

  return escapeHtml(raw);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Auto-download from ?download= param ───

function handleAutoDownload(uploads) {
  const params = new URLSearchParams(window.location.search);
  const downloadId = params.get("download");
  if (!downloadId) return;

  const upload = uploads.find((u) => u.uploadId === downloadId);
  if (upload && upload.downloadUrl) {
    // Trigger download
    const a = document.createElement("a");
    a.href = upload.downloadUrl;
    a.download = upload.filename || "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  // Clear the query param
  const url = new URL(window.location.href);
  url.searchParams.delete("download");
  history.replaceState(null, "", url.pathname + url.search);
}

// ─── Init ───

async function init() {
  if (!isLoggedIn()) {
    redirectToLogin();
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("refresh-btn").addEventListener("click", loadAll);
  document.getElementById("show-internal").addEventListener("change", applyFilter);

  document.getElementById("uploads-body").addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-mark-internal")) {
      const email = e.target.dataset.email;
      e.target.disabled = true;
      await addInternalEmail(email);
      internalEmails.add(email.toLowerCase());
      applyFilter();
    }
  });

  document.getElementById("app").style.display = "block";

  await loadAll();
}

async function loadAll() {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");

  loading.style.display = "block";
  error.style.display = "none";

  try {
    const [uploads, threads, emails] = await Promise.all([
      fetchUploads(),
      fetchSlackThreads(),
      fetchInternalEmails(),
    ]);
    internalEmails = new Set(emails.map((e) => e.toLowerCase()));
    allUploads = uploads;
    applyFilter();
    renderSlackThreads(threads);
    handleAutoDownload(uploads);
  } catch (err) {
    error.textContent = `Failed to load data: ${err.message}`;
    error.style.display = "block";
  } finally {
    loading.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", init);
