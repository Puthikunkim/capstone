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

// Timeout waiting for a power_limit_response from the backend (µs)
#define POWER_LIMIT_UART_TIMEOUT_US 2000000LL

// ====== Message type ======
#define MSG_HELLO             0x01
#define MSG_REGISTER          0x02
#define MSG_WELCOME           0x03
#define MSG_DATA              0x04
#define MSG_ACK               0x05
#define MSG_POWER_LIMIT_REQ   0x06  // sender → controller: request power limit
#define MSG_POWER_LIMIT       0x07  // controller → sender: deliver power limit

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
    uint8_t  assigned_id;
    char     sync_timestamp[32];
} __attribute__((packed)) welcome_packet_t;

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

// sender_mac: MAC of the sender whose limit is being requested
typedef struct {
    uint8_t  msg_type;
    uint8_t  sender_mac[6];
} __attribute__((packed)) power_limit_req_packet_t;

// power_limit_mw: limit in milliwatts, forwarded to the sender
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
static bool    time_synced                   = false;

// ====== UART mutex & power-limit request queue ======
// uart_mutex: prevents uart_send_json and uart_power_limit_task from
// interleaving their writes on the TX line.
static SemaphoreHandle_t uart_mutex;

// Queue element: MAC address of the sender that requested its power limit
typedef struct {
    uint8_t mac[6];
} power_limit_req_t;

// Depth-10 queue so bursts of requests don't drop
static QueueHandle_t power_limit_req_queue;

/*---------------------------------------------------------------
    Time sync — request timestamp from backend over UART
---------------------------------------------------------------*/
static void request_time_from_backend(void) {
    uart_write_bytes(UART_PORT, TIME_REQUEST_STR, strlen(TIME_REQUEST_STR));
    ESP_LOGI(TAG, "Sent TIME_REQUEST to backend, waiting...");

    char buf[TIME_RESPONSE_BUF_LEN];
    int64_t deadline = esp_timer_get_time() + 5000000LL; // 5s timeout

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
            time_synced = true;
            ESP_LOGI(TAG, "Time synced: %s", controller_sync_timestamp);
            return;
        }
    }

    ESP_LOGE(TAG, "Time sync failed — no valid timestamp received from backend");
}

/*---------------------------------------------------------------
    Compute current real timestamp as ISO string.
---------------------------------------------------------------*/
static void get_current_timestamp(char *out, size_t len) {
    if (!time_synced) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }

    int64_t elapsed_us = esp_timer_get_time() - controller_sync_boot_us;

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
    char buf[600];
    int pos = 0;

    pos += snprintf(buf + pos, sizeof(buf) - pos,
                    "{\"mac\":\"%02X:%02X:%02X:%02X:%02X:%02X\",\"rx_time_ms\":%lu,\"frames\":[",
                    sender_mac[0], sender_mac[1], sender_mac[2],
                    sender_mac[3], sender_mac[4], sender_mac[5],
                    (unsigned long)rx_time_ms);

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

    xSemaphoreTake(uart_mutex, portMAX_DELAY);
    uart_write_bytes(UART_PORT, buf, pos);
    xSemaphoreGive(uart_mutex);
}

/*---------------------------------------------------------------
    UART power-limit task
    Dequeues power limit requests from on_data_recv, sends a UART
    query to the backend, waits for the response, then forwards the
    limit to the requesting sender via ESP-NOW MSG_POWER_LIMIT.
---------------------------------------------------------------*/

