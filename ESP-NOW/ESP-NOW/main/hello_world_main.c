#include <stdio.h>
#include <string.h>
#include "esp_now.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "esp_sntp.h"
#include "esp_netif.h"
#include "esp_netif_sntp.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"   
#include "freertos/task.h"
#include <time.h>                // time_t, struct tm
#include <sys/time.h>            // gettimeofday

static const char *TAG = "CONTROLLER";

#define WIFI_SSID "testing"
#define WIFI_PASS "66666666"

#define SAMPLES_PER_FRAME 10

#define WIFI_CONNECTED_BIT BIT0
#define WIFI_FAIL_BIT      BIT1

static EventGroupHandle_t wifi_event_group;

static uint8_t sender1_mac[] = {0x20, 0xE7, 0xC8, 0xEC, 0xDC, 0xB8};
static uint8_t sender2_mac[] = {0x20, 0xE7, 0xC8, 0xEC, 0xE1, 0x98};

typedef struct {
    uint8_t  sender_id;           
    uint32_t counter;             
    int      current_ma[SAMPLES_PER_FRAME];  
    int      voltage_mv[SAMPLES_PER_FRAME];  
} __attribute__((packed)) adc_frame_t;

// ACK sructure
typedef struct {
    uint8_t  ack_to;
    uint32_t ack_counter;
    uint8_t  success;
} __attribute__((packed)) ack_packet_t;



// ACK send back
static void send_ack(const uint8_t *mac, uint8_t sender_id, uint32_t counter) {
    ack_packet_t ack = {
        .ack_to      = sender_id,
        .ack_counter = counter,
        .success     = 1,
    };

    esp_err_t ret = esp_now_send(mac, (uint8_t *)&ack, sizeof(ack));
    if (ret == ESP_OK) {
        printf("[ACK] Sent to Sender%d (counter=%lu)\n", sender_id, (unsigned long)counter);
    } else {
        printf("[ACK] Failed to Sender%d: %s\n", sender_id, esp_err_to_name(ret));
    }
}

static void add_peer(const uint8_t *mac) {
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) {
        printf("[PEER] Failed to add %02X:%02X:%02X:%02X:%02X:%02X\n",
               mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
}

static void wifi_event_handler(void *arg, esp_event_base_t event_base,
                                int32_t event_id, void *event_data) {
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGW(TAG, "WiFi disconnected, retrying...");
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "Got IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

// Wifi station
static void wifi_init(void) {
    wifi_event_group = xEventGroupCreate();

    nvs_flash_init();
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);

    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL);

    wifi_config_t wifi_config = {
        .sta = {
            .ssid     = WIFI_SSID,
            .password = WIFI_PASS,
        },
    };
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_start();
    esp_wifi_connect();

    ESP_LOGI(TAG, "Connecting to WiFi...");

    // Wait for successful connection or timeout
    EventBits_t bits = xEventGroupWaitBits(wifi_event_group,
                                           WIFI_CONNECTED_BIT,
                                           pdFALSE, pdFALSE,
                                           pdMS_TO_TICKS(15000));
    if (bits & WIFI_CONNECTED_BIT) {
        ESP_LOGI(TAG, "WiFi connected!");
    } else {
        ESP_LOGE(TAG, "WiFi FAILED to connect. Check SSID/password.");
    }

    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    ESP_LOGI(TAG, "My MAC: %02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

static void sntp_init_time(void) {
    esp_sntp_config_t config = ESP_NETIF_SNTP_DEFAULT_CONFIG("pool.ntp.org");
    esp_netif_sntp_init(&config);
    esp_netif_sntp_start();   
    6
    time_t now = 0;
    struct tm timeinfo = {};
    int retry = 0;
    while (timeinfo.tm_year < (2020 - 1900) && retry++ < 15) {
        ESP_LOGI(TAG, "Waiting for NTP sync... (%d/15)", retry);
        vTaskDelay(pdMS_TO_TICKS(2000));
        time(&now);
        localtime_r(&now, &timeinfo);
    }

    if (timeinfo.tm_year >= (2020 - 1900)) {
        ESP_LOGI(TAG, "Time synced: %04d-%02d-%02d %02d:%02d:%02d UTC",
                 timeinfo.tm_year + 1900, timeinfo.tm_mon + 1, timeinfo.tm_mday,
                 timeinfo.tm_hour, timeinfo.tm_min, timeinfo.tm_sec);
    } else {
        ESP_LOGW(TAG, "NTP sync FAILED");
    }
}

// recieve callback
static void on_data_recv(const esp_now_recv_info_t *info,
                         const uint8_t *data, int len) {
    if (len != sizeof(adc_frame_t)) {
        printf("[RX] Unknown packet size: %d\n", len);
        return;
    }

    const adc_frame_t *frame = (const adc_frame_t *)data;

    struct timeval tv;
    gettimeofday(&tv, NULL);
    struct tm *t = gmtime(&tv.tv_sec);

    printf("{\n");
    printf("  \"ecu_serial\": %d,\n", frame->sender_id);
    printf("  \"timestep\": \"%04d-%02d-%02dT%02d:%02d:%02d.%03ldZ\",\n",
           t->tm_year + 1900, t->tm_mon + 1, t->tm_mday,
           t->tm_hour, t->tm_min, t->tm_sec,
           tv.tv_usec / 1000);
    printf("  \"voltage_samples\": [");
    for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
        printf("%d%s", frame->voltage_mv[i], i < SAMPLES_PER_FRAME - 1 ? "," : "");
    }
    printf("],\n");
    printf("  \"current_samples\": [");
    for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
        printf("%d%s", frame->current_ma[i], i < SAMPLES_PER_FRAME - 1 ? "," : "");
    }
    printf("]\n}\n");

    send_ack(info->src_addr, frame->sender_id, frame->counter);
}

void app_main(void) {
    wifi_init();
    sntp_init_time();

    if (esp_now_init() != ESP_OK) {
        printf("[ERROR] ESP-NOW init failed\n");
        return;
    }

    esp_now_register_recv_cb(on_data_recv);

    add_peer(sender1_mac);
    add_peer(sender2_mac);

    printf("[RECEIVER] Ready, waiting for data...\n");

    // Broadcast to all senders they can send message
    uint8_t ready_msg = 0xAA;
    uint8_t broadcast_mac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

    esp_now_peer_info_t broadcast_peer = {};
    memcpy(broadcast_peer.peer_addr, broadcast_mac, 6);
    broadcast_peer.channel = 0;
    broadcast_peer.encrypt = false;
    esp_now_add_peer(&broadcast_peer);

    // Broadcasting 3 times, with 500ms interval, avoid sender miss signal
    for (int i = 0; i < 3; i++) {
        esp_now_send(broadcast_mac, &ready_msg, sizeof(ready_msg));
        ESP_LOGI(TAG, "Broadcasted READY signal (%d/3)", i + 1);
        vTaskDelay(pdMS_TO_TICKS(500));
    }
}