// controller/main/main.c
#include <stdio.h>
#include <string.h>
#include <stdlib.h>
#include "esp_now.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "driver/uart.h"

#include <time.h>

static const char *TAG = "CONTROLLER";

// ====== Config ======
#define UART_PORT             UART_NUM_0
#define UART_BAUD             115200
#define HELLO_INTERVAL_MS     1000
#define DISCONNECT_TIMEOUT_US 300000000LL
#define MAX_NODES             20
#define SAMPLES_PER_FRAME     10
#define MAX_FRAMES_PER_PKT    3

#define TIME_REQUEST_STR      "TIME_REQUEST\n"
#define TIME_RESPONSE_BUF_LEN 128


// ====== Message type ======
#define MSG_HELLO             0x01
#define MSG_REGISTER          0x02
#define MSG_WELCOME           0x03
#define MSG_DATA              0x04
#define MSG_ACK               0x05
#define MSG_POWER_LIMIT       0x06  // controller → sender: deliver power limit

// ====== Data schema ======
typedef struct {
    uint8_t  msg_type;
    uint8_t  controller_mac[6];
} __attribute__((packed)) hello_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint8_t  sender_mac[6];
} __attribute__((packed)) register_packet_t;

typedef struct {
    uint8_t  msg_type;
    char     sync_timestamp[32];
} __attribute__((packed)) welcome_packet_t;

typedef struct {
    uint16_t counter;
    int64_t  tx_epoch_us;  // UTC microseconds since epoch, computed by sender
    int16_t  current_mv[SAMPLES_PER_FRAME];
    int16_t  voltage_mv[SAMPLES_PER_FRAME];
} __attribute__((packed)) adc_frame_t;

typedef struct {
    uint8_t    msg_type;
    uint8_t    frame_count;
    adc_frame_t frames[MAX_FRAMES_PER_PKT];
} __attribute__((packed)) adc_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint16_t confirmed_floor;
} __attribute__((packed)) ack_packet_t;

// power_limit_mw: limit in milliwatts, pushed to the sender
typedef struct {
    uint8_t  msg_type;
    int32_t  power_limit_mw;
} __attribute__((packed)) power_limit_packet_t;

// ====== Node Registry ======
typedef enum {
    NODE_WAITING      = 0,
    NODE_STREAMING    = 1,
    NODE_DISCONNECTED = 2,
} node_status_t;

typedef struct {
    uint8_t  mac[6];
    uint16_t confirmed_floor;
    int64_t  last_seen_us;
    node_status_t  status;
} node_state_t;

static node_state_t registry[MAX_NODES];
static uint8_t      registry_count = 0;
static uint8_t      my_mac[6];

// ====== Time sync state ======
static char    controller_sync_timestamp[32] = "";
static int64_t controller_sync_boot_us       = 0;
static int64_t controller_sync_base_us       = 0;  // epoch-us at sync moment, precomputed once
static bool    time_synced                   = false;

// uart_mutex: prevents uart_send_json and uart_listener_task from
// interleaving their writes on the TX line.
static SemaphoreHandle_t uart_mutex;

