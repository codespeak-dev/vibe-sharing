// Fetch uploads and render the table

let internalEmails = new Set();
let allUploads = [];
const undoStack = [];

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
      const classes = [isInternal && "internal-row", u.unusable && "unusable-row"].filter(Boolean).join(" ");
      return `
    <tr data-upload-id="${escapeHtml(u.uploadId)}"${classes ? ` class="${classes}"` : ""}>
      <td>${isInternal ? "\u{1F6E0}\uFE0F " : ""}<a href="${escapeHtml(u.downloadUrl)}" class="download-link">${escapeHtml(u.filename)}</a></td>
      <td>${formatSize(u.sizeBytes)}</td>
      <td class="editable-cell" data-upload-id="${escapeHtml(u.uploadId)}" data-fields="userName,userEmail">${formatUserEditable(u)}</td>
      <td class="editable-cell" data-upload-id="${escapeHtml(u.uploadId)}" data-fields="repoUrl">${formatRepoEditable(u.repoUrl)}</td>
      <td class="notes-cell" data-upload-id="${escapeHtml(u.uploadId)}"><span class="notes-text">${u.notes ? escapeHtml(u.notes) : '<span class="notes-placeholder">Add note...</span>'}</span></td>
      <td>${formatDate(u.confirmedAt || u.createdAt)}</td>
      <td><button class="btn-browse" data-upload-id="${escapeHtml(u.uploadId)}" data-filename="${escapeHtml(u.filename)}">Browse</button> <button class="btn-unusable" data-upload-id="${escapeHtml(u.uploadId)}">${u.unusable ? "Usable" : "Unusable"}</button></td>
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


function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ─── Generic PATCH helper ───

async function patchUpload(uploadId, fields) {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/uploads/${encodeURIComponent(uploadId)}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(fields),
  });

  if (response.status === 401) {
    redirectToLogin();
    return;
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `API error: ${response.status}`);
  }
  return response.json();
}

// ─── Undo stack ───

function pushUndo(uploadId, fields) {
  undoStack.push({ uploadId, fields });
  updateUndoButton();
}

function updateUndoButton() {
  const btn = document.getElementById("undo-btn");
  if (undoStack.length === 0) {
    btn.style.display = "none";
  } else {
    btn.style.display = "";
    btn.textContent = `Undo (${undoStack.length})`;
  }
}

async function performUndo() {
  if (undoStack.length === 0) return;
  const entry = undoStack.pop();
  updateUndoButton();
  try {
    await patchUpload(entry.uploadId, entry.fields);
    // Update local data and re-render
    const upload = allUploads.find((u) => u.uploadId === entry.uploadId);
    if (upload) Object.assign(upload, entry.fields);
    applyFilter();
  } catch (err) {
    console.error("Undo failed:", err);
    // Push it back so the user can retry
    undoStack.push(entry);
    updateUndoButton();
  }
}

// ─── Notes inline editing ───

function startNotesEdit(cell) {
  if (cell.querySelector("textarea")) return;

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
    if (newNotes === currentNotes) {
      restoreNotesCell(cell, currentNotes);
      return;
    }
    try {
      await patchUpload(uploadId, { notes: newNotes });
      pushUndo(uploadId, { notes: currentNotes });
      if (upload) upload.notes = newNotes;
      restoreNotesCell(cell, newNotes);
    } catch (err) {
      restoreNotesCell(cell, currentNotes);
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

function restoreNotesCell(cell, notes) {
  cell.innerHTML = notes
    ? `<span class="notes-text">${escapeHtml(notes)}</span>`
    : '<span class="notes-text"><span class="notes-placeholder">Add note...</span></span>';
}

// ─── Editable cell rendering ───

function formatUserEditable(u) {
  if (!u.userName && !u.userEmail) return '<span class="editable-placeholder">Add user...</span>';

  let html = "";
  const name = u.userName || u.userEmail;
  if (u.userEmail) {
    html += `<a href="mailto:${escapeHtml(u.userEmail)}" class="download-link editable-value">${escapeHtml(name)}</a>`;
    if (u.userName && u.userEmail) {
      html += ` <span class="editable-value editable-email">${escapeHtml(u.userEmail)}</span>`;
    }
    if (!internalEmails.has(u.userEmail.toLowerCase())) {
      html += ` <button class="btn-mark-internal" data-email="${escapeHtml(u.userEmail)}">Hide</button>`;
    }
  } else {
    html += `<span class="editable-value">${escapeHtml(name)}</span>`;
  }
  return html;
}

function formatRepoUrl(raw) {
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

function formatRepoEditable(raw) {
  if (!raw) return '<span class="editable-placeholder">Add repo...</span>';
  return `<span class="editable-value">${formatRepoUrl(raw)}</span>`;
}

// ─── Inline cell editing (double-click) ───

function startCellEdit(cell) {
  if (cell.querySelector("input")) return;

  const uploadId = cell.dataset.uploadId;
  const fieldsStr = cell.dataset.fields;
  const fields = fieldsStr.split(",");
  const upload = allUploads.find((u) => u.uploadId === uploadId);
  if (!upload) return;

  const oldValues = {};
  for (const f of fields) oldValues[f] = upload[f] || "";

  cell.innerHTML = "";
  const inputs = {};

  for (const field of fields) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "inline-edit-input";
    input.value = oldValues[field];
    input.placeholder = field === "userName" ? "Name" : field === "userEmail" ? "Email" : "Repo URL";
    input.dataset.field = field;
    cell.appendChild(input);
    inputs[field] = input;
  }

  const firstInput = inputs[fields[0]];
  firstInput.focus();
  firstInput.select();

  let saved = false;

  async function save() {
    if (saved) return;
    saved = true;

    const newValues = {};
    let changed = false;
    for (const field of fields) {
      const val = inputs[field].value.trim();
      newValues[field] = val;
      if (val !== oldValues[field]) changed = true;
    }

    if (!changed) {
      restoreEditableCell(cell, upload, fieldsStr);
      return;
    }

    try {
      await patchUpload(uploadId, newValues);
      pushUndo(uploadId, oldValues);
      for (const field of fields) upload[field] = newValues[field];
      restoreEditableCell(cell, upload, fieldsStr);
    } catch (err) {
      restoreEditableCell(cell, upload, fieldsStr);
      console.error("Failed to save:", err);
    }
  }

  function cancel() {
    saved = true;
    restoreEditableCell(cell, upload, fieldsStr);
  }

  // Save on blur (with delay to allow tab between inputs in same cell)
  for (const input of Object.values(inputs)) {
    input.addEventListener("blur", () => {
      setTimeout(() => {
        if (!cell.contains(document.activeElement)) save();
      }, 50);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); save(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }
}

function restoreEditableCell(cell, upload, fieldsStr) {
  if (fieldsStr === "userName,userEmail") {
    cell.innerHTML = formatUserEditable(upload);
  } else if (fieldsStr === "repoUrl") {
    cell.innerHTML = formatRepoEditable(upload.repoUrl);
  }
}

// ─── Upload modal ───

function showUploadModal() {
  const modal = document.getElementById("upload-modal");
  document.getElementById("upload-file").value = "";
  document.getElementById("upload-email").value = "";
  document.getElementById("upload-name").value = "";
  document.getElementById("upload-repo").value = "";
  document.getElementById("upload-progress").style.display = "none";
  document.getElementById("upload-error").style.display = "none";
  document.getElementById("upload-submit").disabled = true;
  modal.style.display = "flex";
}

function hideUploadModal() {
  document.getElementById("upload-modal").style.display = "none";
}

async function handleUpload() {
  const fileInput = document.getElementById("upload-file");
  const file = fileInput.files[0];
  if (!file) return;

  const email = document.getElementById("upload-email").value.trim();
  const name = document.getElementById("upload-name").value.trim();
  const repo = document.getElementById("upload-repo").value.trim();

  const progress = document.getElementById("upload-progress");
  const error = document.getElementById("upload-error");
  const submitBtn = document.getElementById("upload-submit");

  error.style.display = "none";
  progress.textContent = "Getting upload URL...";
  progress.style.display = "block";
  submitBtn.disabled = true;

  const cfg = getConfig();

  try {
    // 1. Presign
    const presignRes = await fetch(`${cfg.apiBaseUrl}/api/v1/presign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        sizeBytes: file.size,
        contentType: "application/zip",
        ...(email && { userEmail: email }),
        ...(name && { userName: name }),
        ...(repo && { repoUrl: repo }),
      }),
    });

    if (!presignRes.ok) {
      const data = await presignRes.json().catch(() => ({}));
      throw new Error(data.error || `Presign failed: ${presignRes.status}`);
    }

    const { uploadUrl, uploadId } = await presignRes.json();

    // 2. Upload to S3
    progress.textContent = "Uploading file...";
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": "application/zip" },
      body: file,
    });

    if (!putRes.ok) throw new Error(`S3 upload failed: ${putRes.status}`);

    // 3. Confirm
    progress.textContent = "Confirming...";
    const confirmRes = await fetch(`${cfg.apiBaseUrl}/api/v1/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });

    if (!confirmRes.ok) {
      const data = await confirmRes.json().catch(() => ({}));
      throw new Error(data.error || `Confirm failed: ${confirmRes.status}`);
    }

    hideUploadModal();
    await loadAll();
  } catch (err) {
    error.textContent = err.message;
    error.style.display = "block";
    progress.style.display = "none";
    submitBtn.disabled = false;
  }
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
      <span class="dir-toggle${depth < 1 ? " open" : ""}">${escapeHtml(dir.name)}/</span>
      <span class="file-size">(${childCount} items)</span>
      <ul${depth < 1 ? "" : ' style="display: none;"'}>${renderTree(dir, depth + 1)}</ul>
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

function estimateSessions(files) {
  const claudeSessions = new Set();
  const codexSessions = new Set();
  const geminiSessions = new Set();
  const clineSessions = new Set();

  for (const f of files) {
    const p = f.path;

    const claudeMatch = p.match(/^sessions\/\.claude\/projects\/[^/]+\/([^/]+)\.jsonl$/);
    if (claudeMatch && !claudeMatch[1].startsWith("agent-")) { claudeSessions.add(claudeMatch[1]); continue; }

    const codexMatch = p.match(/^sessions\/\.codex\/.*\/(rollout-[^/]+\.jsonl?)$/);
    if (codexMatch) { codexSessions.add(codexMatch[1]); continue; }

    const geminiNewMatch = p.match(/^sessions\/\.gemini\/tmp\/[^/]+\/chats\/(session-[^/]+\.json)$/);
    if (geminiNewMatch) { geminiSessions.add(geminiNewMatch[1]); continue; }

    const geminiOldMatch = p.match(/^sessions\/\.gemini\/antigravity\/conversations\/([^/]+\.pb)$/);
    if (geminiOldMatch) { geminiSessions.add(geminiOldMatch[1]); continue; }

    const clineMatch = p.match(/^sessions\/\.cline\/data\/tasks\/([^/]+)\//);
    if (clineMatch) { clineSessions.add(clineMatch[1]); continue; }
  }

  const results = [];
  if (claudeSessions.size) results.push({ agent: "Claude Code", count: claudeSessions.size });
  if (codexSessions.size) results.push({ agent: "Codex", count: codexSessions.size });
  if (geminiSessions.size) results.push({ agent: "Gemini CLI", count: geminiSessions.size });
  if (clineSessions.size) results.push({ agent: "Cline", count: clineSessions.size });
  return results;
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
      const sessions = estimateSessions(files);
      const statsHtml = sessions.length > 0
        ? `<div class="session-stats">${sessions.map((s) => `~${s.count} session${s.count !== 1 ? "s" : ""} (${escapeHtml(s.agent)})`).join(" &middot; ")}</div>`
        : "";
      content.innerHTML = `${statsHtml}<ul class="file-tree">${renderTree(tree, 0)}</ul>`;
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

// Attach dir-toggle listener once via event delegation
document.getElementById("file-tree-content").addEventListener("click", (e) => {
  if (e.target.classList.contains("dir-toggle")) {
    e.target.classList.toggle("open");
    const ul = e.target.parentElement.querySelector("ul");
    if (ul) ul.style.display = ul.style.display === "none" ? "" : "none";
  }
});

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
  document.getElementById("undo-btn").addEventListener("click", performUndo);
  if (localStorage.getItem("show-internal") === "true") {
    document.getElementById("show-internal").checked = true;
  }

  // Upload modal
  document.getElementById("upload-btn").addEventListener("click", showUploadModal);
  document.getElementById("upload-close").addEventListener("click", hideUploadModal);
  document.getElementById("upload-cancel").addEventListener("click", hideUploadModal);
  document.getElementById("upload-submit").addEventListener("click", handleUpload);
  document.getElementById("upload-file").addEventListener("change", (e) => {
    document.getElementById("upload-submit").disabled = !e.target.files.length;
  });
  document.getElementById("upload-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) hideUploadModal();
  });

  const uploadsBody = document.getElementById("uploads-body");

  uploadsBody.addEventListener("click", async (e) => {
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

    if (e.target.classList.contains("btn-unusable")) {
      const uploadId = e.target.dataset.uploadId;
      const upload = allUploads.find((u) => u.uploadId === uploadId);
      if (!upload) return;
      const newVal = !upload.unusable;
      e.target.disabled = true;
      try {
        await patchUpload(uploadId, { unusable: newVal });
        pushUndo(uploadId, { unusable: upload.unusable || false });
        upload.unusable = newVal;
        applyFilter();
      } catch (err) {
        console.error("Failed to toggle unusable:", err);
        e.target.disabled = false;
      }
    }

    const cell = e.target.closest(".notes-cell");
    if (cell) startNotesEdit(cell);
  });

  // Double-click to edit cells
  uploadsBody.addEventListener("dblclick", (e) => {
    const cell = e.target.closest(".editable-cell");
    if (cell) startCellEdit(cell);
  });

  // File tree modal: close on button, Esc, or click outside
  document.getElementById("file-tree-close").addEventListener("click", closeFileTreeModal);
  document.getElementById("file-tree-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) closeFileTreeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeFileTreeModal();
      hideUploadModal();
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