static void uart_power_limit_task(void *arg) {
    power_limit_req_t req;
    char req_buf[96];
    char resp_buf[160];

    while (1) {
        // Block until a sender requests its power limit
        if (xQueueReceive(power_limit_req_queue, &req, portMAX_DELAY) != pdTRUE)
            continue;

        // Send query to backend: {"type":"power_limit_request","mac":"AA:BB:CC:..."}\n
        int req_len = snprintf(req_buf, sizeof(req_buf),
            "{\"type\":\"power_limit_request\","
            "\"mac\":\"%02X:%02X:%02X:%02X:%02X:%02X\"}\n",
            req.mac[0], req.mac[1], req.mac[2],
            req.mac[3], req.mac[4], req.mac[5]);

        xSemaphoreTake(uart_mutex, portMAX_DELAY);
        uart_write_bytes(UART_PORT, req_buf, req_len);
        xSemaphoreGive(uart_mutex);

        ESP_LOGI(TAG, "Sent power_limit_request to backend for MAC "
                 "%02X:%02X:%02X:%02X:%02X:%02X",
                 req.mac[0], req.mac[1], req.mac[2],
                 req.mac[3], req.mac[4], req.mac[5]);

        // Wait for: {"type":"power_limit_response","mac":"...","power_limit_watts":350.0}\n
        memset(resp_buf, 0, sizeof(resp_buf));
        int idx = 0;
        int64_t deadline = esp_timer_get_time() + POWER_LIMIT_UART_TIMEOUT_US;

        while (esp_timer_get_time() < deadline && idx < (int)sizeof(resp_buf) - 1) {
            uint8_t c;
            int r = uart_read_bytes(UART_PORT, &c, 1, pdMS_TO_TICKS(50));
            if (r > 0) {
                resp_buf[idx++] = c;
                if (c == '\n') break;
            }
        }

        if (idx == 0) {
            ESP_LOGE(TAG, "Timed out waiting for power_limit_response");
            continue;
        }

        // Parse power_limit_watts from the response JSON
        char *key = strstr(resp_buf, "\"power_limit_watts\"");
        if (!key) {
            ESP_LOGE(TAG, "No power_limit_watts in response: %.80s", resp_buf);
            continue;
        }
        key = strchr(key, ':');
        if (!key) continue;
        key++;
        while (*key == ' ') key++;
        float power_limit_watts = strtof(key, NULL);
        int32_t power_limit_mw  = (int32_t)(power_limit_watts * 1000.0f);

        ESP_LOGI(TAG, "Got power limit %.1f W (%ld mW) for MAC "
                 "%02X:%02X:%02X:%02X:%02X:%02X",
                 power_limit_watts, power_limit_mw,
                 req.mac[0], req.mac[1], req.mac[2],
                 req.mac[3], req.mac[4], req.mac[5]);

        // Forward to the sender via ESP-NOW
        power_limit_packet_t pkt = {
            .msg_type       = MSG_POWER_LIMIT,
            .power_limit_mw = power_limit_mw,
        };
        esp_now_send(req.mac, (uint8_t *)&pkt, sizeof(pkt));

        node_state_t *node = find_node_by_mac(req.mac);
        if (node)
            ESP_LOGI(TAG, "Sent MSG_POWER_LIMIT to ECU%d", node->ecu_id);
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

        welcome_packet_t welcome = {
            .msg_type    = MSG_WELCOME,
            .assigned_id = 0,
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

        ESP_LOGI(TAG, "Sender %02X:%02X:%02X:%02X:%02X:%02X | %d frame(s) | floor=%d",
                 info->src_addr[0], info->src_addr[1], info->src_addr[2],
                 info->src_addr[3], info->src_addr[4], info->src_addr[5],
                 pkt->frame_count, node->confirmed_floor);

        uart_send_json(pkt, info->src_addr, rx_time_ms);

        ack_packet_t ack = {
            .msg_type        = MSG_ACK,
            .ack_to          = 0,
            .confirmed_floor = node->confirmed_floor,
        };
        esp_now_send(info->src_addr, (uint8_t *)&ack, sizeof(ack));
        return;
    }

    // ── POWER_LIMIT_REQ: Sender wants its power limit ──
    if (msg_type == MSG_POWER_LIMIT_REQ && len == sizeof(power_limit_req_packet_t)) {
        const power_limit_req_packet_t *req = (const power_limit_req_packet_t *)data;

        power_limit_req_t item;
        memcpy(item.mac, req->sender_mac, 6);

        // Non-blocking enqueue — if the queue is full the request is dropped
        if (xQueueSend(power_limit_req_queue, &item, 0) != pdTRUE) {
            ESP_LOGW(TAG, "Power limit request queue full, dropping request from "
                     "%02X:%02X:%02X:%02X:%02X:%02X",
                     req->sender_mac[0], req->sender_mac[1], req->sender_mac[2],
                     req->sender_mac[3], req->sender_mac[4], req->sender_mac[5]);
        } else {
            ESP_LOGI(TAG, "Queued power limit request for MAC "
                     "%02X:%02X:%02X:%02X:%02X:%02X",
                     req->sender_mac[0], req->sender_mac[1], req->sender_mac[2],
                     req->sender_mac[3], req->sender_mac[4], req->sender_mac[5]);
        }
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

    uart_mutex             = xSemaphoreCreateMutex();
    power_limit_req_queue  = xQueueCreate(10, sizeof(power_limit_req_t));

    request_time_from_backend();

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }
    esp_now_register_recv_cb(on_data_recv);

    xTaskCreate(hello_task,             "hello",        2048, NULL, 3, NULL);
    xTaskCreate(watchdog_task,          "watchdog",     2048, NULL, 2, NULL);
    xTaskCreate(uart_power_limit_task,  "uart_pwr_lim", 4096, NULL, 4, NULL);

    ESP_LOGI(TAG, "Controller ready, broadcasting HELLO...");
}
