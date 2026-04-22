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
#define MY_SENDER_ID  2   
static uint8_t receiver_mac[] = {0x20, 0xE7, 0xC8, 0xEC, 0xEC, 0x24};
// ====================

// ====== ADC config ======
#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7
#define ADC_SAMPLE_RATE_MS    10    // 100Hz
#define SAMPLES_PER_FRAME 10
#define GAIN 1

static adc_oneshot_unit_handle_t adc1_handle;
static adc_cali_handle_t adc1_cali_current_handle = NULL;
static adc_cali_handle_t adc1_cali_voltage_handle = NULL;
static adc_channel_t channels[2] = {ADC_CURRENT_CHANNEL, ADC_VOLTAGE_CHANNEL};

static bool task_started = false; 
void sender_task(void *arg);

typedef struct {
    uint8_t  sender_id;           
    uint32_t counter;             
    int      current_ma[SAMPLES_PER_FRAME];  
    int      voltage_mv[SAMPLES_PER_FRAME];  
} __attribute__((packed)) adc_frame_t;

typedef struct {
    uint8_t  ack_to;
    uint32_t ack_counter;
    uint8_t  success;
} __attribute__((packed)) ack_packet_t;


static uint32_t packet_counter   = 0;
static volatile bool waiting_ack = false;
static volatile int64_t last_send_time = 0;

#define ACK_TIMEOUT_MS  500
#define SEND_INTERVAL_MS ADC_SAMPLE_RATE_MS

/*---------------------------------------------------------------
                        ADC INIT
---------------------------------------------------------------*/
static bool adc_calibration_init(adc_unit_t unit,
                                 adc_channel_t channel,
                                 adc_atten_t atten,
                                 adc_cali_handle_t *out_handle)
{
    adc_cali_handle_t handle = NULL;
    esp_err_t ret = ESP_FAIL;
    bool calibrated = false;

#if ADC_CALI_SCHEME_CURVE_FITTING_SUPPORTED
    adc_cali_curve_fitting_config_t cali_config = {
        .unit_id = unit,
        .chan = channel,
        .atten = atten,
        .bitwidth = ADC_BITWIDTH_DEFAULT,
    };

    ret = adc_cali_create_scheme_curve_fitting(&cali_config, &handle);

    if (ret == ESP_OK) {
        calibrated = true;
    }
#endif

#if ADC_CALI_SCHEME_LINE_FITTING_SUPPORTED
    if (!calibrated) {

        adc_cali_line_fitting_config_t cali_config = {
            .unit_id = unit,
            .atten = atten,
            .bitwidth = ADC_BITWIDTH_DEFAULT,
        };

        ret = adc_cali_create_scheme_line_fitting(&cali_config, &handle);

        if (ret == ESP_OK) {
            calibrated = true;
        }
    }
#endif

    *out_handle = handle;

    if (calibrated) {
        ESP_LOGI(TAG, "ADC Calibration Success");
    } else {
        ESP_LOGW(TAG, "ADC Calibration not supported");
    }

    return calibrated;
}


static void adc_init(void)
{
    adc_oneshot_unit_init_cfg_t unit_config = {
        .unit_id = ADC_UNIT_1
    };
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_config, &adc1_handle));

    adc_oneshot_chan_cfg_t channel_config = {
        .atten    = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12
    };
    for (int i = 0; i < 2; i++) {
        ESP_ERROR_CHECK(adc_oneshot_config_channel(
            adc1_handle, channels[i], &channel_config));
    }

    adc_calibration_init(ADC_UNIT_1, channels[0],
                         ADC_ATTEN_DB_12, &adc1_cali_current_handle);
    adc_calibration_init(ADC_UNIT_1, channels[1],
                         ADC_ATTEN_DB_12, &adc1_cali_voltage_handle);

    ESP_LOGI(TAG, "ADC Init Done");
}

/*---------------------------------------------------------------
                        ESP-NOW callback
---------------------------------------------------------------*/

static void on_data_sent(const uint8_t *mac, esp_now_send_status_t status) {
    if (status != ESP_NOW_SEND_SUCCESS) {
        ESP_LOGW(TAG, "[TX] Packet #%lu FAILED", (unsigned long)(packet_counter - 1));
        waiting_ack = false;
    }
}

