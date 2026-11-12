/*
  Poultry Farm Feeder - CAMERA (ESP32-CAM AI-Thinker)
  ---------------------------------------------------------------
  Board: Tools > Board > "AI Thinker ESP32-CAM"
  Libraries: WiFiManager (tzapu), ArduinoJson 7.x
  If you get "Sketch too big": Tools > Partition Scheme > "Huge APP"

  - Live video (same Wi-Fi only):  http://<camera-ip>:81/
  - After each finished feeding, takes a photo and uploads it to the website.
  - First start: connect your phone to the Wi-Fi "Poultry-Cam" and choose
    your 2.4 GHz network.
  - The camera's IP address is printed in the Serial Monitor (115200 baud).
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <WiFiManager.h>
#include "esp_camera.h"
#include "esp_http_server.h"

// ---------- CONFIGURATION ----------
const char* SITE_URL = "https://poultryfarmfeeder.netlify.app";  // no trailing slash
#define DEVICE_KEY "PASTE_YOUR_DEVICE_KEY_HERE"                   // same as Netlify
// ----------------------------------

const unsigned long POLL_INTERVAL_MS = 5000;
const int FLASH_LED = 4;   // bright onboard LED, kept off

// AI-Thinker ESP32-CAM pins
#define PWDN_GPIO_NUM   32
#define RESET_GPIO_NUM  -1
#define XCLK_GPIO_NUM    0
#define SIOD_GPIO_NUM   26
#define SIOC_GPIO_NUM   27
#define Y9_GPIO_NUM     35
#define Y8_GPIO_NUM     34
#define Y7_GPIO_NUM     39
#define Y6_GPIO_NUM     36
#define Y5_GPIO_NUM     21
#define Y4_GPIO_NUM     19
#define Y3_GPIO_NUM     18
#define Y2_GPIO_NUM      5
#define VSYNC_GPIO_NUM  25
#define HREF_GPIO_NUM   23
#define PCLK_GPIO_NUM   22

SemaphoreHandle_t camMutex;
httpd_handle_t streamServer = NULL;
unsigned long lastPoll = 0;

// ---------- Camera ----------
bool startCamera() {
  camera_config_t config;
  memset(&config, 0, sizeof(config));
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk  = XCLK_GPIO_NUM;
  config.pin_pclk  = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href  = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;   // if this fails to compile, use pin_sscb_sda
  config.pin_sccb_scl = SIOC_GPIO_NUM;   // and pin_sscb_scl
  config.pin_pwdn  = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size   = FRAMESIZE_VGA;   // 640x480
  config.jpeg_quality = 12;              // lower number = better quality, bigger file
  config.fb_count     = 2;
  config.fb_location  = CAMERA_FB_IN_PSRAM;
  config.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t* s = esp_camera_sensor_get();
  // If the picture is upside down or mirrored, uncomment:
  // s->set_vflip(s, 1);
  // s->set_hmirror(s, 1);
  (void)s;
  return true;
}

// ---------- Live video server (port 81) ----------
#define PART_BOUNDARY "123456789000000000000987654321"
static const char* STREAM_CONTENT_TYPE = "multipart/x-mixed-replace;boundary=" PART_BOUNDARY;
static const char* STREAM_BOUNDARY     = "\r\n--" PART_BOUNDARY "\r\n";
static const char* STREAM_PART         = "Content-Type: image/jpeg\r\nContent-Length: %u\r\n\r\n";

static esp_err_t pageHandler(httpd_req_t* req) {
  const char* html =
    "<!doctype html><html><head><meta name='viewport' content='width=device-width,initial-scale=1'>"
    "<title>Poultry Farm Camera</title></head>"
    "<body style='margin:0;background:#000'>"
    "<img src='/stream' style='width:100%;display:block'></body></html>";
  httpd_resp_set_type(req, "text/html");
  return httpd_resp_send(req, html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t streamHandler(httpd_req_t* req) {
  esp_err_t res = httpd_resp_set_type(req, STREAM_CONTENT_TYPE);
  if (res != ESP_OK) return res;
  char partBuf[64];

  while (true) {
    xSemaphoreTake(camMutex, portMAX_DELAY);
    camera_fb_t* fb = esp_camera_fb_get();
    if (!fb) {
      res = ESP_FAIL;
    } else {
      res = httpd_resp_send_chunk(req, STREAM_BOUNDARY, strlen(STREAM_BOUNDARY));
      if (res == ESP_OK) {
        size_t n = snprintf(partBuf, sizeof(partBuf), STREAM_PART, (unsigned)fb->len);
        res = httpd_resp_send_chunk(req, partBuf, n);
      }
      if (res == ESP_OK) res = httpd_resp_send_chunk(req, (const char*)fb->buf, fb->len);
      esp_camera_fb_return(fb);
    }
    xSemaphoreGive(camMutex);
    if (res != ESP_OK) break;   // viewer closed the page
  }
  return res;
}

void startStreamServer() {
  httpd_config_t config = HTTPD_DEFAULT_CONFIG();
  config.server_port = 81;
  config.ctrl_port   = 32769;
  config.lru_purge_enable = true;

  httpd_uri_t page;   memset(&page, 0, sizeof(page));
  page.uri = "/";       page.method = HTTP_GET; page.handler = pageHandler;

  httpd_uri_t stream; memset(&stream, 0, sizeof(stream));
  stream.uri = "/stream"; stream.method = HTTP_GET; stream.handler = streamHandler;

  if (httpd_start(&streamServer, &config) == ESP_OK) {
    httpd_register_uri_handler(streamServer, &page);
    httpd_register_uri_handler(streamServer, &stream);
  }
}

// ---------- Photo after feeding ----------
bool uploadPhoto(const String& id) {
  delay(1000);   // let the gate close and the birds settle

  xSemaphoreTake(camMutex, portMAX_DELAY);
  camera_fb_t* fb = esp_camera_fb_get();
  if (!fb) {
    xSemaphoreGive(camMutex);
    Serial.println("Photo failed: no frame");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();   // OK for a prototype
  HTTPClient http;
  http.begin(client, String(SITE_URL) + "/api/photo");
  http.addHeader("x-device-key", DEVICE_KEY);
  http.addHeader("x-photo-id", id);
  http.addHeader("Content-Type", "image/jpeg");
  int code = http.POST(fb->buf, fb->len);
  http.end();

  esp_camera_fb_return(fb);
  xSemaphoreGive(camMutex);
  Serial.printf("Photo upload: HTTP %d\n", code);
  return code == 200;
}

void pollServer() {
  WiFiClientSecure client;
  client.setInsecure();
  HTTPClient http;
  http.begin(client, String(SITE_URL) + "/api/camera?ip=" + WiFi.localIP().toString());
  http.addHeader("x-device-key", DEVICE_KEY);
  int code = http.GET();

  if (code == 200) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, http.getString());
    http.end();
    if (!err && doc["snap"] == true) {
      String id = doc["id"].as<String>();
      uploadPhoto(id);
    }
  } else {
    // -1 = cannot reach site (check SITE_URL), 401 = DEVICE_KEY does not match
    Serial.printf("Poll failed, HTTP code: %d\n", code);
    http.end();
  }
}

// ---------- Arduino ----------
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(FLASH_LED, OUTPUT);
  digitalWrite(FLASH_LED, LOW);

  camMutex = xSemaphoreCreateMutex();

  if (!startCamera()) {
    Serial.println("Restarting in 5 seconds...");
    delay(5000);
    ESP.restart();
  }

  WiFiManager wm;
  wm.setConnectTimeout(20);
  wm.setConfigPortalTimeout(180);
  if (!wm.autoConnect("Poultry-Cam")) {
    Serial.println("Wi-Fi failed, restarting");
    delay(3000);
    ESP.restart();
  }
  WiFi.setSleep(false);   // smoother video
  WiFi.setAutoReconnect(true);

  startStreamServer();
  Serial.println("---------------------------------");
  Serial.print("Live video (same Wi-Fi): http://");
  Serial.print(WiFi.localIP());
  Serial.println(":81/");
  Serial.println("---------------------------------");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    WiFi.reconnect();
    delay(5000);
    return;
  }
  if (millis() - lastPoll >= POLL_INTERVAL_MS) {
    lastPoll = millis();
    pollServer();
  }
  delay(50);
}
