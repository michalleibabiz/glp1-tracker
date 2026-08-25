(function () {
  const PASS_KEY = "glp1_admin_password";
  const loginPanel = document.getElementById("admin-login");
  const panel = document.getElementById("admin-panel");
  const passInput = document.getElementById("admin-password");
  const loginBtn = document.getElementById("admin-login-btn");
  const loginError = document.getElementById("admin-login-error");
  const addForm = document.getElementById("admin-add-form");
  const nameInput = document.getElementById("admin-name-input");
  const emailInput = document.getElementById("admin-email-input");
  const newCodeEl = document.getElementById("admin-new-code");
  const tableBody = document.getElementById("admin-table-body");

  let adminPassword = sessionStorage.getItem(PASS_KEY) || "";

  async function api(method, body) {
    const res = await fetch("/.netlify/functions/admin-codes", {
      method: method,
      headers: {
        "Content-Type": "application/json",
        "x-admin-password": adminPassword,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) throw new Error("unauthorized");
    if (!res.ok) throw new Error("request-failed");
    return res.json();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  async function loadCodes() {
    const data = await api("GET");
    tableBody.innerHTML = "";
    data.codes.forEach(function (c) {
      const tr = document.createElement("tr");
      tr.innerHTML =
        "<td>" + escapeHtml(c.name || "") + "</td>" +
        "<td>" + escapeHtml(c.email || "") + "</td>" +
        "<td class=\"mono\">" + escapeHtml(c.code) + "</td>" +
        "<td>" + (c.active ? "פעיל" : "בוטל") + "</td>" +
        "<td>" + (c.deviceCount || 0) + " / 3</td>" +
        "<td></td>";
      const actionsCell = tr.lastElementChild;

      const toggleBtn = document.createElement("button");
      toggleBtn.textContent = c.active ? "בטל" : "הפעל מחדש";
      toggleBtn.className = c.active ? "danger" : "";
      toggleBtn.addEventListener("click", async function () {
        await api("POST", { action: "toggle", code: c.code });
        loadCodes();
      });
      actionsCell.appendChild(toggleBtn);

      const resetBtn = document.createElement("button");
      resetBtn.textContent = "איפוס מכשירים";
      resetBtn.className = "secondary";
      resetBtn.addEventListener("click", async function () {
        await api("POST", { action: "reset-devices", code: c.code });
        loadCodes();
      });
      actionsCell.appendChild(resetBtn);

      tableBody.appendChild(tr);
    });
  }

  async function login() {
    adminPassword = passInput.value;
    loginError.textContent = "";
    try {
      await loadCodes();
      sessionStorage.setItem(PASS_KEY, adminPassword);
      loginPanel.hidden = true;
      panel.hidden = false;
    } catch (e) {
      loginError.textContent = "סיסמה שגויה או שגיאת שרת";
    }
  }

  loginBtn.addEventListener("click", login);
  passInput.addEventListener("keydown", function (e) {
    if (e.key === "Enter") login();
  });

  addForm.addEventListener("submit", async function (e) {
    e.preventDefault();
    const name = nameInput.value.trim();
    const email = emailInput.value.trim();
    if (!name || !email) return;
    const data = await api("POST", { action: "add", name: name, email: email });
    newCodeEl.textContent = "קוד חדש עבור " + name + " (" + email + "): " + data.code;
    nameInput.value = "";
    emailInput.value = "";
    loadCodes();
  });

  if (adminPassword) login();
})();
