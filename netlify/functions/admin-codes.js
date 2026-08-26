const { getStore } = require("@netlify/blobs");
const crypto = require("crypto");

// Netlify normally auto-configures Blobs for functions with zero setup.
// If that auto-detection ever fails ("MissingBlobsEnvironmentError"), set
// BLOBS_SITE_ID and BLOBS_TOKEN env vars (site ID from Site configuration →
// General; token from User settings → Applications → New access token) to
// configure it manually instead.
function getCodesStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: "access-codes", siteID, token });
  }
  return getStore("access-codes");
}

exports.handler = async (event) => {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return json(500, { error: "ADMIN_PASSWORD not configured" });
  }

  const provided = event.headers["x-admin-password"] || event.headers["X-Admin-Password"];
  if (provided !== adminPassword) {
    return json(401, { error: "Unauthorized" });
  }

  const store = getCodesStore();

  if (event.httpMethod === "GET") {
    const codes = (await store.get("codes", { type: "json" })) || {};
    const list = Object.entries(codes)
      .map(([code, meta]) => {
        const { devices, ...rest } = meta;
        return { code, ...rest, deviceCount: (devices || []).length };
      })
      .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return json(200, { codes: list });
  }

  if (event.httpMethod === "POST") {
    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { error: "Invalid body" });
    }
    const codes = (await store.get("codes", { type: "json" })) || {};

    if (body.action === "add") {
      const name = (body.name || "").trim();
      const email = (body.email || "").trim().toLowerCase();
      const phone = (body.phone || "").trim();
      if (!name) return json(400, { error: "Name required" });
      if (!email || !email.includes("@")) return json(400, { error: "Valid email required" });
      const newCode = generateCode();
      codes[newCode] = { name, email, phone, active: true, createdAt: new Date().toISOString() };
      await store.setJSON("codes", codes);
      return json(200, { code: newCode, email });
    }

    if (body.action === "toggle") {
      const code = (body.code || "").trim().toUpperCase();
      if (!codes[code]) return json(404, { error: "Code not found" });
      codes[code].active = !codes[code].active;
      await store.setJSON("codes", codes);
      return json(200, { code, active: codes[code].active });
    }

    if (body.action === "reset-devices") {
      const code = (body.code || "").trim().toUpperCase();
      if (!codes[code]) return json(404, { error: "Code not found" });
      codes[code].devices = [];
      await store.setJSON("codes", codes);
      return json(200, { code, deviceCount: 0 });
    }

    return json(400, { error: "Unknown action" });
  }

  return json(405, { error: "Method Not Allowed" });
};

function generateCode() {
  return crypto.randomBytes(3).toString("hex").toUpperCase();
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
