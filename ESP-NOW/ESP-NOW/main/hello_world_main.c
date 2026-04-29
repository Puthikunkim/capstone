// controller/main/main.c
#include <stdio.h>
#include <string.h>
#include "esp_now.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "nvs_flash.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "esp_timer.h"
#include "esp_log.h"
#include "driver/uart.h"

// ── [ADDED] time sync headers ──────────────────────────────────
#include <time.h>
// ───────────────────────────────────────────────────────────────

static const char *TAG = "CONTROLLER";

// ====== Config ======
#define UART_PORT             UART_NUM_0
#define UART_BAUD             115200
#define HELLO_INTERVAL_MS     1000
#define DISCONNECT_TIMEOUT_US 300000000LL
#define MAX_NODES             20
#define SAMPLES_PER_FRAME     10
#define MAX_FRAMES_PER_PKT    3

// ── [ADDED] time sync config ───────────────────────────────────
#define TIME_REQUEST_STR      "TIME_REQUEST\n"
#define TIME_RESPONSE_BUF_LEN 128
// ───────────────────────────────────────────────────────────────

// ====== Message type ======
#define MSG_HELLO     0x01
#define MSG_REGISTER  0x02
#define MSG_WELCOME   0x03
#define MSG_DATA      0x04
#define MSG_ACK       0x05

// ====== Data schema ======
typedef struct {
    uint8_t  msg_type;
    uint8_t  controller_mac[6];
} __attribute__((packed)) hello_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint8_t  sender_mac[6];
} __attribute__((packed)) register_packet_t;

// ── [MODIFIED] welcome_packet_t — added timestamp field ────────
// Original:
// typedef struct {
//     uint8_t  msg_type;
//     uint8_t  assigned_id;
// } __attribute__((packed)) welcome_packet_t;
//
// Changed: added sync_timestamp so sender can anchor real time
typedef struct {
    uint8_t  msg_type;
    uint8_t  assigned_id;
    char     sync_timestamp[32];  // [ADDED] ISO UTC timestamp from backend
} __attribute__((packed)) welcome_packet_t;
// ───────────────────────────────────────────────────────────────

typedef struct {
    uint16_t counter;
    uint32_t time_since_boot_ms;
    int16_t  current_mv[SAMPLES_PER_FRAME];
    int16_t  voltage_mv[SAMPLES_PER_FRAME];
} __attribute__((packed)) adc_frame_t;

typedef struct {
    uint8_t    msg_type;
    uint8_t    sender_id;
    uint8_t    frame_count;
    adc_frame_t frames[MAX_FRAMES_PER_PKT];
} __attribute__((packed)) adc_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint8_t  ack_to;
    uint16_t confirmed_floor;
} __attribute__((packed)) ack_packet_t;

// ====== Node Registry ======
typedef enum {
    NODE_WAITING      = 0,
    NODE_STREAMING    = 1,
    NODE_DISCONNECTED = 2,
} node_status_t;

typedef struct {
    uint8_t  mac[6];
    uint8_t  ecu_id;
    uint16_t confirmed_floor;
    int64_t  last_seen_us;
    node_status_t  status;
} node_state_t;

static node_state_t registry[MAX_NODES];
static uint8_t      registry_count = 0;
static uint8_t      my_mac[6];

// ── [ADDED] time sync state ────────────────────────────────────
// Stores the ISO timestamp received from the backend and the
// esp_timer value at the moment it was received. Used to compute
// current real time for any WELCOME packet sent to a sender.
static char    controller_sync_timestamp[32] = "2026-04-26T12:00:00.000000";
static int64_t controller_sync_boot_us       = 0;
static bool    time_synced                   = true;
// ───────────────────────────────────────────────────────────────

/*---------------------------------------------------------------
    [ADDED] Time sync — request timestamp from backend over UART
    Called once in app_main before HELLO broadcasts begin.
    Sends "TIME_REQUEST\n" over UART and blocks until the backend
    responds with a JSON line: {"timestamp":"2026-01-01T00:00:00.000000"}
---------------------------------------------------------------*/
static void request_time_from_backend(void) {
    // send request to backend
    uart_write_bytes(UART_PORT, TIME_REQUEST_STR, strlen(TIME_REQUEST_STR));
    ESP_LOGI(TAG, "Sent TIME_REQUEST to backend, waiting...");

    // block and read response line
    char buf[TIME_RESPONSE_BUF_LEN];
    memset(buf, 0, sizeof(buf));
    int idx = 0;
    int64_t deadline = esp_timer_get_time() + 5000000LL; // 5s timeout

    while (esp_timer_get_time() < deadline && idx < (int)sizeof(buf) - 1) {
        uint8_t c;
        int r = uart_read_bytes(UART_PORT, &c, 1, pdMS_TO_TICKS(100));
        if (r > 0) {
            buf[idx++] = c;
            if (c == '\n') break;
        }
    }

    // parse {"timestamp":"2026-01-01T00:00:00.000000"}
    char *start = strstr(buf, "\"timestamp\"");
    if (start) {
        start = strchr(start, ':');
        if (start) {
            start++;
            while (*start == ' ' || *start == '"') start++;
            char *end = strchr(start, '"');
            if (end) {
                size_t len = end - start;
                if (len < sizeof(controller_sync_timestamp)) {
                    strncpy(controller_sync_timestamp, start, len);
                    controller_sync_timestamp[len] = '\0';
                    controller_sync_boot_us = esp_timer_get_time();
                    time_synced = true;
                    ESP_LOGI(TAG, "Time synced: %s", controller_sync_timestamp);
                }
            }
        }
    }

    if (!time_synced) {
        ESP_LOGE(TAG, "Time sync failed — timestamps will be empty");
    }
}

