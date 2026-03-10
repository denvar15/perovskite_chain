/*
 * Perovskite Chain - ESP12F (ESP8266) sensor
 *
 * Reads battery voltage from ADC (voltage divider R1=330k, R2=100k),
 * sends signed payload to server every N minutes (interval strictly in [MIN, MAX]).
 *
 * Authenticity: payload is signed with Ed25519 so only this sensor can produce
 * valid data. Install "Arduino Cryptography Library" by rweather (Ed25519).
 * In Arduino IDE: Sketch -> Include Library -> Manage Libraries -> search
 * "Arduino Cryptography Library" or add from https://github.com/rweather/arduinolibs
 */

 #include <ESP8266WiFi.h>
 #include <ESP8266HTTPClient.h>
 #include <ArduinoJson.h>
 
 // Optional: Ed25519 signing. If Arduino Cryptography Library is not installed,
 // comment out USE_ED25519_SIGNING and use HMAC path (server must have same secret).
 #define USE_ED25519_SIGNING
 #ifdef USE_ED25519_SIGNING
   #include <Ed25519.h>
 #endif
 
 ADC_MODE(ADC_TOUT);
 
 const char* ssid = "Xiaomi";
 const char* password = "_";
 
 const char* server = "http://10.213.219.185:3000/update";
 
 // Voltage divider (ohms)
 const float R1 = 330000.0;
 const float R2 = 100000.0;
 
 // Send interval: once every N minutes, strictly within [MIN, MAX]
 const unsigned int SEND_INTERVAL_MINUTES       = 1;   // N minutes
 const unsigned int MIN_SEND_INTERVAL_MINUTES   = 1;
 const unsigned int MAX_SEND_INTERVAL_MINUTES   = 2;
 
 // Enforce interval bounds
 static unsigned int sendIntervalMinutes = SEND_INTERVAL_MINUTES;
 static const unsigned long SEND_INTERVAL_MS = (unsigned long)sendIntervalMinutes * 60 * 1000;
 
 // Unique sensor identifier (set per device)
 const char* SENSOR_ID = "perovskite_sensor_01";
 
 #ifdef USE_ED25519_SIGNING
 // Ed25519 key pair: generate once, then paste private key here (32 bytes hex = 64 chars).
 // Keep private key secret. Public key is sent with each payload for verification.
 // Generate with: openssl genpkey -algorithm ed25519 -outform DER | tail -c 32 | xxd -p -c 32
 static const char* PRIVATE_KEY_HEX = "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZWQyNTUxOQAAACBmoZWbko86klV0MJGYSBCwwdo2mlooQK9Viae84JtwkgAAAJh5YQdKeWEHSgAAAAtzc2gtZWQyNTUxOQAAACBmoZWbko86klV0MJGYSBCwwdo2mlooQK9Viae84JtwkgAAAECIMi2I7tsWfduzaU4e0Bqb/WFqTdRMuaPREXG2rMMU22ahlZuSjzqSVXQwkZhIELDB2jaaWihAr1WJp7zgm3CSAAAADmRlbnZhQGRlbnZhcjE1AQIDBAUGBw==";
 static uint8_t privateKey[32];
 static uint8_t publicKey[32];
 static bool keysInitialized = false;
 #endif
 
 void connectWiFi() {
   Serial.print("Connecting to WiFi");
   WiFi.begin(ssid, password);
   while (WiFi.status() != WL_CONNECTED) {
     delay(500);
     Serial.print(".");
   }
   Serial.println();
   Serial.println("Connected!");
   Serial.println(WiFi.localIP());
 }
 
 #ifdef USE_ED25519_SIGNING
 void initKeys() {
   if (keysInitialized) return;
   // Decode hex private key
   for (int i = 0; i < 32; i++) {
     char c1 = PRIVATE_KEY_HEX[i * 2];
     char c2 = PRIVATE_KEY_HEX[i * 2 + 1];
     auto hex = [](char c) -> uint8_t {
       if (c >= '0' && c <= '9') return c - '0';
       if (c >= 'a' && c <= 'f') return c - 'a' + 10;
       if (c >= 'A' && c <= 'F') return c - 'A' + 10;
       return 0;
     };
     privateKey[i] = (hex(c1) << 4) | hex(c2);
   }
   Ed25519::derivePublicKey(publicKey, privateKey);
   keysInitialized = true;
 }
 
 void hexEncode(const uint8_t* data, size_t len, char* out) {
   const char hex[] = "0123456789abcdef";
   for (size_t i = 0; i < len; i++) {
     out[i * 2]     = hex[data[i] >> 4];
     out[i * 2 + 1] = hex[data[i] & 0x0f];
   }
   out[len * 2] = '\0';
 }
 #endif
 
 void sendVoltage(float voltage, int raw) {
   if (WiFi.status() != WL_CONNECTED) {
     connectWiFi();
   }
 
   unsigned long ts = millis(); // or use NTP if available
   StaticJsonDocument<512> doc;
   doc["sensorId"] = SENSOR_ID;
   doc["voltage"]  = round(voltage * 1000) / 1000.0;
   doc["raw"]      = raw;
   doc["ts"]       = ts;
 
   String payload;
   serializeJson(doc, payload);
 
 #ifdef USE_ED25519_SIGNING
   initKeys();
   uint8_t signature[64];
   Ed25519::sign(signature, privateKey, publicKey, (const uint8_t*)payload.c_str(), payload.length());
 
   char sigHex[129];
   char pubHex[65];
   hexEncode(signature, 64, sigHex);
   hexEncode(publicKey, 32, pubHex);
 
   doc["signature"] = sigHex;
   doc["publicKey"] = pubHex;
   payload = "";
   serializeJson(doc, payload);
 #endif
 
   WiFiClient client;
   HTTPClient http;
   http.begin(client, server);
   http.addHeader("Content-Type", "application/json");
   int httpCode = http.POST(payload);
 
   Serial.print("HTTP code: ");
   Serial.println(httpCode);
   if (httpCode < 0) {
     Serial.printf("Error: %s\n", http.errorToString(httpCode).c_str());
   }
   http.end();
 }
 
 void setup() {
   Serial.begin(115200);
 
   // Clamp send interval to allowed range
   if (SEND_INTERVAL_MINUTES < MIN_SEND_INTERVAL_MINUTES)
     sendIntervalMinutes = MIN_SEND_INTERVAL_MINUTES;
   else if (SEND_INTERVAL_MINUTES > MAX_SEND_INTERVAL_MINUTES)
     sendIntervalMinutes = MAX_SEND_INTERVAL_MINUTES;
   else
     sendIntervalMinutes = SEND_INTERVAL_MINUTES;
 
   Serial.print("Send interval: ");
   Serial.print(sendIntervalMinutes);
   Serial.println(" minutes");
 
   connectWiFi();
 #ifdef USE_ED25519_SIGNING
   initKeys();
   Serial.println("Ed25519 keys initialized");
 #endif
 }
 
 void loop() {
   int raw = analogRead(A0);
   float v_adc = raw * (1.0f / 1023.0f);
   float v_battery = v_adc * (R1 + R2) / R2;
 
   Serial.print("Voltage: ");
   Serial.println(v_battery);
 
   sendVoltage(v_battery, raw);
 
   unsigned long intervalMs = (unsigned long)sendIntervalMinutes * 60 * 1000;
   delay(intervalMs);
 }
 