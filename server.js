const express = require("express");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

let lastData = null;
let lastIpfsHash = null;
let lastPinError = null;
let dataHistory = [];
const HISTORY_LIMIT = 10000;
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const PINATA_JWT = process.env.PINATA_JWT || "";
const PINATA_PIN_JSON_URL = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

/**
 * Verify Ed25519 signature. Payload is the exact string that was signed (sensorId, voltage, raw, ts).
 * publicKeyHex: 64 hex chars (32 bytes), signatureHex: 128 hex chars (64 bytes).
 */
function verifyEd25519(payload, publicKeyHex, signatureHex) {
  if (!payload || !publicKeyHex || !signatureHex) return false;
  try {
    const publicKeyBuffer = Buffer.from(publicKeyHex, "hex");
    const signatureBuffer = Buffer.from(signatureHex, "hex");
    if (publicKeyBuffer.length !== 32 || signatureBuffer.length !== 64) return false;
    // Node 18+: createPublicKey with raw Ed25519 via JWK
    const jwk = {
      kty: "OKP",
      crv: "Ed25519",
      x: publicKeyBuffer.toString("base64url"),
    };
    const keyObject = crypto.createPublicKey({
      key: jwk,
      format: "jwk",
    });
    return crypto.verify(null, Buffer.from(payload, "utf8"), keyObject, signatureBuffer);
  } catch (e) {
    console.error("Ed25519 verify error:", e.message);
    return false;
  }
}

/**
 * Build the canonical payload string that the sensor signs (JSON without signature/publicKey).
 */
function canonicalPayload(body) {
  return JSON.stringify({
    sensorId: body.sensorId,
    voltage: body.voltage,
    raw: body.raw,
    ts: body.ts,
  });
}

/**
 * Pin verified content to Pinata. Content includes signature and publicKey so anyone can verify.
 */
async function pinToPinata(content) {
  if (!PINATA_JWT) {
    console.warn("PINATA_JWT not set, skipping IPFS pin");
    return { IpfsHash: null, error: "PINATA_JWT not set" };
  }
  try {
    const res = await fetch(PINATA_PIN_JSON_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${PINATA_JWT}`,
      },
      body: JSON.stringify({
        pinataContent: content,
        pinataMetadata: { name: `sensor_${content.sensorId}_${content.ts}.json` },
      }),
    });
    let data;
    try {
      data = await res.json();
    } catch {
      throw new Error(`Pinata responded with ${res.status}: ${res.statusText}`);
    }
    if (!res.ok) {
      const errMsg =
        typeof data.error === "string"
          ? data.error
          : typeof data.message === "string"
            ? data.message
            : data.error?.message ?? data.message ?? (data.error && JSON.stringify(data.error)) ?? res.statusText;
      throw new Error(errMsg);
    }
    return { IpfsHash: data.IpfsHash, error: null };
  } catch (e) {
    const errMessage = e instanceof Error ? e.message : String(e);
    console.error("Pinata pin error:", errMessage);
    return { IpfsHash: null, error: errMessage };
  }
}

app.post("/update", async (req, res) => {
  const body = req.body;
  const timestamp = Date.now();
  lastData = body;
  console.log("Received:", body);

  const hasSignature = body.signature && body.publicKey;
  let verified = false;
  let ipfsResult = { IpfsHash: null, error: null };

  if (hasSignature) {
    const canonical = canonicalPayload(body);
    verified = verifyEd25519(canonical, body.publicKey, body.signature);
    if (!verified) {
      console.warn("Ed25519 verification FAILED - not pinning to IPFS");
      lastPinError = "Signature verification failed";
      res.status(400).json({ ok: false, error: "Signature verification failed" });
      return;
    }
    console.log("Ed25519 verified OK");
    ipfsResult = await pinToPinata(body);
    lastIpfsHash = ipfsResult.IpfsHash;
    lastPinError = ipfsResult.error || null;
  } else {
    console.warn("No signature/publicKey - not pinning to IPFS");
    lastPinError = "No signature";
  }

  dataHistory.push({
    timestamp,
    sensorId: body.sensorId,
    voltage: body.voltage,
    raw: body.raw,
    ts: body.ts,
    verified,
    ipfsHash: ipfsResult.IpfsHash,
  });

  if (dataHistory.length > HISTORY_LIMIT) {
    dataHistory.shift();
  }

  res.json({
    ok: true,
    verified: !!hasSignature && verified,
    ipfsHash: ipfsResult.IpfsHash,
    pinError: ipfsResult.error || null,
  });
});

app.get("/", (req, res) => {
  const ipfsLine = lastIpfsHash
    ? `<p>Last IPFS hash: <code>${lastIpfsHash}</code> (Pinata gateway: <a href="https://gateway.pinata.cloud/ipfs/${lastIpfsHash}" target="_blank">view</a>)</p>`
    : lastPinError
      ? `<p>IPFS: <em>${lastPinError}</em></p>`
      : "<p>IPFS: no pin yet (send signed payload from sensor).</p>";
  res.send(`
    <h1>Solar Panel Monitor</h1>
    ${ipfsLine}
    <pre>${JSON.stringify(lastData, null, 2)}</pre>
  `);
});

app.get("/ipfs", (req, res) => {
  res.json({ lastIpfsHash, lastPinError, lastData });
});

app.get("/api/data", (req, res) => {
  const now = Date.now();
  const weekAgo = now - ONE_WEEK_MS;
  
  const filtered = dataHistory.filter((d) => d.timestamp >= weekAgo);
  
  res.json({
    data: filtered,
    count: filtered.length,
    timeRange: {
      start: weekAgo,
      end: now,
    },
  });
});

app.get("/api/stats", (req, res) => {
  const now = Date.now();
  const weekAgo = now - ONE_WEEK_MS;
  
  const filtered = dataHistory.filter((d) => d.timestamp >= weekAgo);
  
  if (filtered.length === 0) {
    return res.json({
      count: 0,
      current: lastData ? lastData.voltage : null,
      min: null,
      max: null,
      avg: null,
      sensorId: lastData ? lastData.sensorId : null,
    });
  }
  
  const voltages = filtered.map((d) => d.voltage);
  const min = Math.min(...voltages);
  const max = Math.max(...voltages);
  const avg = (voltages.reduce((a, b) => a + b, 0) / voltages.length).toFixed(3);
  
  res.json({
    count: filtered.length,
    current: lastData ? lastData.voltage : null,
    min: min.toFixed(3),
    max: max.toFixed(3),
    avg,
    sensorId: lastData ? lastData.sensorId : null,
    lastUpdate: filtered.length > 0 ? filtered[filtered.length - 1].timestamp : null,
  });
});

const port = process.env.PORT || 3000;
app.listen(port, "0.0.0.0", () => {
  console.log("Server running on port", port);
  if (!PINATA_JWT) console.warn("Set PINATA_JWT to enable IPFS pinning");
});
