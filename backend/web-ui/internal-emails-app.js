// Internal Emails management page

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

async function fetchInternalEmails() {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/internal-emails`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 401) {
    redirectToLogin();
    return [];
  }
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

async function removeInternalEmail(email) {
  const cfg = getConfig();
  const token = getIdToken();

  const response = await fetch(`${cfg.apiBaseUrl}/api/v1/internal-emails`, {
    method: "DELETE",
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

function renderEmails(emails) {
  const tbody = document.getElementById("emails-body");
  const table = document.getElementById("emails-table");
  const empty = document.getElementById("empty-state");

  if (emails.length === 0) {
    tbody.innerHTML = "";
    table.style.display = "none";
    empty.style.display = "block";
    return;
  }

  empty.style.display = "none";
  table.style.display = "";
  tbody.innerHTML = emails
    .map(
      (email) => `
    <tr>
      <td>${escapeHtml(email)}</td>
      <td><button class="btn-remove" data-email="${escapeHtml(email)}">Remove</button></td>
    </tr>`
    )
    .join("");
}

async function loadEmails() {
  const loading = document.getElementById("loading");
  const error = document.getElementById("error");

  loading.style.display = "block";
  error.style.display = "none";

  try {
    const emails = await fetchInternalEmails();
    renderEmails(emails);
  } catch (err) {
    error.textContent = `Failed to load: ${err.message}`;
    error.style.display = "block";
  } finally {
    loading.style.display = "none";
  }
}

async function handleAdd() {
  const input = document.getElementById("new-email");
  const email = input.value.trim().toLowerCase();
  if (!email || !email.includes("@")) return;

  const error = document.getElementById("error");
  error.style.display = "none";

  try {
    await addInternalEmail(email);
    input.value = "";
    await loadEmails();
  } catch (err) {
    error.textContent = `Failed to add: ${err.message}`;
    error.style.display = "block";
  }
}

async function init() {
  if (!isLoggedIn()) {
    redirectToLogin();
    return;
  }

  document.getElementById("logout-btn").addEventListener("click", logout);
  document.getElementById("add-btn").addEventListener("click", handleAdd);
  document.getElementById("new-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") handleAdd();
  });

  document.getElementById("emails-body").addEventListener("click", async (e) => {
    if (e.target.classList.contains("btn-remove")) {
      const email = e.target.dataset.email;
      e.target.disabled = true;

      const error = document.getElementById("error");
      error.style.display = "none";

      try {
        await removeInternalEmail(email);
        await loadEmails();
      } catch (err) {
        error.textContent = `Failed to remove: ${err.message}`;
        error.style.display = "block";
      }
    }
  });

  document.getElementById("app").style.display = "block";

  await loadEmails();
}

document.addEventListener("DOMContentLoaded", init);
