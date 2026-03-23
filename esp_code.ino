/*
 * Perovskite Chain - ESP32-S with 0-25V voltage sensor module
 *
 * Typical 0-25V sensor modules use a divider (often 30k/7.5k), so:
 *   V_sensor_out = V_input / SENSOR_DIVIDER_RATIO
 *   V_input      = V_sensor_out * SENSOR_DIVIDER_RATIO
 *
 * IMPORTANT:
 * - ESP32 ADC pin must never exceed 3.3V.
 * - Many "0-25V Arduino" modules output up to 5V at 25V input.
 *   If your module can exceed 3.3V, add an extra divider before GPIO34.
 */

 #include <WiFi.h>
 #include <HTTPClient.h>
 
 const char* ssid     = "Xiaomi 14T";
 const char* password = "11111111";
 const char* server   = "http://10.82.83.185:3000/update";
 
// Voltage sensor configuration
const float SENSOR_DIVIDER_RATIO = 5.0f;   // Typical for 0-25V modules; adjust if your module differs
const int   SEND_INTERVAL     = 1 * 60 * 1000;  // 1 minute
const char* SENSOR_ID         = "perovskite_sensor_01";
 
// ESP32 analog pin (GPIO34 is ADC1 input-only, good for sensing)
const int ANALOG_PIN = 34;
const float ADC_VREF = 3.3f;
const int ADC_MAX = 4095;
const unsigned long WIFI_TIMEOUT_MS = 20000;
const unsigned long WIFI_RETRY_MS = 5000;
unsigned long lastWifiRetry = 0;
float inputVoltageCalibrationFactor = 1.0f;

const int CALIBRATION_SAMPLES = 5;
const unsigned long CALIBRATION_PROMPT_TIMEOUT_MS = 15000;

float rawToAdcVoltage(int raw) {
  return raw * (ADC_VREF / ADC_MAX);
}

float adcToInputVoltage(float adcVoltage) {
  return adcVoltage * SENSOR_DIVIDER_RATIO;
}

float readAverageInputVoltage(int samples) {
  long sumRaw = 0;
  for (int i = 0; i < samples; i++) {
    sumRaw += analogRead(ANALOG_PIN);
    delay(120);
  }
  float avgRaw = (float)sumRaw / (float)samples;
  float avgAdcVoltage = rawToAdcVoltage((int)avgRaw);
  return adcToInputVoltage(avgAdcVoltage);
}

void calibrateVoltageFromSerial() {
  Serial.println();
  Serial.println("Calibration (optional):");
  Serial.println("- Type REAL input voltage in Volts (measured by multimeter), then Enter.");
  Serial.println("- Example: 12.40");
  Serial.println("- Or press Enter / wait 15s to skip");
  Serial.print("Reference input V = ");

  String line = "";
  unsigned long start = millis();
  while (millis() - start < CALIBRATION_PROMPT_TIMEOUT_MS) {
    while (Serial.available() > 0) {
      char c = (char)Serial.read();
      if (c == '\n' || c == '\r') {
        if (line.length() == 0) {
          Serial.println("\nCalibration skipped.");
          return;
        }
        float referenceV = line.toFloat();
        if (referenceV <= 0.0f) {
          Serial.println("\nInvalid reference value, calibration skipped.");
          return;
        }

        float measuredV = readAverageInputVoltage(CALIBRATION_SAMPLES);
        if (measuredV <= 0.001f) {
          Serial.println("\nMeasured voltage is too small, calibration skipped.");
          return;
        }

        inputVoltageCalibrationFactor = referenceV / measuredV;
        Serial.println();
        Serial.print("Calibration done. Measured avg input: ");
        Serial.print(measuredV, 4);
        Serial.print(" V, reference: ");
        Serial.print(referenceV, 4);
        Serial.print(" V, factor: ");
        Serial.println(inputVoltageCalibrationFactor, 6);
        return;
      } else if (isPrintable(c)) {
        line += c;
      }
    }
    delay(20);
  }

  Serial.println("\nCalibration timeout, using factor 1.0");
}
 
 void connectWiFi() {
  Serial.print("Connecting to WiFi");
   WiFi.begin(ssid, password);
  unsigned long start = millis();
   while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > WIFI_TIMEOUT_MS) {
      Serial.println("\nWiFi timeout.");
      return;
    }
     delay(500);
     Serial.print(".");
   }
   Serial.println("\nConnected!");
   Serial.println(WiFi.localIP());
 }
 
void sendData(float adcVoltage, float inputVoltage, int raw) {
   if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifiRetry >= WIFI_RETRY_MS) {
      lastWifiRetry = millis();
      connectWiFi();
    }
    Serial.println("Send skipped: WiFi not connected");
    return;
   }
 
   unsigned long ts = millis();
   // Manual JSON string construction
   String body = "{\"sensorId\":\"" + String(SENSOR_ID) + "\""
                ",\"voltage\":" + String(inputVoltage, 3)
                + ",\"adcVoltage\":" + String(adcVoltage, 3)
                 + ",\"raw\":" + String(raw)
                 + ",\"ts\":" + String(ts) + "}";
 
  HTTPClient http;
  http.begin(server);
   http.addHeader("Content-Type", "application/json");
   
   int httpCode = http.POST(body);
 
   Serial.print("HTTP code: ");
   Serial.println(httpCode);
   if (httpCode < 0) {
     Serial.println(http.errorToString(httpCode));
   }
   http.end();
 }
 
 void setup() {
   Serial.begin(115200);
   delay(1000); // Give serial a moment to start
  Serial.println("\n=== Perovskite Chain ESP32-S (0-25V Sensor) ===");
 
   // Set ADC resolution to 12-bit (0-4095)
   analogReadResolution(12);
  analogSetPinAttenuation(ANALOG_PIN, ADC_11db); // Up to ~3.3V full-scale on GPIO34

  calibrateVoltageFromSerial();
 
  connectWiFi();
   Serial.println("Setup done.");
 }
 
void loop() {
   int raw = analogRead(ANALOG_PIN);
   
  // Read ADC voltage, then convert to sensor input voltage and apply calibration
  float adcVoltage = rawToAdcVoltage(raw);
  float inputVoltage = adcToInputVoltage(adcVoltage) * inputVoltageCalibrationFactor;
 
   Serial.print("ADC ");
   Serial.print(raw);
  Serial.print(" -> adc=");
   Serial.print(adcVoltage, 3);
  Serial.print(" V, input=");
  Serial.print(inputVoltage, 3);
  Serial.print(" V, k=");
  Serial.println(inputVoltageCalibrationFactor, 4);
 
  sendData(adcVoltage, inputVoltage, raw);
 
   delay(SEND_INTERVAL);
 }