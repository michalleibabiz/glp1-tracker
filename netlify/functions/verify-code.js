const { getStore } = require("@netlify/blobs");

// Max distinct devices allowed per code — covers one real person's phone +
// computer + tablet, while blocking obvious reselling/forwarding of a code.
const DEVICE_LIMIT = 3;

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

  const store = getStore("access-codes");
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