static void on_data_recv(const esp_now_recv_info_t *info,
                         const uint8_t *data, int len) {
    // Recieve READY signal from controller
    if (len == 1 && data[0] == 0xAA) {
        if (!task_started) {          
            task_started = true;
            ESP_LOGI(TAG, "Controller ready, starting sender task");
            xTaskCreate(sender_task, "sender_task", 4096, NULL, 5, NULL);
        }
        return;
    }

    // ACK signal 
    if (len != sizeof(ack_packet_t)) return;
    const ack_packet_t *ack = (const ack_packet_t *)data;
    if (ack->ack_to == MY_SENDER_ID) {
        ESP_LOGI(TAG, "[ACK] counter=%lu success=%d",
                 (unsigned long)ack->ack_counter, ack->success);
        waiting_ack = false;
    }
}

/*---------------------------------------------------------------
                        WIFI INIT
---------------------------------------------------------------*/

static void wifi_init(void) {
    nvs_flash_init();
    esp_netif_init();
    esp_event_loop_create_default();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);
    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_start();

    uint8_t mac[6];
    esp_wifi_get_mac(WIFI_IF_STA, mac);
    ESP_LOGI(TAG, "My MAC: %02X:%02X:%02X:%02X:%02X:%02X",
             mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
}

/*---------------------------------------------------------------
                        SENDER TASK
---------------------------------------------------------------*/

void sender_task(void *arg) {
    int     current_ma_buf[SAMPLES_PER_FRAME];
    int     voltage_mv_buf[SAMPLES_PER_FRAME];
    int     sample_index  = 0;
    int64_t last_sample_time = 0;

    while (1) {
        int64_t now = esp_timer_get_time() / 1000;

        // 100Hz sampling rate
        if (now - last_sample_time >= 10) {
            last_sample_time = now;

            int raw_c, raw_v, mv_c, mv_v;

            ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, ADC_CURRENT_CHANNEL, &raw_c));
            adc_cali_raw_to_voltage(adc1_cali_current_handle, raw_c, &mv_c);

            ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, ADC_VOLTAGE_CHANNEL, &raw_v));
            adc_cali_raw_to_voltage(adc1_cali_voltage_handle, raw_v, &mv_v);

            current_ma_buf[sample_index] = mv_c * GAIN;
            voltage_mv_buf[sample_index] = mv_v;
            sample_index++;
        }

        // Get 10 values -> Send
        if (sample_index >= SAMPLES_PER_FRAME) {
            if (waiting_ack) {
                if (esp_timer_get_time() / 1000 - last_send_time > ACK_TIMEOUT_MS) {
                    ESP_LOGW(TAG, "[TIMEOUT] frame #%lu", (unsigned long)(packet_counter - 1));
                    waiting_ack = false;
                }
                vTaskDelay(pdMS_TO_TICKS(1));
                continue;
            }

            adc_frame_t frame = {
                .sender_id = MY_SENDER_ID,
                .counter   = packet_counter++,
            };
            memcpy(frame.current_ma, current_ma_buf, sizeof(current_ma_buf));
            memcpy(frame.voltage_mv, voltage_mv_buf, sizeof(voltage_mv_buf));

            esp_now_send(receiver_mac, (uint8_t *)&frame, sizeof(frame));
            waiting_ack    = true;
            last_send_time = esp_timer_get_time() / 1000;
            sample_index   = 0;
        }

        vTaskDelay(pdMS_TO_TICKS(1));
    }
}
/*---------------------------------------------------------------
                        APP MAIN
---------------------------------------------------------------*/

void app_main(void) {
    wifi_init();
    adc_init();

    if (esp_now_init() != ESP_OK) {
        ESP_LOGE(TAG, "ESP-NOW init failed");
        return;
    }

    esp_now_register_send_cb(on_data_sent);
    esp_now_register_recv_cb(on_data_recv);

    esp_now_peer_info_t peer = {};
    memcpy(peer.peer_addr, receiver_mac, 6);
    peer.channel = 0;
    peer.encrypt = false;
    esp_now_add_peer(&peer);

    ESP_LOGI(TAG, "[SENDER %d] Ready", MY_SENDER_ID);
}