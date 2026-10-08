/*
  Poultry Farm Feeder - ESP32 with LCD1602 (I2C)
  ---------------------------------------------------------------
  Libraries (Arduino IDE > Library Manager):
    - ESP32Servo         (Kevin Harrington)
    - ArduinoJson        (Benoit Blanchon, version 7.x)
    - LiquidCrystal I2C  (Frank de Brabander)

  Wiring:
    Servo signal  -> GPIO 18
    Servo power   -> external 5V supply (NOT the ESP32 3.3V pin)
    Servo ground  -> external supply GND AND ESP32 GND (shared)
    LCD VCC       -> 5V (VIN)
    LCD GND       -> GND
    LCD SDA       -> GPIO 21
    LCD SCL       -> GPIO 22

  Wi-Fi checklist (if it will not connect):
    1. The ESP32 only works on 2.4 GHz Wi-Fi. It cannot see 5 GHz.
       Phone hotspot: turn on "Maximize Compatibility" (iPhone) or set the
       band to 2.4 GHz (Android).
    2. The name and password are case-sensitive. No extra spaces.
    3. Open Serial Monitor at 115200 baud. The sketch lists every network it
       can see and tells you why the connection failed.
    4. Power the ESP32 from a good USB cable/charger. Powering the servo from
       the ESP32 pins can reset the board and break Wi-Fi.

  If the LCD stays blank: change LCD_ADDRESS to 0x3F and turn the small
  contrast screw on the back of the LCD.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <ESP32Servo.h>
#include <Wire.h>
#include <LiquidCrystal_I2C.h>
#include <time.h>

// ---------- CHANGE THESE ----------
const char* WIFI_SSID  = "YOUR_WIFI_NAME";
const char* WIFI_PASS  = "YOUR_WIFI_PASSWORD";
const char* SITE_URL   = "https://YOUR-SITE-NAME.netlify.app";  // no trailing slash
const char* deviceKey = "PoultryFeederKey_7f9a2b4c8d1e6f3a";
// ----------------------------------

const int SERVO_PIN    = 18;
const int CLOSED_ANGLE = 0;    // adjust to match your feeder gate
const int OPEN_ANGLE   = 90;   // adjust to match your feeder gate
const unsigned long POLL_INTERVAL_MS = 3000;

const uint8_t LCD_ADDRESS = 0x27;       // try 0x3F if nothing shows
const long GMT_OFFSET_SEC = 8 * 3600;   // Philippines = UTC+8
const int  DAYLIGHT_OFFSET_SEC = 0;

Servo gate;
LiquidCrystal_I2C lcd(LCD_ADDRESS, 16, 2);

unsigned long lastPoll = 0;
unsigned long lastIdleUpdate = 0;
unsigned long doneUntil = 0;     // keep the "Done feeding" message until this time
bool timeStarted = false;
int  wifiAttempts = 0;
int  lastPollCode = 0;
String shown1 = "", shown2 = "";

// ---------- LCD helpers ----------
String pad16(String s) {
  while (s.length() < 16) s += ' ';
  return s.substring(0, 16);
}

// Only writes to the LCD when the text actually changed (no flicker)
void show(const String& l1, const String& l2 = "") {
  String a = pad16(l1), b = pad16(l2);
  if (a != shown1) { lcd.setCursor(0, 0); lcd.print(a); shown1 = a; }
  if (b != shown2) { lcd.setCursor(0, 1); lcd.print(b); shown2 = b; }
}

// ---------- Time of day ----------
String partOfDay() {
  struct tm t;
  if (!getLocalTime(&t, 200)) return "today";   // clock not synced yet
  int h = t.tm_hour;
  if (h >= 5 && h < 12) return "the morning";
  if (h >= 12 && h < 18) return "the afternoon";
  return "the evening";
}

void showIdle() {
  if (millis() < doneUntil) return;   // still showing "Done feeding"
  if (WiFi.status() != WL_CONNECTED) {
    show("No Wi-Fi", "Reconnecting...");
    return;
  }
  if (lastPollCode != 0 && lastPollCode != 200) {
    // -1 = cannot reach site (check SITE_URL), 401 = DEVICE_KEY does not match
    show("Server problem", "Code " + String(lastPollCode));
    return;
  }
  struct tm t;
  String line2 = "Clock syncing...";
  if (getLocalTime(&t, 100)) {
    char buf[17];
    strftime(buf, sizeof(buf), "%I:%M %p", &t);
    line2 = String(buf);
  }
  show("Feeder ready", line2);
}

// ---------- Wi-Fi ----------
const char* wifiHint(wl_status_t s) {
  switch (s) {
    case WL_NO_SSID_AVAIL:   return "Name not found";
    case WL_CONNECT_FAILED:  return "Wrong password?";
    case WL_CONNECTION_LOST: return "Lost signal";
    default:                 return "Not connected";
  }
}

void listNetworks() {
  Serial.println("Scanning for 2.4 GHz networks...");
  int n = WiFi.scanNetworks();
  if (n <= 0) {
    Serial.println("  No networks found. Move closer to the router.");
  } else {
    for (int i = 0; i < n; i++) {
      Serial.printf("  %d) \"%s\"  signal %d dBm\n", i + 1, WiFi.SSID(i).c_str(), WiFi.RSSI(i));
    }
    Serial.printf("Looking for: \"%s\"\n", WIFI_SSID);
  }
  WiFi.scanDelete();
}

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;
  wifiAttempts++;

  show("Connecting Wi-Fi", String(WIFI_SSID));
  Serial.printf("Wi-Fi attempt %d to \"%s\"\n", wifiAttempts, WIFI_SSID);

  WiFi.persistent(false);
  WiFi.disconnect(true, true);   // clear any old/bad saved settings
  delay(300);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    WiFi.setSleep(false);   // steadier connection
    Serial.print("Connected. IP: ");
    Serial.println(WiFi.localIP());
    show("Wi-Fi connected", WiFi.localIP().toString());
    if (!timeStarted) {
      configTime(GMT_OFFSET_SEC, DAYLIGHT_OFFSET_SEC, "pool.ntp.org", "time.nist.gov");
      timeStarted = true;
    }
    delay(1200);
  } else {
    wl_status_t st = WiFi.status();
    Serial.printf("Wi-Fi failed (status %d): %s\n", (int)st, wifiHint(st));
    show("Wi-Fi failed", wifiHint(st));
    if (wifiAttempts <= 2) listNetworks();
    delay(3000);
  }
}

// ---------- Feeding ----------
void feed(int seconds) {
  Serial.printf("Opening gate for %d second(s)\n", seconds);
  gate.write(OPEN_ANGLE);

  // Countdown while the gate is open
  for (int s = seconds; s > 0; s--) {
    show("Feeding...", "Closing in " + String(s) + " s");
    delay(1000);
  }

  gate.write(CLOSED_ANGLE);
  Serial.println("Gate closed");
  show("Gate closed", "");
  delay(1000);

  show("Done feeding for", partOfDay());
  doneUntil = millis() + 6000;   // keep the message for 6 seconds
}

// Tell the website the command is finished (retry a few times)
void confirmDone(const String& id) {
  for (int attempt = 0; attempt < 3; attempt++) {
    WiFiClientSecure client;
    client.setInsecure();  // OK for a prototype
    HTTPClient http;
    http.begin(client, String(SITE_URL) + "/api/device");
    http.addHeader("x-device-key", DEVICE_KEY);
    http.addHeader("Content-Type", "application/json");
    int code = http.POST("{\"id\":\"" + id + "\"}");
    http.end();
    if (code == 200) return;
    delay(500);
  }
}

void pollServer() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String(SITE_URL) + "/api/device");
  http.addHeader("x-device-key", DEVICE_KEY);
  int code = http.GET();
  lastPollCode = code;

  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    http.end();
    if (!err && doc["feed"] == true) {
      String id = doc["id"].as<String>();
      int seconds = doc["seconds"] | 0;
      if (seconds >= 1 && seconds <= 5) {
        feed(seconds);
        confirmDone(id);
      }
    }
  } else {
    Serial.printf("Poll failed, HTTP code: %d\n", code);
    http.end();
  }
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  delay(500);

  Wire.begin(21, 22);
  lcd.init();
  lcd.backlight();
  show("Poultry Farm", "Starting...");

  gate.setPeriodHertz(50);
  gate.attach(SERVO_PIN, 500, 2400);
  gate.write(CLOSED_ANGLE);

  connectWiFi();
}

void loop() {
  connectWiFi();

  if (WiFi.status() == WL_CONNECTED && millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    pollServer();
  }

  if (millis() - lastIdleUpdate >= 500) {
    lastIdleUpdate = millis();
    showIdle();
  }
}
