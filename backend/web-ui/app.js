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
  localStorage.setItem("show-internal", showInternal);
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
    .map((u) => {
      const isInternal =
        u.userEmail && internalEmails.has(u.userEmail.toLowerCase());
      return `
    <tr data-upload-id="${escapeHtml(u.uploadId)}"${isInternal ? ' class="internal-row"' : ""}>
      <td>${isInternal ? "\u{1F6E0}\uFE0F " : ""}<a href="${escapeHtml(u.downloadUrl)}" class="download-link">${escapeHtml(u.filename)}</a></td>
      <td>${formatSize(u.sizeBytes)}</td>
      <td>${formatUser(u)}</td>
      <td>${formatRepoUrl(u.repoUrl)}</td>
      <td class="notes-cell" data-upload-id="${escapeHtml(u.uploadId)}"><span class="notes-text">${u.notes ? escapeHtml(u.notes) : '<span class="notes-placeholder">Add note...</span>'}</span></td>
      <td>${formatDate(u.confirmedAt || u.createdAt)}</td>
      <td><button class="btn-browse" data-upload-id="${escapeHtml(u.uploadId)}" data-filename="${escapeHtml(u.filename)}">Browse</button></td>
    </tr>`;
    })
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

// ─── Notes inline editing ───

async function updateNotes(uploadId, notes) {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ notes }),
  });

  if (response.status === 401) {
    redirectToLogin();
    return;
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);
  return response.json();
}

function startNotesEdit(cell) {
  if (cell.querySelector("textarea")) return; // already editing

  const uploadId = cell.dataset.uploadId;
  const upload = allUploads.find((u) => u.uploadId === uploadId);
  const currentNotes = upload?.notes || "";

  const textarea = document.createElement("textarea");
  textarea.className = "notes-input";
  textarea.value = currentNotes;
  textarea.maxLength = 2000;

  cell.textContent = "";
  cell.appendChild(textarea);
  textarea.focus();

  async function save() {
    const newNotes = textarea.value.trim();
    try {
      await updateNotes(uploadId, newNotes);
      if (upload) upload.notes = newNotes;
      cell.innerHTML = newNotes
        ? `<span class="notes-text">${escapeHtml(newNotes)}</span>`
        : '<span class="notes-text"><span class="notes-placeholder">Add note...</span></span>';
    } catch (err) {
      cell.innerHTML = currentNotes
        ? `<span class="notes-text">${escapeHtml(currentNotes)}</span>`
        : '<span class="notes-text"><span class="notes-placeholder">Add note...</span></span>';
      console.error("Failed to save notes:", err);
    }
  }

  textarea.addEventListener("blur", save);
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      textarea.blur();
    }
    if (e.key === "Escape") {
      textarea.value = currentNotes;
      textarea.blur();
    }
  });
}

// ─── File tree modal ───

const fileTreeCache = new Map();

async function fetchFileTree(uploadId) {
  if (fileTreeCache.has(uploadId)) return fileTreeCache.get(uploadId);

  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(
    `${cfg.apiBaseUrl}/api/v1/uploads/${encodeURIComponent(uploadId)}/files`,
    { headers: { Authorization: `Bearer ${token}` } }
  );

  if (response.status === 401) {
    redirectToLogin();
    return [];
  }
  if (!response.ok) throw new Error(`API error: ${response.status}`);

  const data = await response.json();
  fileTreeCache.set(uploadId, data.files);
  return data.files;
}

function buildTree(files) {
  const root = { name: "", children: {}, files: [] };

  for (const f of files) {
    const parts = f.path.split("/");
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const dir = parts[i];
      if (!node.children[dir]) {
        node.children[dir] = { name: dir, children: {}, files: [] };
      }
      node = node.children[dir];
    }
    node.files.push({ name: parts[parts.length - 1], size: f.size, compressedSize: f.compressedSize });
  }

  return root;
}

function renderTree(node, depth) {
  let html = "";

  // Sort directories first, then files, both alphabetically
  const dirs = Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));

  for (const dir of dirs) {
    const childCount = countEntries(dir);
    html += `<li>
      <span class="dir-toggle${depth < 2 ? " open" : ""}">${escapeHtml(dir.name)}/</span>
      <span class="file-size">(${childCount} items)</span>
      <ul${depth < 2 ? "" : ' style="display: none;"'}>${renderTree(dir, depth + 1)}</ul>
    </li>`;
  }

  for (const file of files) {
    html += `<li class="file-entry">${escapeHtml(file.name)} <span class="file-size">${formatSize(file.size)}</span></li>`;
  }

  return html;
}

function countEntries(node) {
  let count = node.files.length;
  for (const child of Object.values(node.children)) {
    count += countEntries(child);
  }
  return count;
}

function openFileTreeModal(uploadId, filename) {
  const modal = document.getElementById("file-tree-modal");
  const title = document.getElementById("file-tree-title");
  const loading = document.getElementById("file-tree-loading");
  const error = document.getElementById("file-tree-error");
  const content = document.getElementById("file-tree-content");

  title.textContent = `Files in ${filename}`;
  loading.style.display = "block";
  error.style.display = "none";
  content.innerHTML = "";
  modal.style.display = "flex";

  fetchFileTree(uploadId)
    .then((files) => {
      loading.style.display = "none";
      if (!files || files.length === 0) {
        content.innerHTML = '<p class="empty-tree">No files found in archive.</p>';
        return;
      }
      const tree = buildTree(files);
      content.innerHTML = `<ul class="file-tree">${renderTree(tree, 0)}</ul>`;

      // Attach toggle listeners
      content.addEventListener("click", (e) => {
        if (e.target.classList.contains("dir-toggle")) {
          e.target.classList.toggle("open");
          const ul = e.target.parentElement.querySelector("ul");
          if (ul) ul.style.display = ul.style.display === "none" ? "" : "none";
        }
      });
    })
    .catch((err) => {
      loading.style.display = "none";
      error.textContent = `Failed to load files: ${err.message}`;
      error.style.display = "block";
    });
}

function closeFileTreeModal() {
  document.getElementById("file-tree-modal").style.display = "none";
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
  if (localStorage.getItem("show-internal") === "true") {
    document.getElementById("show-internal").checked = true;
  }

  document.getElementById("uploads-body").addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-mark-internal")) {
      const email = e.target.dataset.email;
      e.target.disabled = true;
      await addInternalEmail(email);
      internalEmails.add(email.toLowerCase());
      applyFilter();
    }

    if (e.target.classList.contains("btn-browse")) {
      const uploadId = e.target.dataset.uploadId;
      const filename = e.target.dataset.filename;
      openFileTreeModal(uploadId, filename);
    }

    const cell = e.target.closest(".notes-cell");
    if (cell) startNotesEdit(cell);
  });

  // File tree modal: close on button, Esc, or click outside
  document.getElementById("file-tree-close").addEventListener("click", closeFileTreeModal);
  document.getElementById("file-tree-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeFileTreeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeFileTreeModal();
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
