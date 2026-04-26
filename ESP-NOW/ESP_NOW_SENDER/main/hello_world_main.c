// sender/main/main.c
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
#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

static const char *TAG = "SENDER";

// ====== Config ======
#define GAIN                  1
#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7
#define SAMPLES_PER_FRAME     10
#define MAX_FRAMES_PER_PKT    3
#define SENDER_BUFFER_SIZE    3000
#define ACK_TIMEOUT_MS        200

// ====== Msg type ======
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

typedef struct {
    uint8_t  msg_type;
    uint8_t  assigned_id;
} __attribute__((packed)) welcome_packet_t;

typedef struct {
    uint16_t counter;
    uint32_t time_since_boot_ms;
    int16_t  current_mv[SAMPLES_PER_FRAME];
    int16_t  voltage_mv[SAMPLES_PER_FRAME];
} __attribute__((packed)) adc_frame_t;

typedef struct {
    uint8_t     msg_type;
    uint8_t     sender_id;
    uint8_t     frame_count;
    adc_frame_t frames[MAX_FRAMES_PER_PKT];
} __attribute__((packed)) adc_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint8_t  ack_to;
    uint16_t confirmed_floor;
} __attribute__((packed)) ack_packet_t;

// ====== sending buffer ======
typedef struct {
    uint16_t counter;
    uint16_t time_100ms;

    uint8_t current_packed[15];
    uint8_t voltage_packed[15];

} buffered_frame_t;

static buffered_frame_t send_buffer[SENDER_BUFFER_SIZE];
static uint16_t next_counter     = 0;
static uint16_t confirmed_floor  = 0;

// ====== status ======
static uint8_t  my_mac[6];
static uint8_t  controller_mac[6];
static uint8_t  my_id            = 0;       // 0 = unassigned
static bool     registered       = false;
static volatile bool waiting_ack = false;
static volatile int64_t last_send_time = 0;

static bool     is_disconnected        = false;
static int64_t  disconnect_time_ms     = 0;
static uint16_t disconnect_first_frame = 0;
static uint8_t  consecutive_timeouts   = 0;
#define DISCONNECT_THRESHOLD  3

// ====== ADC ======
static adc_oneshot_unit_handle_t adc1_handle;
static adc_cali_handle_t adc1_cali_current = NULL;
static adc_cali_handle_t adc1_cali_voltage = NULL;
static adc_channel_t channels[2] = {ADC_CURRENT_CHANNEL, ADC_VOLTAGE_CHANNEL};

void sender_task(void *arg);  

/*---------------------------------------------------------------
    Buffer management
---------------------------------------------------------------*/
static void pack_12bit(const uint16_t *in, uint8_t *out, int count)
{
    int j = 0;
    for (int i = 0; i < count; i += 2) {
        uint16_t a = in[i] & 0x0FFF;
        uint16_t b = (i + 1 < count) ? (in[i + 1] & 0x0FFF) : 0;

        out[j++] = a & 0xFF;
        out[j++] = ((a >> 8) & 0x0F) | ((b & 0x0F) << 4);
        out[j++] = (b >> 4) & 0xFF;
    }
}

static void unpack_12bit(const uint8_t *in, uint16_t *out, int count)
{
    int j = 0;
    for (int i = 0; i < count; i += 2) {
        uint8_t b0 = in[j++];
        uint8_t b1 = in[j++];
        uint8_t b2 = in[j++];

        out[i] = b0 | ((b1 & 0x0F) << 8);

        if (i + 1 < count) {
            out[i + 1] = ((b1 >> 4) & 0x0F) | (b2 << 4);
        }
    }
}

static void buffer_push(int16_t *current_mv, int16_t *voltage_mv)
{
    uint16_t slot = next_counter % SENDER_BUFFER_SIZE;
    buffered_frame_t *f = &send_buffer[slot];

    f->counter = next_counter;
    f->time_100ms = (uint16_t)(esp_timer_get_time() / 100000);

    uint16_t tmp_c[SAMPLES_PER_FRAME];
    uint16_t tmp_v[SAMPLES_PER_FRAME];

    for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
        tmp_c[i] = (uint16_t)current_mv[i];
        tmp_v[i] = (uint16_t)voltage_mv[i];
    }

    pack_12bit(tmp_c, f->current_packed, SAMPLES_PER_FRAME);
    pack_12bit(tmp_v, f->voltage_packed, SAMPLES_PER_FRAME);

    if ((next_counter - confirmed_floor) >= SENDER_BUFFER_SIZE) {
        confirmed_floor = next_counter - SENDER_BUFFER_SIZE + 1;
    }

    next_counter++;
}

