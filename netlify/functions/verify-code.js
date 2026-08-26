const { getStore } = require("@netlify/blobs");

// Max distinct devices allowed per code — locked to a single device so a
// code can't be forwarded to someone else and used in parallel.
const DEVICE_LIMIT = 1;

// See admin-codes.js for why this manual-config fallback exists.
function getCodesStore() {
  const siteID = process.env.BLOBS_SITE_ID;
  const token = process.env.BLOBS_TOKEN;
  if (siteID && token) {
    return getStore({ name: "access-codes", siteID, token });
  }
  return getStore("access-codes");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { valid: false });
  }

  let code, email, deviceId;
  try {
    ({ code, email, deviceId } = JSON.parse(event.body || "{}"));
  } catch (e) {
    return json(400, { valid: false });
  }
  if (!code || typeof code !== "string" || !email || typeof email !== "string") {
    return json(400, { valid: false });
  }

  const store = getCodesStore();
  const codes = (await store.get("codes", { type: "json" })) || {};
  const key = code.trim().toUpperCase();
  const entry = codes[key];

  const emailMatches = !!entry && (entry.email || "").trim().toLowerCase() === email.trim().toLowerCase();
  const isActive = !!entry && entry.active !== false;

  if (!entry || !isActive || !emailMatches) {
    return json(200, { valid: false, reason: "invalid" });
  }

  // No device id (older client) — allow through without device tracking.
  if (!deviceId || typeof deviceId !== "string") {
    return json(200, { valid: true });
  }

  const devices = entry.devices || [];
  if (!devices.includes(deviceId)) {
    if (devices.length >= DEVICE_LIMIT) {
      return json(200, { valid: false, reason: "device-limit" });
    }
    devices.push(deviceId);
    entry.devices = devices;
    codes[key] = entry;
    await store.setJSON("codes", codes);
  }

  return json(200, { valid: true });
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  };
}