/*---------------------------------------------------------------
    Time sync — request timestamp from backend over UART
---------------------------------------------------------------*/
static void request_time_from_backend(void) {
    char buf[TIME_RESPONSE_BUF_LEN];

    while (!time_synced) {
        uart_write_bytes(UART_PORT, TIME_REQUEST_STR, strlen(TIME_REQUEST_STR));
        ESP_LOGI(TAG, "Sent TIME_REQUEST to backend, waiting...");

        int64_t deadline = esp_timer_get_time() + 5000000LL; // 5s per attempt

        while (esp_timer_get_time() < deadline) {
            memset(buf, 0, sizeof(buf));
            int idx = 0;

            while (esp_timer_get_time() < deadline && idx < (int)sizeof(buf) - 1) {
                uint8_t c;
                int r = uart_read_bytes(UART_PORT, &c, 1, pdMS_TO_TICKS(50));
                if (r > 0) {
                    buf[idx++] = c;
                    if (c == '\n') break;
                }
            }

            if (idx == 0) continue;

            // parse {"timestamp":"2026-01-01T00:00:00.000000"}
            char *start = strstr(buf, "\"timestamp\"");
            if (!start) continue;

            start = strchr(start, ':');
            if (!start) continue;
            start++;
            while (*start == ' ' || *start == '"') start++;
            char *end = strchr(start, '"');
            if (!end) continue;

            size_t len = end - start;
            if (len < sizeof(controller_sync_timestamp)) {
                strncpy(controller_sync_timestamp, start, len);
                controller_sync_timestamp[len] = '\0';
                controller_sync_boot_us = esp_timer_get_time();

                // Precompute epoch-us so per-frame timestamp math is just arithmetic
                char base_no_us[32];
                int  base_us = 0;
                char *dot = strchr(controller_sync_timestamp, '.');
                if (dot) {
                    size_t blen = dot - controller_sync_timestamp;
                    strncpy(base_no_us, controller_sync_timestamp, blen);
                    base_no_us[blen] = '\0';
                    base_us = atoi(dot + 1);
                } else {
                    strncpy(base_no_us, controller_sync_timestamp, sizeof(base_no_us));
                }
                struct tm tm_b = {0};
                strptime(base_no_us, "%Y-%m-%dT%H:%M:%S", &tm_b);
                controller_sync_base_us = (int64_t)mktime(&tm_b) * 1000000LL + base_us;

                time_synced = true;
                ESP_LOGI(TAG, "Time synced: %s", controller_sync_timestamp);
                return;
            }
        }

        ESP_LOGW(TAG, "No response from backend, retrying...");
    }
}

/*---------------------------------------------------------------
    Format an epoch-us value as an ISO timestamp string.
---------------------------------------------------------------*/
static void _format_us(int64_t total_us, char *out, size_t len) {
    time_t final_sec     = total_us / 1000000LL;
    int    final_us      = (int)(total_us % 1000000LL);
    struct tm *final_tm  = gmtime(&final_sec);
    if (!final_tm) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }
    snprintf(out, len, "%04d-%02d-%02dT%02d:%02d:%02d.%06d",
             final_tm->tm_year + 1900, final_tm->tm_mon + 1, final_tm->tm_mday,
             final_tm->tm_hour, final_tm->tm_min, final_tm->tm_sec, final_us);
}

/*---------------------------------------------------------------
    Compute current real timestamp as ISO string.
---------------------------------------------------------------*/
static void get_current_timestamp(char *out, size_t len) {
    if (!time_synced) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }
    _format_us(controller_sync_base_us + (esp_timer_get_time() - controller_sync_boot_us),
               out, len);
}

/*---------------------------------------------------------------
    Format a sender-computed UTC epoch (microseconds since Unix epoch)
    as an ISO-8601 string.  tx_epoch_us == 0 → epoch fallback string.
---------------------------------------------------------------*/
static void get_frame_timestamp(int64_t tx_epoch_us, char *out, size_t len) {
    if (tx_epoch_us == 0) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }
    _format_us(tx_epoch_us, out, len);
}

/*---------------------------------------------------------------
    Registry management
---------------------------------------------------------------*/

static node_state_t *find_node_by_mac(const uint8_t *mac) {
    for (int i = 0; i < registry_count; i++) {
        if (memcmp(registry[i].mac, mac, 6) == 0)
            return &registry[i];
    }
    return NULL;
}