static void buffer_clear_acked(uint16_t floor) {
    confirmed_floor       = floor;
    consecutive_timeouts  = 0; 

    if (is_disconnected) {
        is_disconnected = false;
        ESP_LOGI(TAG, "=== RECONNECTED ===");
    }

    ESP_LOGI(TAG, "Confirmed floor→%d", floor);
}
static uint8_t build_packet(adc_packet_t *pkt) {
    pkt->msg_type    = MSG_DATA;
    pkt->sender_id   = my_id;
    pkt->frame_count = 0;

    uint16_t start = confirmed_floor + 1;

    for (uint16_t c = start;
         c < next_counter && pkt->frame_count < MAX_FRAMES_PER_PKT; c++) {

        uint16_t slot = c % SENDER_BUFFER_SIZE;
        buffered_frame_t *f = &send_buffer[slot];

        if (f->counter != c) continue;

        adc_frame_t *dst = &pkt->frames[pkt->frame_count++];

        dst->counter = f->counter;

        // Reconstruct timestamp (10 frames/sec → 100ms per frame)
        dst->time_since_boot_ms = f->counter * 100;

        uint16_t tmp_current[SAMPLES_PER_FRAME];
        uint16_t tmp_voltage[SAMPLES_PER_FRAME];

        // Unpack back to original format
        unpack_12bit(f->current_packed, tmp_current, SAMPLES_PER_FRAME);
        unpack_12bit(f->voltage_packed, tmp_voltage, SAMPLES_PER_FRAME);

        for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
            dst->current_mv[i] = (int16_t)tmp_current[i];
            dst->voltage_mv[i] = (int16_t)tmp_voltage[i];
        }
    }

    return pkt->frame_count;
}

/*---------------------------------------------------------------
    ESP-NOW callback
---------------------------------------------------------------*/

static void on_data_sent(const uint8_t *mac, esp_now_send_status_t status) {
    if (status != ESP_NOW_SEND_SUCCESS) {
        waiting_ack = false;
        consecutive_timeouts++;

        if (consecutive_timeouts >= DISCONNECT_THRESHOLD && !is_disconnected) {
            is_disconnected        = true;
            disconnect_time_ms     = esp_timer_get_time() / 1000;
            disconnect_first_frame = confirmed_floor + 1;

            ESP_LOGW(TAG, "=== DISCONNECTED (send failed %d times) ===",
                     consecutive_timeouts);
            ESP_LOGW(TAG, "First frame in buffer: counter=%d  time_100ms=%d",
                     disconnect_first_frame,
                     send_buffer[disconnect_first_frame % SENDER_BUFFER_SIZE].time_100ms);
        } else {
            ESP_LOGW(TAG, "Send FAILED (%d/%d)",
                     consecutive_timeouts, DISCONNECT_THRESHOLD);
        }
    }
}

static void on_data_recv(const esp_now_recv_info_t *info,
                         const uint8_t *data, int len) {
    if (len < 1) return;
    uint8_t msg_type = data[0];

    // ── HELLO：Controller broadcast, reply REGISTER  ──
    if (msg_type == MSG_HELLO && len == sizeof(hello_packet_t)) {
        const hello_packet_t *hello = (const hello_packet_t *)data;

        memcpy(controller_mac, hello->controller_mac, 6);

        if (!esp_now_is_peer_exist(controller_mac)) {
            esp_now_peer_info_t peer = {};
            memcpy(peer.peer_addr, controller_mac, 6);
            peer.channel = 0;
            peer.encrypt = false;
            esp_now_add_peer(&peer);
        }

        if (!registered) {
            register_packet_t reg = {.msg_type = MSG_REGISTER};
            memcpy(reg.sender_mac, my_mac, 6);
            esp_now_send(controller_mac, (uint8_t *)&reg, sizeof(reg));
            ESP_LOGI(TAG, "Sent REGISTER to controller");
        }
        return;
    }

    // ── WELCOME：save ID and start ADC sampling ──
    if (msg_type == MSG_WELCOME && len == sizeof(welcome_packet_t)) {
        const welcome_packet_t *welcome = (const welcome_packet_t *)data;
        my_id      = welcome->assigned_id;
        registered = true;
        ESP_LOGI(TAG, "Registered! Assigned ID = %d", my_id);
        xTaskCreate(sender_task, "sender_task", 4096, NULL, 5, NULL);
        return;
    }

    // ── ACK ──
    if (msg_type == MSG_ACK && len == sizeof(ack_packet_t)) {
        const ack_packet_t *ack = (const ack_packet_t *)data;
        if (ack->ack_to != my_id) return;
        buffer_clear_acked(ack->confirmed_floor);
        waiting_ack = false;
        ESP_LOGI(TAG, "ACK floor=%d", ack->confirmed_floor);
        return;
    }
}

