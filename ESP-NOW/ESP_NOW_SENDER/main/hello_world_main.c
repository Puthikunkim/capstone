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
#include "driver/gpio.h"
#include "driver/ledc.h"

#include <time.h>
#include "esp_spiffs.h"
#include "nvs.h"

static const char *TAG = "SENDER";

// ====== Config ======
#define GAIN                        1
#define ADC_CURRENT_HIGH_CHANNEL    ADC_CHANNEL_4
#define ADC_CURRENT_LOW_CHANNEL     ADC_CHANNEL_7
#define CURRENT_RANGE_SWITCH_MV     1000
#define ADC_VOLTAGE_CHANNEL         ADC_CHANNEL_6
#define SAMPLES_PER_FRAME           10
#define MAX_FRAMES_PER_PKT          3
#define SENDER_BUFFER_SIZE          2000
#define ACK_TIMEOUT_MS              200
#define BUZZER_GPIO                 GPIO_NUM_19
#define BUZZER_BEEP_HALF_MS         125
#define BUZZER_LEDC_TIMER           LEDC_TIMER_0
#define BUZZER_LEDC_CHANNEL         LEDC_CHANNEL_0
#define BUZZER_FREQ_HZ              2000
#define BUZZER_DUTY_RES             LEDC_TIMER_10_BIT
#define BUZZER_DUTY_50PCT           512

// ====== Msg type ======
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
    int64_t  tx_epoch_us;  // UTC microseconds since epoch, computed by sender at capture time
    int16_t  current_mv[SAMPLES_PER_FRAME];
    int16_t  voltage_mv[SAMPLES_PER_FRAME];
} __attribute__((packed)) adc_frame_t;

typedef struct {
    uint8_t     msg_type;
    uint8_t     frame_count;
    adc_frame_t frames[MAX_FRAMES_PER_PKT];
} __attribute__((packed)) adc_packet_t;

typedef struct {
    uint8_t  msg_type;
    uint16_t confirmed_floor;
} __attribute__((packed)) ack_packet_t;

// power_limit_mw: limit in milliwatts, pushed by the controller
typedef struct {
    uint8_t  msg_type;
    int32_t  power_limit_mw;
} __attribute__((packed)) power_limit_packet_t;

// ====== Sending buffer ======
typedef struct {
    uint16_t counter;
    uint32_t time_100ms;  // uint16_t overflowed at ~109 min boot time
    int16_t  current_mv[SAMPLES_PER_FRAME];
    int16_t  voltage_mv[SAMPLES_PER_FRAME];
} buffered_frame_t;

static buffered_frame_t send_buffer[SENDER_BUFFER_SIZE];
static uint16_t next_counter     = 0;
static uint16_t confirmed_floor  = 0;

// ====== Power limit state ======
// Start with 10 kW so the over-power flag never fires before the controller
// delivers a real limit.  Replaced by MSG_POWER_LIMIT whenever the backend
// pushes one via the controller.
#define DEFAULT_POWER_LIMIT_MW  10000000L
static volatile int32_t power_threshold_mw  = DEFAULT_POWER_LIMIT_MW;
static volatile bool    over_power_flag      = false;
static volatile int64_t over_power_start_ms  = 0;  // boot-time ms when breach began

// ====== Status ======
static uint8_t  my_mac[6];
static uint8_t  controller_mac[6];
static bool     registered       = false;
static volatile bool waiting_ack = false;
static volatile int64_t last_send_time = 0;

static TaskHandle_t adc_task_handle    = NULL;
static TaskHandle_t sender_task_handle = NULL;

static bool     is_disconnected        = false;
static int64_t  disconnect_time_ms     = 0;
static uint16_t disconnect_first_frame = 0;
static uint8_t  consecutive_timeouts   = 0;
#define DISCONNECT_THRESHOLD  10

// ====== Flash persistence ======
#define FLASH_FILE           "/spiffs/frames.bin"
#define FLASH_NVS_NS         "sender_state"
#define FLASH_KEY_CONF_FLOOR "conf_floor"
#define FLASH_KEY_BASE_CTR   "base_ctr"