/*---------------------------------------------------------------
    [ADDED] Compute current real timestamp as ISO string.
    Uses the sync anchor (controller_sync_timestamp +
    controller_sync_boot_us) and current esp_timer to derive
    how much time has elapsed, then formats the result.
    Output written into `out` buffer of size `len`.
---------------------------------------------------------------*/
static void get_current_timestamp(char *out, size_t len) {
    if (!time_synced) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }

    int64_t elapsed_us = esp_timer_get_time() - controller_sync_boot_us;

    // parse sync_timestamp "2026-03-25T12:00:00.000000"
    char base_no_us[32];
    int us = 0;
    char *dot = strchr(controller_sync_timestamp, '.');
    if (dot) {
        size_t base_len = dot - controller_sync_timestamp;
        strncpy(base_no_us, controller_sync_timestamp, base_len);
        base_no_us[base_len] = '\0';
        us = atoi(dot + 1);
    } else {
        strncpy(base_no_us, controller_sync_timestamp, sizeof(base_no_us));
    }

    struct tm tm_base = {0};
    strptime(base_no_us, "%Y-%m-%dT%H:%M:%S", &tm_base);
    time_t base_epoch = mktime(&tm_base);

    int64_t total_us  = (int64_t)base_epoch * 1000000LL + us + elapsed_us;
    time_t  final_sec = total_us / 1000000LL;
    int     final_us  = (int)(total_us % 1000000LL);

    struct tm *final_tm = gmtime(&final_sec);
    snprintf(out, len,
             "%04d-%02d-%02dT%02d:%02d:%02d.%06d",
             final_tm->tm_year + 1900, final_tm->tm_mon + 1, final_tm->tm_mday,
             final_tm->tm_hour, final_tm->tm_min, final_tm->tm_sec, final_us);
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
        existing->status       = NODE_STREAMING;
        existing->last_seen_us = esp_timer_get_time();
        ESP_LOGI(TAG, "ECU%d reconnected", existing->ecu_id);
        return existing;
    }

    if (registry_count >= MAX_NODES) {
        ESP_LOGE(TAG, "Registry full!");
        return NULL;
    }

    node_state_t *node = &registry[registry_count++];
    memcpy(node->mac, mac, 6);
    node->ecu_id          = registry_count;
    node->confirmed_floor = 0;
    node->last_seen_us    = esp_timer_get_time();
    node->status          = NODE_STREAMING;

    ESP_LOGI(TAG, "New node registered: ECU%d MAC=%02X:%02X:%02X:%02X:%02X:%02X",
             node->ecu_id,
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
    UART JSON output
---------------------------------------------------------------*/

static void uart_send_json(const adc_packet_t *pkt, uint32_t rx_time_ms) {
    char buf[600];
    int pos = 0;

    pos += snprintf(buf + pos, sizeof(buf) - pos,
                    "{\"ecu_id\":%d,\"rx_time_ms\":%lu,\"frames\":[",
                    pkt->sender_id, (unsigned long)rx_time_ms);

    for (int f = 0; f < pkt->frame_count; f++) {
        const adc_frame_t *frame = &pkt->frames[f];

        pos += snprintf(buf + pos, sizeof(buf) - pos,
                        "{\"counter\":%d,\"tx_time_ms\":%lu,\"voltage\":[",
                        frame->counter,
                        (unsigned long)frame->time_since_boot_ms);

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
    uart_write_bytes(UART_PORT, buf, pos);
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

        add_peer(reg->sender_mac);
        node_state_t *node = register_node(reg->sender_mac);
        if (!node) return;

        // ── [MODIFIED] WELCOME now includes sync_timestamp ─────
        // Original:
        // welcome_packet_t welcome = {
        //     .msg_type    = MSG_WELCOME,
        //     .assigned_id = node->ecu_id,
        // };
        //
        // Changed: piggyback current real timestamp so sender can
        // anchor its clock without WiFi or NTP
        welcome_packet_t welcome = {
            .msg_type    = MSG_WELCOME,
            .assigned_id = node->ecu_id,
        };
        get_current_timestamp(welcome.sync_timestamp,       // [ADDED]
                              sizeof(welcome.sync_timestamp)); // [ADDED]
        // ───────────────────────────────────────────────────────

        esp_now_send(reg->sender_mac, (uint8_t *)&welcome, sizeof(welcome));
        ESP_LOGI(TAG, "Sent WELCOME to ECU%d with timestamp: %s",
                 node->ecu_id, welcome.sync_timestamp); // [MODIFIED] log
        return;
    }

    // ── DATA: ADC frame ──
    if (msg_type == MSG_DATA && len == sizeof(adc_packet_t)) {
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

        ESP_LOGI(TAG, "ECU%d | %d frame(s) | floor=%d",
                 pkt->sender_id, pkt->frame_count, node->confirmed_floor);

        uart_send_json(pkt, rx_time_ms);

        ack_packet_t ack = {
            .msg_type        = MSG_ACK,
            .ack_to          = node->ecu_id,
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
                ESP_LOGW(TAG, "ECU%d DISCONNECTED (5min timeout)", node->ecu_id);
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

    // ── [ADDED] request time from backend before anything else ─
    // Must happen after UART init and before HELLO broadcasts so
    // every WELCOME packet carries a valid timestamp
    request_time_from_backend();
    // ───────────────────────────────────────────────────────────

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }
    esp_now_register_recv_cb(on_data_recv);

    xTaskCreate(hello_task,    "hello",    2048, NULL, 3, NULL);
    xTaskCreate(watchdog_task, "watchdog", 2048, NULL, 2, NULL);

    ESP_LOGI(TAG, "Controller ready, broadcasting HELLO...");
}