/*---------------------------------------------------------------
    ADC init
---------------------------------------------------------------*/

static bool adc_calibration_init(adc_unit_t unit, adc_channel_t channel,
                                  adc_atten_t atten, adc_cali_handle_t *out) {
    adc_cali_handle_t handle = NULL;
    bool calibrated = false;
#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cfg = {
        .unit_id = unit, .chan = channel,
        .atten = atten, .bitwidth = ADC_BITWIDTH_DEFAULT
    };
    if (adc_cali_create_scheme_curve_fitting(&cfg, &handle) == ESP_OK)
        calibrated = true;
#endif
#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    if (!calibrated) {
        adc_cali_line_fitting_config_t cfg = {
            .unit_id = unit, .atten = atten, .bitwidth = ADC_BITWIDTH_DEFAULT
        };
        if (adc_cali_create_scheme_line_fitting(&cfg, &handle) == ESP_OK)
            calibrated = true;
    }
#endif
    *out = handle;
    return calibrated;
}

static void adc_init(void) {
    adc_oneshot_unit_init_cfg_t unit_cfg = {.unit_id = ADC_UNIT_1};
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_cfg, &adc1_handle));
    adc_oneshot_chan_cfg_t ch_cfg = {
        .atten = ADC_ATTEN_DB_12, .bitwidth = ADC_BITWIDTH_12
    };
    for (int i = 0; i < 2; i++)
        ESP_ERROR_CHECK(adc_oneshot_config_channel(
            adc1_handle, channels[i], &ch_cfg));
    adc_calibration_init(ADC_UNIT_1, channels[0],
                         ADC_ATTEN_DB_12, &adc1_cali_current);
    adc_calibration_init(ADC_UNIT_1, channels[1],
                         ADC_ATTEN_DB_12, &adc1_cali_voltage);
    ESP_LOGI(TAG, "ADC init done");
}

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
    Sender Task（Start after receiving WELCOME）
---------------------------------------------------------------*/