// ====== Time sync state ======
// sync_base_us precomputed once at WELCOME so the hot path in
// compute_frame_timestamp never calls strptime/mktime again.
static char    sync_timestamp[32] = {0};
static int64_t sync_boot_us       = 0;
static int64_t sync_base_us       = 0;
static bool    time_synced        = false;

// ====== ADC ======
static adc_oneshot_unit_handle_t adc1_handle;
static adc_cali_handle_t adc1_cali_current_low = NULL;
static adc_cali_handle_t adc1_cali_current_high = NULL;
static adc_cali_handle_t adc1_cali_voltage = NULL;
static adc_channel_t channels[3] = {ADC_CURRENT_HIGH_CHANNEL, ADC_CURRENT_LOW_CHANNEL, ADC_VOLTAGE_CHANNEL};

void sender_task(void *arg);
void adc_task(void *arg);

// ADC-Sender ring
#define SAMPLE_RING_SIZE 500
#define SAMPLE_PERIOD_MS 10

typedef struct {
    int16_t current_mv;
    int16_t voltage_mv;
    int64_t sampled_at;
} raw_sample_t;

static raw_sample_t sample_ring[SAMPLE_RING_SIZE];
static volatile uint16_t ring_write = 0;
static volatile uint16_t ring_read  = 0;
static SemaphoreHandle_t ring_mutex;

//Sleep Mode
#define SLEEP_VOLTAGE_THRESH_MV  200
#define SLEEP_CURRENT_THRESH_MA  200
#define SLEEP_ENTRY_MS           30000

static volatile bool modem_sleeping     = false;
static int64_t       below_thresh_since = 0;

static FILE            *flash_fp       = NULL;
static uint16_t         flash_base_ctr = 0;
static nvs_handle_t     flash_nvs;
static SemaphoreHandle_t flash_mutex;


/*---------------------------------------------------------------
    Buzzer — passive buzzer driven by LEDC PWM at 2 kHz.
    buzzer_set(true)  → 50% duty → audible tone
    buzzer_set(false) → 0% duty  → silent
---------------------------------------------------------------*/
static void buzzer_init(void) {
    ledc_timer_config_t timer = {
        .speed_mode      = LEDC_LOW_SPEED_MODE,
        .timer_num       = BUZZER_LEDC_TIMER,
        .duty_resolution = BUZZER_DUTY_RES,
        .freq_hz         = BUZZER_FREQ_HZ,
        .clk_cfg         = LEDC_AUTO_CLK,
    };
    ESP_ERROR_CHECK(ledc_timer_config(&timer));

    ledc_channel_config_t channel = {
        .speed_mode = LEDC_LOW_SPEED_MODE,
        .channel    = BUZZER_LEDC_CHANNEL,
        .timer_sel  = BUZZER_LEDC_TIMER,
        .gpio_num   = BUZZER_GPIO,
        .duty       = 0,
        .hpoint     = 0,
    };
    ESP_ERROR_CHECK(ledc_channel_config(&channel));
}

static void buzzer_set(bool on) {
    ledc_set_duty(LEDC_LOW_SPEED_MODE, BUZZER_LEDC_CHANNEL,
                  on ? BUZZER_DUTY_50PCT : 0);
    ledc_update_duty(LEDC_LOW_SPEED_MODE, BUZZER_LEDC_CHANNEL);
}

/*---------------------------------------------------------------
    Called whenever a new power limit is pushed by the controller.
---------------------------------------------------------------*/
static void on_power_limit_received(int32_t limit_mw) {
    ESP_LOGI(TAG, "Power limit updated to %ld mW", limit_mw);
}

