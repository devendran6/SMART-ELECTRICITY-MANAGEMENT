/*
 * =================================================================================
 * SMART HOME ELECTRICITY MANAGEMENT & OVERLOAD PROTECTION SYSTEM
 * Microcontroller: ESP32 Dev Module / NodeMCU-32S
 * Sensor: PZEM-004T v3.0 (AC Voltage, Current, Power, Energy, Frequency, PF)
 * =================================================================================
 *
 * WIRING DIAGRAM:
 * ---------------------------------------------------------------------------------
 * ESP32 Pin          PZEM-004T v3.0 Pin
 * ---------------------------------------------------------------------------------
 * GPIO 16 (RX2) ---> TX (Send data from sensor to ESP32)
 * GPIO 17 (TX2) ---> RX (Receive commands from ESP32)
 * 5V (VIN)      ---> 5V (VCC)
 * GND           ---> GND
 *
 * AC MAINS CONNECTIONS:
 * ---------------------------------------------------------------------------------
 * PZEM Voltage Screw Terminals ---> Live (L) and Neutral (N) of your main supply.
 * PZEM CT Coil                 ---> Clamp ONLY ONE wire (Live or Neutral, NOT BOTH).
 *
 * REQUIRED ARDUINO LIBRARIES:
 * 1. "PZEM004Tv30" by Jakub Mandula (Install via Arduino Library Manager)
 * 2. "WiFi" & "HTTPClient" (Built into the ESP32 Arduino Core)
 * =================================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>

// ======================== USER CONFIGURATION =====================================
const char* WIFI_SSID     = "YOUR_WIFI_NAME";          // Put your home Wi-Fi SSID here
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";      // Put your home Wi-Fi password here

// The IP Address of your PC running the Dashboard Server:
// Example: If your PC's IP on the home Wi-Fi is 192.168.1.15, use:
// "http://192.168.1.15:3000/api/telemetry"
const char* DASHBOARD_API = "http://192.168.1.100:3000/api/telemetry";

// Safety Trip Thresholds (ESP32 local safety fallback if Wi-Fi is offline)
const float LOCAL_OVERLOAD_WATTS   = 3500.0; // 3.5 kW
const float LOCAL_OVERLOAD_AMPS    = 16.0;   // 16 Amps
const float LOCAL_HIGH_VOLTAGE     = 255.0;  // 255 Volts
const float LOCAL_LOW_VOLTAGE      = 185.0;  // 185 Volts

// Pins for Actuator / Indicators
#define PIN_RELAY_TRIP 25   // Connect to Relay/Contactor coil (Active LOW or HIGH depending on relay)
#define PIN_BUZZER     26   // Connect to 5V piezo active buzzer
#define PIN_STATUS_LED 2    // Built-in ESP32 LED

// Hardware Serial2 pins for PZEM
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 1000; // Send telemetry every 1 second (1000ms)

void setup() {
  Serial.begin(115200);
  delay(1000);
  Serial.println("\n=======================================================");
  Serial.println("  ESP32 SMART ELECTRICITY MONITOR INITIALIZING");
  Serial.println("=======================================================");

  pinMode(PIN_RELAY_TRIP, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_STATUS_LED, OUTPUT);

  // Normal state: Relay closed (Power Active)
  digitalWrite(PIN_RELAY_TRIP, HIGH);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_STATUS_LED, LOW);

  // Connect to Local Wi-Fi
  Serial.print("Connecting to Wi-Fi SSID: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(500);
    Serial.print(".");
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    digitalWrite(PIN_STATUS_LED, HIGH);
    Serial.println("\n[SUCCESS] Wi-Fi Connected!");
    Serial.print("ESP32 IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WARNING] Wi-Fi connection timed out. Monitoring in local standalone mode.");
  }
}

void loop() {
  // Read parameters from PZEM-004T v3.0
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  // Validate sensor readings
  if (isnan(voltage) || isnan(current) || isnan(power)) {
    Serial.println("[ERROR] Failed to read from PZEM-004T. Check wiring & AC power.");
    delay(1500);
    return;
  }

  // --- LOCAL SAFETY TRIP LOGIC ---
  bool isOverload = (power > LOCAL_OVERLOAD_WATTS) || (current > LOCAL_OVERLOAD_AMPS);
  bool isSurge = (voltage > LOCAL_HIGH_VOLTAGE);
  bool isBrownout = (voltage < LOCAL_LOW_VOLTAGE && voltage > 50.0);

  if (isOverload || isSurge) {
    // Sound local buzzer alarm
    digitalWrite(PIN_BUZZER, HIGH);
    Serial.println("🚨 [HAZARD DETECTED] Overload or Voltage Surge! Buzzer Active.");
    // Uncomment the line below if you want the ESP32 to physically trip a relay:
    // digitalWrite(PIN_RELAY_TRIP, LOW);
  } else {
    digitalWrite(PIN_BUZZER, LOW);
    digitalWrite(PIN_RELAY_TRIP, HIGH);
  }

  // Print readable stats to Serial Monitor
  Serial.printf("⚡ V: %5.1f V | I: %5.2f A | P: %6.1f W | E: %6.3f kWh | PF: %4.2f | Freq: %4.1f Hz\n",
                voltage, current, power, energy, pf, frequency);

  // Send Telemetry to Dashboard Server over Wi-Fi
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();

    if (WiFi.status() == WL_CONNECTED) {
      HTTPClient http;
      http.begin(DASHBOARD_API);
      http.addHeader("Content-Type", "application/json");

      // Construct JSON message
      String json = "{";
      json += "\"voltage\":" + String(voltage, 1) + ",";
      json += "\"current\":" + String(current, 2) + ",";
      json += "\"power\":" + String(power, 1) + ",";
      json += "\"energy\":" + String(energy, 3) + ",";
      json += "\"frequency\":" + String(frequency, 1) + ",";
      json += "\"powerFactor\":" + String(pf, 2) + ",";
      json += "\"source\":\"ESP32\"";
      json += "}";

      int httpResponseCode = http.POST(json);
      if (httpResponseCode > 0) {
        // Success
      } else {
        Serial.printf("[HTTP ERROR] Failed to send telemetry: %s\n", http.errorToString(httpResponseCode).c_str());
      }
      http.end();
    }
  }

  delay(200);
}
