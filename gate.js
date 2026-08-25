(function () {
  const CODE_KEY = "glp1_access_code";
  const EMAIL_KEY = "glp1_access_email";
  const DEVICE_KEY = "glp1_device_id";
  const gate = document.getElementById("gate");
  const rootEl = document.getElementById("root");
  const form = document.getElementById("gate-form");
  const emailInput = document.getElementById("gate-email");
  const codeInput = document.getElementById("gate-input");
  const errorEl = document.getElementById("gate-error");
  const submitBtn = document.getElementById("gate-submit");

  function getDeviceId() {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : "dev-" + Date.now() + "-" + Math.random().toString(16).slice(2);
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  }

  function showApp() {
    window.__glp1Unlocked = true;
    gate.style.display = "none";
    rootEl.style.display = "block";
    if (window.mountGlp1App) window.mountGlp1App();
  }

  function isLocalNetwork() {
    const h = location.hostname;
    if (h === "localhost" || h === "127.0.0.1") return true;
    return /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(h);
  }

  if (isLocalNetwork()) {
    showApp();
    return;
  }

  function showGate(message) {
    gate.style.display = "flex";
    rootEl.style.display = "none";
    errorEl.textContent = message || "";
  }

  function setFormDisabled(disabled) {
    submitBtn.disabled = disabled;
    emailInput.disabled = disabled;
    codeInput.disabled = disabled;
  }

  async function verify(code, email) {
    try {
      const res = await fetch("/.netlify/functions/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email, deviceId: getDeviceId() }),
      });
      return await res.json();
    } catch (e) {
      return { valid: false };
    }
  }

  function messageFor(result) {
    if (result.reason === "device-limit") {
      return "הקוד הזה כבר בשימוש במספר המרבי של מכשירים. פני למי שמכר לך את הגישה כדי לאפס.";
    }
    return "אימייל או קוד שגויים. בדקו שוב או פנו למי ששלח לכם את הקוד.";
  }

  const storedCode = localStorage.getItem(CODE_KEY);
  const storedEmail = localStorage.getItem(EMAIL_KEY);
  if (storedCode && storedEmail) {
    setFormDisabled(true);
    errorEl.textContent = "בודק גישה...";
    verify(storedCode, storedEmail).then((result) => {
      setFormDisabled(false);
      if (result.valid) {
        showApp();
      } else {
        localStorage.removeItem(CODE_KEY);
        localStorage.removeItem(EMAIL_KEY);
        showGate(messageFor(result));
      }
    });
  } else {
    showGate();
  }

  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    const code = codeInput.value.trim();
    const email = emailInput.value.trim();
    if (!code || !email) return;
    setFormDisabled(true);
    errorEl.textContent = "";
    const result = await verify(code, email);
    setFormDisabled(false);
    if (result.valid) {
      localStorage.setItem(CODE_KEY, code);
      localStorage.setItem(EMAIL_KEY, email);
      showApp();
    } else {
      errorEl.textContent = messageFor(result);
    }
  });
})();