static node_state_t *register_node(const uint8_t *mac) {
    node_state_t *existing = find_node_by_mac(mac);
    if (existing) {
        existing->status          = NODE_STREAMING;
        existing->last_seen_us    = esp_timer_get_time();
        existing->confirmed_floor = 0;
        ESP_LOGI(TAG, "Node reconnected: MAC=%02X:%02X:%02X:%02X:%02X:%02X",
                 mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
        return existing;
    }

    if (registry_count >= MAX_NODES) {
        ESP_LOGE(TAG, "Registry full!");
        return NULL;
    }

    node_state_t *node = &registry[registry_count++];
    memcpy(node->mac, mac, 6);
    node->confirmed_floor = 0;
    node->last_seen_us    = esp_timer_get_time();
    node->status          = NODE_STREAMING;

    ESP_LOGI(TAG, "New node registered: MAC=%02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    return node;
}

/*---------------------------------------------------------------
    Peer management
---------------------------------------------------------------*/

static void add_peer(const uint8_t *mac) {
    if (esp_now_is_peer_exist(mac)) return;
    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, mac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    if (esp_now_add_peer(&peer) != ESP_OK) {
        ESP_LOGE(TAG, "Failed to add peer");
    }
}

/*---------------------------------------------------------------
    UART JSON output (protected by uart_mutex)
---------------------------------------------------------------*/

static void uart_send_json(const adc_packet_t *pkt, const uint8_t *sender_mac, uint32_t rx_time_ms) {
    static char buf[6144]; /* static: BSS, not stack; safe because uart_mutex serializes callers */
    int pos = 0;

    pos += snprintf(buf + pos, sizeof(buf) - pos,
                    "{\"mac\":\"%02X:%02X:%02X:%02X:%02X:%02X\",\"rx_time_ms\":%lu,\"frames\":[",
                    sender_mac[0], sender_mac[1], sender_mac[2],
                    sender_mac[3], sender_mac[4], sender_mac[5],
                    (unsigned long)rx_time_ms);

    for (int f = 0; f < pkt->frame_count; f++) {
        const adc_frame_t *frame = &pkt->frames[f];
        char ts[27];
        get_frame_timestamp(frame->tx_epoch_us, ts, sizeof(ts));

        pos += snprintf(buf + pos, sizeof(buf) - pos,
                        "{\"counter\":%d,\"tx_time_ms\":\"%s\",\"voltage\":[",
                        frame->counter, ts);

        for (int i = 0; i < SAMPLES_PER_FRAME; i++)
            pos += snprintf(buf + pos, sizeof(buf) - pos,
                            "%d%s", frame->voltage_mv[i],
                            i < SAMPLES_PER_FRAME - 1 ? "," : "");

        pos += snprintf(buf + pos, sizeof(buf) - pos, "],\"current\":[");

        for (int i = 0; i < SAMPLES_PER_FRAME; i++)
            pos += snprintf(buf + pos, sizeof(buf) - pos,
                            "%d%s", frame->current_mv[i],
                            i < SAMPLES_PER_FRAME - 1 ? "," : "");

        pos += snprintf(buf + pos, sizeof(buf) - pos,
                        "]}%s", f < pkt->frame_count - 1 ? "," : "");
    }

    pos += snprintf(buf + pos, sizeof(buf) - pos, "]}\n");

    xSemaphoreTake(uart_mutex, portMAX_DELAY);
    uart_write_bytes(UART_PORT, buf, pos);
    xSemaphoreGive(uart_mutex);
}

/*---------------------------------------------------------------
    UART listener task
    Reads lines from the Python backend. When it sees a power_limit
    message it forwards the limit to the right sender via ESP-NOW.

    Expected format from Python:
      {"type":"power_limit","mac":"AA:BB:CC:DD:EE:FF","power_limit_watts":350.0}\n
---------------------------------------------------------------*/
static void uart_listener_task(void *arg) {
    char buf[160];

    while (1) {
        memset(buf, 0, sizeof(buf));
        int idx = 0;

        while (idx < (int)sizeof(buf) - 1) {
            uint8_t c;
            int r = uart_read_bytes(UART_PORT, &c, 1, pdMS_TO_TICKS(100));
            if (r > 0) {
                buf[idx++] = c;
                if (c == '\n') break;
            }
        }

        if (idx == 0) continue;

        // Only handle power_limit messages
        if (!strstr(buf, "\"power_limit\"")) continue;

        // Parse MAC: "mac":"AA:BB:CC:DD:EE:FF"
        char *mac_key = strstr(buf, "\"mac\"");
        if (!mac_key) continue;
        mac_key = strchr(mac_key, ':');
        if (!mac_key) continue;
        mac_key++;
        while (*mac_key == ' ' || *mac_key == '"') mac_key++;

        uint8_t mac[6];
        if (sscanf(mac_key, "%hhx:%hhx:%hhx:%hhx:%hhx:%hhx",
                   &mac[0], &mac[1], &mac[2],
                   &mac[3], &mac[4], &mac[5]) != 6) {
            ESP_LOGW(TAG, "power_limit: bad MAC in: %.80s", buf);
            continue;
        }

        // Parse power_limit_watts
        char *watts_key = strstr(buf, "\"power_limit_watts\"");
        if (!watts_key) continue;
        watts_key = strchr(watts_key, ':');
        if (!watts_key) continue;
        watts_key++;
        while (*watts_key == ' ') watts_key++;
        float watts = strtof(watts_key, NULL);
        int32_t mw  = (int32_t)(watts * 1000.0f);

        // Forward to sender via ESP-NOW
        node_state_t *node = find_node_by_mac(mac);
        if (!node) {
            ESP_LOGW(TAG, "power_limit: MAC not in registry");
            continue;
        }

        power_limit_packet_t pkt = {
            .msg_type       = MSG_POWER_LIMIT,
            .power_limit_mw = mw,
        };
        esp_now_send(mac, (uint8_t *)&pkt, sizeof(pkt));
        ESP_LOGI(TAG, "Sent power limit %.1fW to %02X:%02X:%02X:%02X:%02X:%02X",
                 watts, mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    }
}

/*---------------------------------------------------------------
    ESP-NOW receive callback
---------------------------------------------------------------*/

static void on_data_recv(const esp_now_recv_info_t *info,
                         const uint8_t *data, int len) {
    if (len < 1) return;
    uint8_t msg_type = data[0];

    // ── REGISTER: Sender requesting to join ──
    if (msg_type == MSG_REGISTER && len == sizeof(register_packet_t)) {
        const register_packet_t *reg = (const register_packet_t *)data;

        add_peer(info->src_addr);
        node_state_t *node = register_node(info->src_addr);
        if (!node) return;

        if (!time_synced) {
            ESP_LOGW(TAG, "REGISTER received but time not synced yet, ignoring");
            return;
        }

        welcome_packet_t welcome = {
            .msg_type = MSG_WELCOME,
        };
        get_current_timestamp(welcome.sync_timestamp, sizeof(welcome.sync_timestamp));

        esp_now_send(info->src_addr, (uint8_t *)&welcome, sizeof(welcome));
        ESP_LOGI(TAG, "Sent WELCOME to %02X:%02X:%02X:%02X:%02X:%02X ts=%s",
                 info->src_addr[0], info->src_addr[1], info->src_addr[2],
                 info->src_addr[3], info->src_addr[4], info->src_addr[5],
                 welcome.sync_timestamp);
        return;
    }

    // ── DATA: ADC frame ──
    if (msg_type == MSG_DATA && len >= 2) {
        const adc_packet_t *pkt = (const adc_packet_t *)data;
        uint32_t rx_time_ms = (uint32_t)(esp_timer_get_time() / 1000);

        node_state_t *node = find_node_by_mac(info->src_addr);
        if (!node) {
            ESP_LOGW(TAG, "Data from unknown node, ignoring");
            return;
        }

        node->last_seen_us = esp_timer_get_time();
        node->status       = NODE_STREAMING;

        for (int i = 0; i < pkt->frame_count; i++) {
            if (pkt->frames[i].counter > node->confirmed_floor)
                node->confirmed_floor = pkt->frames[i].counter;
        }

        ESP_LOGI(TAG, "Sender %02X:%02X:%02X:%02X:%02X:%02X | %d frame(s) | floor=%d",
                 info->src_addr[0], info->src_addr[1], info->src_addr[2],
                 info->src_addr[3], info->src_addr[4], info->src_addr[5],
                 pkt->frame_count, node->confirmed_floor);

        for (int i = 0; i < pkt->frame_count; i++) {
            const adc_frame_t *fr = &pkt->frames[i];
            ESP_LOGI(TAG, "  Frame %d V: %d %d %d %d %d %d %d %d %d %d",
                     fr->counter,
                     fr->voltage_mv[0], fr->voltage_mv[1], fr->voltage_mv[2],
                     fr->voltage_mv[3], fr->voltage_mv[4], fr->voltage_mv[5],
                     fr->voltage_mv[6], fr->voltage_mv[7], fr->voltage_mv[8],
                     fr->voltage_mv[9]);
            ESP_LOGI(TAG, "  Frame %d I: %d %d %d %d %d %d %d %d %d %d",
                     fr->counter,
                     fr->current_mv[0], fr->current_mv[1], fr->current_mv[2],
                     fr->current_mv[3], fr->current_mv[4], fr->current_mv[5],
                     fr->current_mv[6], fr->current_mv[7], fr->current_mv[8],
                     fr->current_mv[9]);
        }

        uart_send_json(pkt, info->src_addr, rx_time_ms);

        ack_packet_t ack = {
            .msg_type        = MSG_ACK,
            .confirmed_floor = node->confirmed_floor,
        };
        esp_now_send(info->src_addr, (uint8_t *)&ack, sizeof(ack));
        return;
    }

    ESP_LOGW(TAG, "Unknown msg_type=0x%02X len=%d", msg_type, len);
}

/*---------------------------------------------------------------
    HELLO Broadcast Task
---------------------------------------------------------------*/

static void hello_task(void *arg) {
    uint8_t broadcast_mac[] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

    esp_now_peer_info_t bp = {};
    memcpy(bp.peer_addr, broadcast_mac, 6);
    bp.channel = 0;
    bp.encrypt = false;
    esp_now_add_peer(&bp);

    hello_packet_t hello = {.msg_type = MSG_HELLO};
    memcpy(hello.controller_mac, my_mac, 6);

    while (1) {
        esp_now_send(broadcast_mac, (uint8_t *)&hello, sizeof(hello));
        ESP_LOGD(TAG, "HELLO broadcast");
        vTaskDelay(pdMS_TO_TICKS(HELLO_INTERVAL_MS));
    }
}

/*---------------------------------------------------------------
    Disconnect detection Task
---------------------------------------------------------------*/

static void watchdog_task(void *arg) {
    while (1) {
        int64_t now = esp_timer_get_time();
        for (int i = 0; i < registry_count; i++) {
            node_state_t *node = &registry[i];
            if (node->status == NODE_STREAMING &&
                now - node->last_seen_us > DISCONNECT_TIMEOUT_US) {
                node->status = NODE_DISCONNECTED;
                ESP_LOGW(TAG, "Sender %02X:%02X:%02X:%02X:%02X:%02X DISCONNECTED (5min timeout)",
                         node->mac[0], node->mac[1], node->mac[2],
                         node->mac[3], node->mac[4], node->mac[5]);
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1000));
    }
}

/*---------------------------------------------------------------
    WiFi init
---------------------------------------------------------------*/

static void wifi_init(void) {
    nvs_flash_init();
    esp_netif_init();
    esp_event_loop_create_default();
    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();
    esp_wifi_get_mac(WIFI_IF_STA, my_mac);
    ESP_LOGI(TAG, "My MAC: %02X:%02X:%02X:%02X:%02X:%02X",
             my_mac[0], my_mac[1], my_mac[2],
             my_mac[3], my_mac[4], my_mac[5]);
}

/*---------------------------------------------------------------
    App Main
---------------------------------------------------------------*/

void app_main(void) {
    setenv("TZ", "UTC0", 1);
    tzset();

    wifi_init();

    uart_config_t uart_cfg = {
        .baud_rate = UART_BAUD,
        .data_bits = UART_DATA_8_BITS,
        .parity    = UART_PARITY_DISABLE,
        .stop_bits = UART_STOP_BITS_1,
        .flow_ctrl = UART_HW_FLOWCTRL_DISABLE,
    };
    uart_driver_install(UART_PORT, 1024, 0, 0, NULL, 0);
    uart_param_config(UART_PORT, &uart_cfg);

    uart_mutex = xSemaphoreCreateMutex();

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }

    esp_now_register_recv_cb(on_data_recv);

    xTaskCreate(hello_task,    "hello",    2048, NULL, 3, NULL);
    xTaskCreate(watchdog_task, "watchdog", 2048, NULL, 2, NULL);

    ESP_LOGI(TAG, "Controller broadcasting HELLO, syncing time...");
    request_time_from_backend();
    ESP_LOGI(TAG, "Time synced — controller ready.");

    // uart_listener_task reads UART RX for power-limit commands.
    // It must start after request_time_from_backend() so they don't
    // race on the same RX buffer and corrupt the time-sync response.
    xTaskCreate(uart_listener_task, "uart_listen", 4096, NULL, 4, NULL);
}