/*---------------------------------------------------------------
    Format a precomputed UTC epoch (microseconds since Unix epoch)
    as an ISO-8601 string.  epoch_us == 0 → epoch fallback string.
---------------------------------------------------------------*/
static void compute_frame_timestamp(int64_t epoch_us,
                                    char *out, size_t len) {
    if (epoch_us == 0) {
        strncpy(out, "1970-01-01T00:00:00.000000", len);
        return;
    }

    time_t  final_sec = epoch_us / 1000000LL;
    int     final_us  = (int)(epoch_us % 1000000LL);

    struct tm *final_tm = gmtime(&final_sec);
    snprintf(out, len,
             "%04d-%02d-%02dT%02d:%02d:%02d.%06d",
             final_tm->tm_year + 1900, final_tm->tm_mon + 1, final_tm->tm_mday,
             final_tm->tm_hour, final_tm->tm_min, final_tm->tm_sec, final_us);
}

/*---------------------------------------------------------------
    Flash persistence
---------------------------------------------------------------*/

static void flash_save_frame(const buffered_frame_t *f) {
    if (!flash_fp) return;
    xSemaphoreTake(flash_mutex, portMAX_DELAY);
    fwrite(f, sizeof(buffered_frame_t), 1, flash_fp);
    if (f->counter % 10 == 0)
        fflush(flash_fp);
    xSemaphoreGive(flash_mutex);
}

static void flash_update_floor(uint16_t floor) {
    xSemaphoreTake(flash_mutex, portMAX_DELAY);
    nvs_set_u16(flash_nvs, FLASH_KEY_CONF_FLOOR, floor);
    nvs_commit(flash_nvs);
    // All frames confirmed: clear the file to reclaim space
    if (floor == (uint16_t)(next_counter - 1) && flash_fp) {
        fclose(flash_fp);
        remove(FLASH_FILE);
        flash_fp = fopen(FLASH_FILE, "ab");
        flash_base_ctr = next_counter;
        nvs_set_u16(flash_nvs, FLASH_KEY_BASE_CTR, flash_base_ctr);
        nvs_commit(flash_nvs);
        ESP_LOGI(TAG, "Flash: fully confirmed, file reset (base=%d)", flash_base_ctr);
    }
    xSemaphoreGive(flash_mutex);
}

// Called once at boot (after nvs_flash_init via wifi_init).
// Mounts SPIFFS, restores ring buffer from flash, then opens log for append.
static void flash_init(void) {
    esp_vfs_spiffs_conf_t conf = {
        .base_path              = "/spiffs",
        .partition_label        = NULL,
        .max_files              = 3,
        .format_if_mount_failed = true,
    };
    if (esp_vfs_spiffs_register(&conf) != ESP_OK) {
        ESP_LOGE(TAG, "SPIFFS mount failed — flash persistence disabled");
        return;
    }
    if (nvs_open(FLASH_NVS_NS, NVS_READWRITE, &flash_nvs) != ESP_OK) {
        ESP_LOGE(TAG, "NVS open failed — flash persistence disabled");
        return;
    }

    uint16_t saved_floor = 0;
    nvs_get_u16(flash_nvs, FLASH_KEY_CONF_FLOOR, &saved_floor);
    nvs_get_u16(flash_nvs, FLASH_KEY_BASE_CTR,   &flash_base_ctr);

    // Load unconfirmed frames back into the ring buffer
    FILE *f = fopen(FLASH_FILE, "rb");
    if (f) {
        buffered_frame_t frame;
        uint16_t max_ctr = saved_floor;
        uint16_t loaded  = 0;
        while (fread(&frame, sizeof(buffered_frame_t), 1, f) == 1) {
            if ((int16_t)(frame.counter - saved_floor) > 0) {
                send_buffer[frame.counter % SENDER_BUFFER_SIZE] = frame;
                if ((int16_t)(frame.counter - max_ctr) > 0)
                    max_ctr = frame.counter;
                loaded++;
            }
        }
        fclose(f);
        if (loaded > 0) {
            confirmed_floor = saved_floor;
            next_counter    = max_ctr + 1;
            ESP_LOGI(TAG, "Restored %d frames from flash (floor=%d  next=%d)",
                     loaded, confirmed_floor, next_counter);
        }
    }

    flash_fp = fopen(FLASH_FILE, "ab");
    if (!flash_fp) {
        ESP_LOGE(TAG, "Failed to open flash log for append");
        return;
    }
    size_t total = 0, used = 0;
    esp_spiffs_info(NULL, &total, &used);
    ESP_LOGI(TAG, "Flash ready — SPIFFS %u / %u bytes used", used, total);
}

