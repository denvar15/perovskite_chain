const express = require("express");
const crypto = require("crypto");
const path = require("path");
const readline = require("readline");

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
const DEFAULT_CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || "";
const DEFAULT_IPFS_GATEWAY_BASE = process.env.IPFS_GATEWAY_BASE || "https://gateway.pinata.cloud/ipfs/";
// Dashboard MetaMask target chain (Sepolia default; use Polygon Amoy for README_polygon.md flow)
const WEB3_CHAIN_ID = Number(process.env.WEB3_CHAIN_ID || 11155111);
const WEB3_CHAIN_ID_HEX = process.env.WEB3_CHAIN_ID_HEX || "0xaa36a7";
const WEB3_CHAIN_NAME = process.env.WEB3_CHAIN_NAME || "Sepolia";

// Data source mode: "real" (ESP POST) or "synthetic" (generated server-side)
let sourceMode = "real";
let syntheticTimer = null;

// EMA-based sudden drop warning state
const EMA_ALPHA = Number(process.env.EMA_ALPHA || 0.2);
const LOW_LEVEL_THRESHOLD_V = Number(process.env.LOW_LEVEL_THRESHOLD_V || 0.05); // malfunction level threshold
let emaVoltage = null;
let warningState = {
  active: false,
  message: null,
  dropPercent: 0,
  currentVoltage: null,
  emaVoltage: null,
  timestamp: null,
};

// UI "Run Panel Check" status
let panelStatus = {
  state: "idle", // idle | running | ok | warning | error
  message: "No checks run yet.",
  checkedAt: null,
  lastInput: null,
};

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
  const canonical = {
    sensorId: body.sensorId,
    voltage: body.voltage,
    raw: body.raw,
    ts: body.ts,
  };
  if (body.current != null) canonical.current = body.current;
  if (body.adcVoltage != null) canonical.adcVoltage = body.adcVoltage;
  return JSON.stringify(canonical);
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

function evaluateWarning(voltage, sensorId) {
  if (!Number.isFinite(voltage)) return;

  if (emaVoltage == null) {
    emaVoltage = voltage;
    warningState = {
      active: false,
      message: null,
      dropPercent: 0,
      currentVoltage: voltage,
      emaVoltage,
      timestamp: Date.now(),
    };
    return;
  }

  const nextEma = EMA_ALPHA * voltage + (1 - EMA_ALPHA) * emaVoltage;
  const isLowByLevel = voltage <= LOW_LEVEL_THRESHOLD_V || nextEma <= LOW_LEVEL_THRESHOLD_V;
  const absDropV = emaVoltage - voltage;
  const dropFraction = emaVoltage > 0 ? absDropV / emaVoltage : 0;

  if (isLowByLevel) {
    warningState = {
      active: true,
      message: `NON-WARRANTY BOARD MALFUNCTION: voltage is below average level threshold on ${sensorId || "sensor"} (V=${voltage.toFixed(3)} V, EMA=${nextEma.toFixed(3)} V, threshold=${LOW_LEVEL_THRESHOLD_V.toFixed(3)} V).`,
      dropPercent: Number((dropFraction * 100).toFixed(2)),
      currentVoltage: voltage,
      emaVoltage: Number(nextEma.toFixed(4)),
      timestamp: Date.now(),
    };
  } else {
    warningState = {
      active: false,
      message: null,
      dropPercent: Number((dropFraction * 100).toFixed(2)),
      currentVoltage: voltage,
      emaVoltage: Number(nextEma.toFixed(4)),
      timestamp: Date.now(),
    };
  }

  emaVoltage = nextEma;
}

function pushDataPoint(body, source, verified = false, ipfsHash = null) {
  const timestamp = Date.now();
  const voltage = Number(body.voltage);
  const point = {
    timestamp,
    sensorId: body.sensorId || "unknown_sensor",
    voltage: Number.isFinite(voltage) ? voltage : null,
    raw: body.raw ?? null,
    ts: body.ts ?? null,
    verified,
    ipfsHash,
    source,
  };

  lastData = body;
  dataHistory.push(point);
  if (dataHistory.length > HISTORY_LIMIT) dataHistory.shift();

  if (Number.isFinite(voltage)) evaluateWarning(voltage, body.sensorId);
}

