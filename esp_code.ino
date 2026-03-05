#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>

ADC_MODE(ADC_TOUT);

const char* ssid = "WIFI_NAME";
const char* password = "PASSWORD";

const char* server = "http://YOUR_SERVER_IP:3000/update";

const float R1 = 330000.0;
const float R2 = 100000.0;

const int SEND_INTERVAL = 5 * 60 * 1000; // 5 minutes

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

void setup() {

  Serial.begin(115200);

  connectWiFi();
}

void sendVoltage(float voltage, int raw) {

  if (WiFi.status() != WL_CONNECTED) {
    connectWiFi();
  }

  WiFiClient client;
  HTTPClient http;

  http.begin(client, server);
  http.addHeader("Content-Type", "application/json");

  String body =
    "{\"voltage\": " + String(voltage, 3) +
    ", \"raw\": " + String(raw) + "}";

  int httpCode = http.POST(body);

  Serial.print("HTTP code: ");
  Serial.println(httpCode);

  if (httpCode < 0) {
      Serial.printf("Error: %s\n", http.errorToString(httpCode).c_str());
  }

  http.end();
}

void loop() {

  int raw = analogRead(A0);

  float v_adc = raw * (1.0 / 1023.0);
  float v_battery = v_adc * (R1 + R2) / R2;

  Serial.print("Voltage: ");
  Serial.println(v_battery);

  sendVoltage(v_battery, raw);

  delay(SEND_INTERVAL);
}
