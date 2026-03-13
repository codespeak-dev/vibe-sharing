// Fetch uploads and render the table

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

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(isoStr) {
  if (!isoStr) return "—";
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
    <tr>
      <td><a href="${escapeHtml(u.downloadUrl)}" class="download-link">${escapeHtml(u.filename)}</a></td>
      <td>${formatSize(u.sizeBytes)}</td>
      <td>${formatUser(u)}</td>
      <td>${formatRepoUrl(u.repoUrl)}</td>
      <td>${formatDate(u.confirmedAt || u.createdAt)}</td>
    </tr>`
    )
    .join("");
}

function formatUser(u) {
  const name = u.userName || u.userEmail || "—";
  if (u.userEmail) {
    return `<a href="mailto:${escapeHtml(u.userEmail)}" class="download-link">${escapeHtml(name)}</a>`;
  }
  return escapeHtml(name);
}

function formatRepoUrl(raw) {
  if (!raw) return "—";

  // Try to extract user/repo from any GitHub URL form:
  //   git@github.com:user/repo.git
  //   ssh://git@github.com/user/repo
  //   git+ssh://git@github.com/user/repo.git
  //   git://github.com/user/repo.git
  //   git+https://github.com/user/repo.git
  //   https://github.com/user/repo.git
  //   http://github.com/user/repo
  //   github.com/user/repo
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

  // Non-GitHub URL: show as clickable link
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

async function init() {
  if (!isLoggedIn()) {
    redirectToLogin();
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("refresh-btn").addEventListener("click", loadUploads);
  document.getElementById("app").style.display = "block";

  await loadUploads();
}

async function loadUploads() {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");

  loading.style.display = "block";
  error.style.display = "none";

  try {
    const uploads = await fetchUploads();
    renderUploads(uploads);
  } catch (err) {
    error.textContent = `Failed to load uploads: ${err.message}`;
    error.style.display = "block";
  } finally {
    loading.style.display = "none";
  }
}

document.addEventListener("DOMContentLoaded", init);