function startSyntheticGenerator() {
  let t = 0;
  syntheticTimer = setInterval(() => {
    t += 1;
    // Smooth synthetic signal for small panels (0..2V range) + small noise
    const base = 1.35 + Math.sin(t / 10) * 0.35; // roughly 1.0..1.7V before noise
    const noise = (Math.random() - 0.5) * 0.04;
    let voltage = base + noise;

    // Occasional sharp drop events to demonstrate warning UX
    if (t % 45 === 0) voltage -= 0.08;
    if (t % 120 === 0) voltage -= 0.12;
    if (voltage < 0) voltage = 0;
    if (voltage > 2.0) voltage = 2.0;

    const payload = {
      sensorId: "synthetic_panel",
      voltage: Number(voltage.toFixed(3)),
      raw: null,
      ts: Date.now(),
    };
    pushDataPoint(payload, "synthetic", false, null);
  }, 2000);
}

async function chooseModeAtStartup() {
  const envMode = (process.env.DASHBOARD_MODE || "").toLowerCase().trim();
  if (envMode === "real" || envMode === "synthetic") {
    sourceMode = envMode;
    return;
  }

  // Render, Docker, systemd, etc. have no interactive TTY — readline would exit or hang.
  if (!process.stdin.isTTY) {
    sourceMode = "real";
    console.log(
      "Non-interactive startup: using real mode (ESP POST /update). Set DASHBOARD_MODE=real or synthetic explicitly."
    );
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const answer = await new Promise((resolve) => {
    rl.question(
      "Start mode: [1] Real ESP32 POST data, [2] Synthetic dashboard data (default 1): ",
      resolve
    );
  });
  rl.close();

  sourceMode = answer && answer.trim() === "2" ? "synthetic" : "real";
}

app.post("/update", async (req, res) => {
  if (sourceMode === "synthetic") {
    return res.status(409).json({
      ok: false,
      error: "Server is in synthetic mode; real POST updates are disabled.",
      mode: sourceMode,
    });
  }

  const body = req.body;
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

  pushDataPoint(body, "real", verified, ipfsResult.IpfsHash);

  res.json({
    ok: true,
    verified: !!hasSignature && verified,
    ipfsHash: ipfsResult.IpfsHash,
    pinError: ipfsResult.error || null,
  });
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
    mode: sourceMode,
    warning: warningState,
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
      mode: sourceMode,
      warning: warningState,
      panelStatus,
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
    mode: sourceMode,
    warning: warningState,
    panelStatus,
  });
});

app.get("/api/config", (req, res) => {
  res.json({
    mode: sourceMode,
    chainId: WEB3_CHAIN_ID,
    chainIdHex: WEB3_CHAIN_ID_HEX,
    chainName: WEB3_CHAIN_NAME,
    defaultContractAddress: DEFAULT_CONTRACT_ADDRESS,
    defaultIpfsGatewayBase: DEFAULT_IPFS_GATEWAY_BASE,
  });
});

app.post("/api/panel-check", async (req, res) => {
  panelStatus = {
    state: "running",
    message: "Panel check is running...",
    checkedAt: Date.now(),
    lastInput: req.body || null,
  };

  // Placeholder integration point for blockchain action.
  // In production, call your contract request script/SDK here.
  await new Promise((r) => setTimeout(r, 600));

  if (!lastData || !Number.isFinite(Number(lastData.voltage))) {
    panelStatus = {
      state: "error",
      message: "Panel check failed: no latest voltage sample available.",
      checkedAt: Date.now(),
      lastInput: req.body || null,
    };
    return res.status(400).json({ ok: false, panelStatus });
  }

  const currentV = Number(lastData.voltage);
  const lowThreshold = Number(process.env.PANEL_LOW_THRESHOLD || LOW_LEVEL_THRESHOLD_V);
  const warn = currentV < lowThreshold || warningState.active;
  panelStatus = {
    state: warn ? "warning" : "ok",
    message: warn
      ? `New Panel Status: ATTENTION. Voltage ${currentV.toFixed(3)} V or EMA anomaly requires review before blockchain action.`
      : `New Panel Status: NORMAL. Voltage ${currentV.toFixed(3)} V, panel check passed.`,
    checkedAt: Date.now(),
    lastInput: req.body || null,
  };

  res.json({
    ok: true,
    panelStatus,
    mode: sourceMode,
    warning: warningState,
    latestVoltage: currentV,
    ipfsHash: lastIpfsHash,
  });
});

const port = process.env.PORT || 3000;

async function startServer() {
  await chooseModeAtStartup();
  if (sourceMode === "synthetic") {
    startSyntheticGenerator();
    console.log("Synthetic mode enabled: generating sample readings every 2s.");
  } else {
    console.log("Real mode enabled: waiting for ESP32 POST /update.");
  }

  app.listen(port, "0.0.0.0", () => {
    console.log("Server running on port", port);
    console.log("Dashboard mode:", sourceMode);
    if (!PINATA_JWT) console.warn("Set PINATA_JWT to enable IPFS pinning");
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
