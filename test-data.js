/**
 * Test data generator - sends simulated sensor data to the server
 * Usage: node test-data.js
 * 
 * This script generates synthetic voltage readings to test the dashboard.
 * In production, real data will come from the ESP12F sensor.
 */

const http = require("http");

const SERVER_URL = "http://localhost:3000/update";

function generateRandomVoltage() {
  const baseVoltage = 3.5;
  const variance = (Math.random() - 0.5) * 0.3;
  return parseFloat((baseVoltage + variance).toFixed(3));
}

function sendTestData() {
  const payload = {
    sensorId: "perovskite_sensor_01",
    voltage: generateRandomVoltage(),
    raw: Math.floor(Math.random() * 1023),
    ts: Date.now(),
  };

  const jsonPayload = JSON.stringify(payload);

  const options = {
    hostname: "127.0.0.1",
    port: 3000,
    path: "/update",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(jsonPayload),
    },
  };

  const req = http.request(options, (res) => {
    let data = "";
    res.on("data", (chunk) => {
      data += chunk;
    });
    res.on("end", () => {
      console.log(
        `[${new Date().toLocaleTimeString()}] Sent voltage: ${payload.voltage}V - Response: ${res.statusCode}`
      );
    });
  });

  req.on("error", (e) => {
    console.error(`Problem with request: ${e.message}`);
  });

  req.write(jsonPayload);
  req.end();
}

console.log("🚀 Starting test data generator...");
console.log("Sending data every 5 seconds to http://127.0.0.1:3000/update");
console.log("Press Ctrl+C to stop.\n");

sendTestData();
setInterval(sendTestData, 5000);