/*---------------------------------------------------------------
    Buffer management
---------------------------------------------------------------*/
static void buffer_push(int16_t *current_mv, int16_t *voltage_mv) {
    uint16_t slot = next_counter % SENDER_BUFFER_SIZE;
    buffered_frame_t *f = &send_buffer[slot];

    f->counter    = next_counter;
    f->time_100ms = (uint32_t)(esp_timer_get_time() / 100000);

    for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
        f->current_mv[i] = current_mv[i];
        f->voltage_mv[i] = voltage_mv[i];
    }

    if ((next_counter - confirmed_floor) >= SENDER_BUFFER_SIZE)
        confirmed_floor = next_counter - SENDER_BUFFER_SIZE + 1;

    flash_save_frame(f);
    next_counter++;
}

static void buffer_clear_acked(uint16_t floor) {
    confirmed_floor      = floor;
    consecutive_timeouts = 0;
    flash_update_floor(floor);

    if (is_disconnected) {
        is_disconnected = false;
        ESP_LOGI(TAG, "=== RECONNECTED ===");
    }

    ESP_LOGI(TAG, "Confirmed floor→%d", floor);
}

static uint8_t build_packet(adc_packet_t *pkt) {
    pkt->msg_type    = MSG_DATA;
    pkt->frame_count = 0;

    uint16_t start = confirmed_floor + 1;

    for (uint16_t c = start;
         c < next_counter && pkt->frame_count < MAX_FRAMES_PER_PKT; c++) {

        uint16_t slot = c % SENDER_BUFFER_SIZE;
        buffered_frame_t *f = &send_buffer[slot];

        if (f->counter != c) continue;

        adc_frame_t *dst = &pkt->frames[pkt->frame_count++];

        dst->counter = f->counter;
        int64_t frame_boot_us = (int64_t)f->time_100ms * 100000LL;
        int64_t epoch = time_synced ? (sync_base_us + (frame_boot_us - sync_boot_us)) : 0LL;
        dst->tx_epoch_us = (epoch > 0) ? epoch : 0LL;

        for (int i = 0; i < SAMPLES_PER_FRAME; i++) {
            dst->current_mv[i] = f->current_mv[i];
            dst->voltage_mv[i] = f->voltage_mv[i];
        }
    }

    return pkt->frame_count;
}

/*---------------------------------------------------------------
    ESP-NOW callbacks
---------------------------------------------------------------*/