void sender_task(void *arg) {
    int16_t current_buf[SAMPLES_PER_FRAME];
    int16_t voltage_buf[SAMPLES_PER_FRAME];
    int     sample_index     = 0;
    int64_t last_sample_time = 0;

    ESP_LOGI(TAG, "Sender task started as ECU%d", my_id);

    while (1) {
        int64_t now = esp_timer_get_time() / 1000;

        // 100Hz sampling rate
        if (now - last_sample_time >= 10) {
            last_sample_time = now;
            int raw_c, raw_v, mv_c, mv_v;
            ESP_ERROR_CHECK(adc_oneshot_read(
                adc1_handle, ADC_CURRENT_CHANNEL, &raw_c));
            adc_cali_raw_to_voltage(adc1_cali_current, raw_c, &mv_c);
            ESP_ERROR_CHECK(adc_oneshot_read(
                adc1_handle, ADC_VOLTAGE_CHANNEL, &raw_v));
            adc_cali_raw_to_voltage(adc1_cali_voltage, raw_v, &mv_v);

            current_buf[sample_index] = (int16_t)(mv_c * GAIN);
            voltage_buf[sample_index] = (int16_t)mv_v;
            sample_index++;
        }

        // get 10 -> add in the buffer
        if (sample_index >= SAMPLES_PER_FRAME) {
            buffer_push(current_buf, voltage_buf);
            sample_index = 0;

        if (waiting_ack && (now - last_send_time > ACK_TIMEOUT_MS)) {
            waiting_ack = false;
            consecutive_timeouts++;

            if (consecutive_timeouts >= DISCONNECT_THRESHOLD && !is_disconnected) {
                is_disconnected        = true;
                disconnect_time_ms     = now;
                disconnect_first_frame = confirmed_floor + 1;

                ESP_LOGW(TAG, "=== DISCONNECTED (ack timeout %d times) ===",
                        consecutive_timeouts);
                ESP_LOGW(TAG, "First frame in buffer: counter=%d  time_100ms=%d",
                        disconnect_first_frame,
                        send_buffer[disconnect_first_frame % SENDER_BUFFER_SIZE].time_100ms);
            } else if (!is_disconnected) {
                ESP_LOGW(TAG, "ACK timeout (%d/%d), bundling with next frame",
                        consecutive_timeouts, DISCONNECT_THRESHOLD);
            }
        }

            // send in a pack. AT MOST THREE FRAME!!!
            if (!waiting_ack) {
                adc_packet_t pkt;
                uint8_t count = build_packet(&pkt);
                if (count > 0) {
                    esp_now_send(controller_mac,
                                 (uint8_t *)&pkt, sizeof(pkt));
                    waiting_ack    = true;
                    last_send_time = now;
                    ESP_LOGI(TAG, "Sent %d frame(s), counter %d~%d",
                             count,
                             pkt.frames[0].counter,
                             pkt.frames[count - 1].counter);
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

/*---------------------------------------------------------------
    buffer_monitor_task
---------------------------------------------------------------*/
static void buffer_monitor_task(void *arg) {
    int64_t last_print_ms = 0;

    while (1) {
        vTaskDelay(pdMS_TO_TICKS(500));

        if (!is_disconnected) {
            last_print_ms = 0;  
            continue;
        }

        int64_t now = esp_timer_get_time() / 1000;
        int64_t disconnected_for_ms = now - disconnect_time_ms;

        if (last_print_ms == 0 || (now - last_print_ms >= 5000)) {
            last_print_ms = now;

            uint16_t first_counter = confirmed_floor + 1;
            uint16_t last_counter  = next_counter - 1;
            uint16_t buffered_frames = next_counter - confirmed_floor - 1;

            buffered_frame_t *first_f =
                &send_buffer[first_counter % SENDER_BUFFER_SIZE];
            buffered_frame_t *last_f  =
                &send_buffer[last_counter  % SENDER_BUFFER_SIZE];

            ESP_LOGW(TAG, "─────── Buffer Status ───────");
            ESP_LOGW(TAG, "Disconnected for: %lld ms (%.1f sec)",
                     disconnected_for_ms,
                     (float)disconnected_for_ms / 1000.0f);
            ESP_LOGW(TAG, "First frame: counter=%d  (%.1f sec since boot)",
                     first_f->counter,
                     (float)first_f->time_100ms / 10.0f);
            ESP_LOGW(TAG, "Last  frame: counter=%d  (%.1f sec since boot)",
                     last_f->counter,
                     (float)last_f->time_100ms / 10.0f);
            ESP_LOGW(TAG, "Buffered: %d / %d frames  (%.1f sec worth)",
                     buffered_frames, SENDER_BUFFER_SIZE,
                     (float)buffered_frames / 10.0f);

            if (disconnected_for_ms >= 300000 && disconnected_for_ms < 305000) {
                ESP_LOGW(TAG, "★ 5 MINUTES REACHED ★");
                ESP_LOGW(TAG, "Expected: 3000  Actual: %d", buffered_frames);
                if (buffered_frames >= 2950) {
                    ESP_LOGI(TAG, "✅ Buffer test PASSED");
                } else {
                    ESP_LOGE(TAG, "❌ Buffer test FAILED, lost %d frames",
                             3000 - buffered_frames);
                }
            }
            ESP_LOGW(TAG, "─────────────────────────────");
        }
    }
}

/*---------------------------------------------------------------
    App Main
---------------------------------------------------------------*/

void app_main(void) {
    ESP_LOGI(TAG, "Free heap: %lu bytes", esp_get_free_heap_size());

    wifi_init();
    adc_init();

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }
    esp_now_register_send_cb(on_data_sent);
    esp_now_register_recv_cb(on_data_recv);

    // 启动buffer监控task
    xTaskCreate(buffer_monitor_task, "buf_monitor", 2048, NULL, 2, NULL);

    ESP_LOGI(TAG, "Sender ready, waiting for HELLO from controller...");
}