static void on_data_sent(const esp_now_send_info_t *tx_info, esp_now_send_status_t status) {
    if (status != ESP_NOW_SEND_SUCCESS) {
        waiting_ack = false;
        consecutive_timeouts++;

        if (consecutive_timeouts >= DISCONNECT_THRESHOLD && !is_disconnected) {
            is_disconnected        = true;
            registered             = false;
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

    ESP_LOGW(TAG, "RX msg=%d len=%d", msg_type, len);

    // ── HELLO: Controller broadcast, reply REGISTER ──
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

    // ── WELCOME: save ID, anchor time sync, start tasks, request power limit ──
    if (msg_type == MSG_WELCOME && len == sizeof(welcome_packet_t)) {
        const welcome_packet_t *welcome = (const welcome_packet_t *)data;
        registered = true;
        consecutive_timeouts = 0;

        // Anchor real wall-clock time from the controller's timestamp
        strncpy(sync_timestamp, welcome->sync_timestamp, sizeof(sync_timestamp));
        sync_boot_us = esp_timer_get_time();

        // Precompute sync_base_us so compute_frame_timestamp is cheap
        {
            char base_no_us[32];
            int us = 0;
            char *dot = strchr(sync_timestamp, '.');
            if (dot) {
                size_t base_len = dot - sync_timestamp;
                strncpy(base_no_us, sync_timestamp, base_len);
                base_no_us[base_len] = '\0';
                us = atoi(dot + 1);
            } else {
                strncpy(base_no_us, sync_timestamp, sizeof(base_no_us));
            }
            struct tm tm_base = {0};
            strptime(base_no_us, "%Y-%m-%dT%H:%M:%S", &tm_base);
            time_t base_epoch = mktime(&tm_base);
            sync_base_us = (int64_t)base_epoch * 1000000LL + us;
        }

        time_synced = true;

        ESP_LOGI(TAG, "Registered! sync time = %s", sync_timestamp);

        if (adc_task_handle == NULL)
            xTaskCreate(adc_task,    "adc_task",    4096, NULL, 6, &adc_task_handle);
        if (sender_task_handle == NULL)
            xTaskCreate(sender_task, "sender_task", 4096, NULL, 5, &sender_task_handle);
        return;
    }

    // ── ACK ──
    if (msg_type == MSG_ACK && len == sizeof(ack_packet_t)) {
        const ack_packet_t *ack = (const ack_packet_t *)data;
        buffer_clear_acked(ack->confirmed_floor);
        waiting_ack = false;
        ESP_LOGI(TAG, "ACK floor=%d", ack->confirmed_floor);
        return;
    }

    // ── POWER_LIMIT: store and call enforcement placeholder ──
    if (msg_type == MSG_POWER_LIMIT && len == sizeof(power_limit_packet_t)) {
        const power_limit_packet_t *pl = (const power_limit_packet_t *)data;
        power_threshold_mw = pl->power_limit_mw;
        on_power_limit_received(power_threshold_mw);
        ESP_LOGI(TAG, "Power limit received: %ld mW", power_threshold_mw);
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
    for (int i = 0; i < 3; i++)
        ESP_ERROR_CHECK(adc_oneshot_config_channel(
            adc1_handle, channels[i], &ch_cfg));
    adc_calibration_init(ADC_UNIT_1, channels[0],
                         ADC_ATTEN_DB_12, &adc1_cali_current_high);
    adc_calibration_init(ADC_UNIT_1, channels[1],
                         ADC_ATTEN_DB_12, &adc1_cali_current_low);
    adc_calibration_init(ADC_UNIT_1, channels[2],
                         ADC_ATTEN_DB_12, &adc1_cali_voltage);
    ESP_LOGI(TAG, "ADC init done");
}

static void wifi_init(void) {
    esp_err_t nvs_ret = nvs_flash_init();
    if (nvs_ret == ESP_ERR_NVS_NO_FREE_PAGES || nvs_ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_LOGW(TAG, "NVS corrupted, erasing and reinitialising");
        nvs_flash_erase();
        nvs_flash_init();
    }
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
    Sender Task (starts after receiving WELCOME)
---------------------------------------------------------------*/

void adc_task(void *arg) {
    int64_t last_sample_time = 0;

    ESP_LOGI(TAG, "ADC task started");

    while (1) {
        int64_t now = esp_timer_get_time() / 1000;

        // 100Hz sampling
        if (now - last_sample_time >= SAMPLE_PERIOD_MS) {
            last_sample_time = now;
            int raw_c_high, raw_c_low, raw_v, mv_c, mv_v;
            bool is_c_low;
            ESP_ERROR_CHECK(adc_oneshot_read(
                adc1_handle, ADC_CURRENT_HIGH_CHANNEL, &raw_c_high));
            adc_cali_raw_to_voltage(adc1_cali_current_high, raw_c_high, &mv_c);
            //is_c_low = false;

            if (mv_c < CURRENT_RANGE_SWITCH_MV) {
                ESP_ERROR_CHECK(adc_oneshot_read(
                    adc1_handle, ADC_CURRENT_LOW_CHANNEL, &raw_c_low));
                adc_cali_raw_to_voltage(adc1_cali_current_low, raw_c_low, &mv_c);
                //is_c_low = true;
            }

            /*if (is_c_low) {
                mv_c = 100;
            */}

            ESP_ERROR_CHECK(adc_oneshot_read(
                adc1_handle, ADC_VOLTAGE_CHANNEL, &raw_v));
            adc_cali_raw_to_voltage(adc1_cali_voltage, raw_v, &mv_v);

            int32_t power_mw = ((int32_t)mv_v * mv_c) / 1000;
            if (power_mw > power_threshold_mw) {
                if (!over_power_flag) {
                    over_power_flag     = true;
                    over_power_start_ms = now;
                    ESP_LOGE(TAG,
                             "OVER POWER: %ld mW > threshold %ld mW "
                             "(V=%d mV, I=%d mV)",
                             power_mw, power_threshold_mw,
                             (int16_t)mv_v, (int16_t)mv_c);
                }
            } else {
                if (over_power_flag) {
                    over_power_flag = false;
                    buzzer_set(false);
                    ESP_LOGI(TAG,
                             "Power back to normal: %ld mW <= threshold %ld mW",
                             power_mw, power_threshold_mw);
                }
            }

            // Buzzer: beep at 4 Hz for the first second, then continuous tone
            if (over_power_flag) {
                int64_t breach_ms = now - over_power_start_ms;
                if (breach_ms >= 1000) {
                    buzzer_set(true);
                } else {
                    buzzer_set((now / BUZZER_BEEP_HALF_MS) % 2);
                }
            }

            xSemaphoreTake(ring_mutex, portMAX_DELAY);
            uint16_t slot = ring_write % SAMPLE_RING_SIZE;
            sample_ring[slot].current_mv = (int16_t)(mv_c * GAIN);
            sample_ring[slot].voltage_mv = (int16_t)mv_v;
            sample_ring[slot].sampled_at = now;
            ring_write++;
            xSemaphoreGive(ring_mutex);

            bool low_activity = (mv_v < SLEEP_VOLTAGE_THRESH_MV && 
                     mv_c < SLEEP_CURRENT_THRESH_MA);
            int64_t now_ms = esp_timer_get_time() / 1000;

            if (low_activity) {
                if (!modem_sleeping) {
                    if (below_thresh_since == 0) {
                        below_thresh_since = now_ms;
                    }
                    else if ((now_ms - below_thresh_since) >= SLEEP_ENTRY_MS) {
                            modem_sleeping     = true;
                            below_thresh_since = 0;
                            esp_wifi_set_ps(WIFI_PS_MIN_MODEM);
                            ESP_LOGI(TAG, "Modem sleep ENTER — V=%d mV, I=%d mV quiet for 30s", mv_v, mv_c);
                    }
                }
            } else {
                below_thresh_since = 0;  // reset timer on any active reading

                if (modem_sleeping) {
                    modem_sleeping = false;
                    esp_wifi_set_ps(WIFI_PS_NONE);
                    waiting_ack    = false;
                    last_send_time = 0;
                    confirmed_floor = next_counter - 1;
                    ESP_LOGI(TAG, "Modem sleep EXIT — V=%d mV, I=%d mV", mv_v, mv_c);
                }
            }
        }
        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

void sender_task(void *arg) {
    int16_t current_buf[SAMPLES_PER_FRAME];
    int16_t voltage_buf[SAMPLES_PER_FRAME];
    int     sample_index = 0;
    int64_t now = 0;
    int64_t last_heartbeat_ms = 0;

    ESP_LOGI(TAG, "Sender task started");

    while (1) {
        xSemaphoreTake(ring_mutex, portMAX_DELAY);
        while (ring_read != ring_write && sample_index < SAMPLES_PER_FRAME) {
            uint16_t slot = ring_read % SAMPLE_RING_SIZE;
            current_buf[sample_index] = sample_ring[slot].current_mv;
            voltage_buf[sample_index] = sample_ring[slot].voltage_mv;
            now = sample_ring[slot].sampled_at;
            sample_index++;
            ring_read++;
        }
        xSemaphoreGive(ring_mutex);

        if (sample_index >= SAMPLES_PER_FRAME) {
            buffer_push(current_buf, voltage_buf);
            sample_index = 0;

            if (modem_sleeping) {
                int64_t now_ms = esp_timer_get_time() / 1000;

                if ((now_ms - last_heartbeat_ms) >= 5000) {
                    esp_wifi_set_ps(WIFI_PS_NONE);          // wake radio
                    vTaskDelay(pdMS_TO_TICKS(10));          // brief settle time

                    adc_packet_t hb = {
                        .msg_type    = MSG_DATA,
                        .frame_count = 0
                    };

                    esp_now_send(controller_mac, (uint8_t *)&hb, sizeof(hb));
                    ESP_LOGI(TAG, "Heartbeat sent");

                    last_heartbeat_ms = now_ms;

                    vTaskDelay(pdMS_TO_TICKS(20));          // let TX complete
                    esp_wifi_set_ps(WIFI_PS_MIN_MODEM);     // radio back to sleep
                }

            } else if (waiting_ack && (now - last_send_time > ACK_TIMEOUT_MS)) {
                waiting_ack = false;
                consecutive_timeouts++;

                if (consecutive_timeouts >= DISCONNECT_THRESHOLD && !is_disconnected) {
                    is_disconnected        = true;
                    registered             = false;
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

            if (!waiting_ack && registered) {
                adc_packet_t pkt;
                memset(&pkt, 0, sizeof(pkt));
                uint8_t count = build_packet(&pkt);
                if (count > 0) {
                    if (pkt.frames[0].tx_epoch_us != 0) {
                        char ts[32];
                        compute_frame_timestamp(pkt.frames[0].tx_epoch_us, ts, sizeof(ts));
                        ESP_LOGI(TAG, "Sent %d frame(s), counter %d~%d, first ts: %s",
                                 count,
                                 pkt.frames[0].counter,
                                 pkt.frames[count - 1].counter,
                                 ts);
                    }
                    esp_now_send(controller_mac, (uint8_t *)&pkt,
                                 2 + count * sizeof(adc_frame_t));
                    waiting_ack    = true;
                    last_send_time = now;
                }
            }
        }

        vTaskDelay(pdMS_TO_TICKS(1));
    }
}

/*---------------------------------------------------------------
    Buffer monitor task
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

            uint16_t first_counter   = confirmed_floor + 1;
            uint16_t last_counter    = next_counter - 1;
            uint16_t buffered_frames = next_counter - confirmed_floor - 1;

            buffered_frame_t *first_f =
                &send_buffer[first_counter % SENDER_BUFFER_SIZE];
            buffered_frame_t *last_f =
                &send_buffer[last_counter % SENDER_BUFFER_SIZE];

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
                if (buffered_frames >= 2950)
                    ESP_LOGI(TAG, "✅ Buffer test PASSED");
                else
                    ESP_LOGE(TAG, "❌ Buffer test FAILED, lost %d frames",
                             3000 - buffered_frames);
            }
            ESP_LOGW(TAG, "─────────────────────────────");
        }
    }
}

/*---------------------------------------------------------------
    App Main
---------------------------------------------------------------*/

void app_main(void) {
    setenv("TZ", "UTC0", 1);
    tzset();

    ESP_LOGI(TAG, "Free heap: %lu bytes", esp_get_free_heap_size());

    wifi_init();    // initialises NVS via nvs_flash_init()
    adc_init();
    buzzer_init();
    flash_init();   // mount SPIFFS and restore buffered frames from previous session

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }
    ring_mutex  = xSemaphoreCreateMutex();
    flash_mutex = xSemaphoreCreateMutex();
    esp_now_register_send_cb(on_data_sent);
    esp_now_register_recv_cb(on_data_recv);

    xTaskCreate(buffer_monitor_task, "buf_monitor", 2048, NULL, 2, NULL);

    ESP_LOGI(TAG, "Sender ready, waiting for HELLO from controller...");
}
