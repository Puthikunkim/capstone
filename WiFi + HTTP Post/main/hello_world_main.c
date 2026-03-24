#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/queue.h"
#include "freertos/event_groups.h"
#include "esp_wifi.h"
#include "esp_netif.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "nvs_flash.h"
#include "esp_http_client.h"
#include "esp_sntp.h"

#include "esp_adc/adc_oneshot.h"

#define WIFI_SSID            "JOES_LAPTOP"
#define WIFI_PASSWORD        "password"
#define SERVER_URL_BASE      "http://172.23.178.242:8000"

#define ECU_SERIAL_NUMBER    1
#define SAMPLE_RATE          100 // Hz
#define BATCH_SIZE           10  // Number of samples per POST
#define SAMPLE_PERIOD        (1000000 / SAMPLE_RATE) // Microseconds
#define QUEUE_DEPTH          (BATCH_SIZE * 10)

// Hardware scaling constants — tune for your sensing circuit.
// The ESP32 ADC measures 0–3.3 V over counts 0–4095 with DB_12 attenuation.
// VOLTAGE_FULL_SCALE_V: actual line voltage (V) when ADC reads 4095.
// CURRENT_FULL_SCALE_A: actual current (A) when ADC reads 4095.
#define VOLTAGE_FULL_SCALE_V    3.3f
#define CURRENT_FULL_SCALE_A    3.3f
#define ADC_MAX_COUNT           4095.0f
// Frame duration in hours: BATCH_SIZE samples at SAMPLE_RATE Hz
#define FRAME_DURATION_HOURS    ((float)BATCH_SIZE / (float)SAMPLE_RATE / 3600.0f)

#define WIFI_CONNECTED_BIT BIT0

#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7

static const char *TAG = "ESP32";
static EventGroupHandle_t wifi_event_group;
static QueueHandle_t sample_queue;
static esp_http_client_handle_t http_client = NULL;

// NTP time anchor — set once when SNTP syncs
static volatile time_t  ntp_wall_sec = 0;
static volatile int64_t ntp_boot_us  = 0;

typedef struct {
    int64_t time_since_boot;
    int     voltage_raw;   // raw 12-bit ADC (0-4095)
    int     current_raw;   // raw 12-bit ADC (0-4095)
} sample_t;

adc_channel_t channels[2] = {
    ADC_CURRENT_CHANNEL,
    ADC_VOLTAGE_CHANNEL
};

adc_oneshot_unit_handle_t adc1_handle;
static int adc_raw[2];

// ----- NTP -----

static void sntp_sync_cb(struct timeval *tv)
{
    ntp_wall_sec = tv->tv_sec;
    ntp_boot_us  = esp_timer_get_time();
    ESP_LOGI(TAG, "SNTP synced, wall_sec=%lld", (long long)ntp_wall_sec);
}

static void sntp_init_and_wait(void)
{
    esp_sntp_setoperatingmode(SNTP_OPMODE_POLL);
    esp_sntp_setservername(0, "pool.ntp.org");
    sntp_set_time_sync_notification_cb(sntp_sync_cb);
    esp_sntp_init();
    ESP_LOGI(TAG, "Waiting for NTP sync...");
    while (ntp_wall_sec == 0)
        vTaskDelay(pdMS_TO_TICKS(100));
    ESP_LOGI(TAG, "NTP synced");
}

// ----- ADC -----

void adc_init(void)
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
        ESP_ERROR_CHECK(
            adc_oneshot_config_channel(adc1_handle, channels[i], &channel_config)
        );
    }
}

// ----- WiFi -----

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        ESP_LOGI(TAG, "Disconnected, retrying");
        esp_wifi_connect();
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *) event_data;
        ESP_LOGI(TAG, "Connected to IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

void wifi_init(void)
{
    wifi_event_group = xEventGroupCreate();
    esp_netif_init();
    esp_event_loop_create_default();
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    esp_wifi_init(&cfg);

    esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, &wifi_event_handler, NULL);
    esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, &wifi_event_handler, NULL);

    wifi_config_t wifi_config = { 0 };
    memcpy(wifi_config.sta.ssid, WIFI_SSID, strlen(WIFI_SSID));
    memcpy(wifi_config.sta.password, WIFI_PASSWORD, strlen(WIFI_PASSWORD));
    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;

    esp_wifi_set_mode(WIFI_MODE_STA);
    esp_wifi_set_config(WIFI_IF_STA, &wifi_config);
    esp_wifi_start();

    ESP_LOGI(TAG, "Connecting to %s", WIFI_SSID);
    xEventGroupWaitBits(wifi_event_group, WIFI_CONNECTED_BIT, false, true, portMAX_DELAY);
    esp_wifi_set_ps(WIFI_PS_NONE);
}

// ----- HTTP -----

static void http_client_init(void)
{
    esp_http_client_config_t config = {
        .url               = SERVER_URL_BASE "/data",
        .timeout_ms        = 2000,
        .keep_alive_enable = true,
        .buffer_size       = 512,
        .buffer_size_tx    = 1024,
    };
    http_client = esp_http_client_init(&config);
}

static void http_post(const char *url, const char *body)
{
    esp_http_client_set_url(http_client, url);
    esp_http_client_set_method(http_client, HTTP_METHOD_POST);
    esp_http_client_set_header(http_client, "Content-Type", "application/json");
    esp_http_client_set_post_field(http_client, body, strlen(body));

    ESP_LOGI(TAG, "POST begin");
    esp_err_t err = esp_http_client_perform(http_client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "POST Ok -> %s", url);
    } else {
        ESP_LOGE(TAG, "POST Failed: %s", esp_err_to_name(err));
    }
}

// ----- Sampling timer (ISR context) -----

static void sampling_timer_callback(void *arg)
{
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, channels[0], &adc_raw[0]));
    ESP_ERROR_CHECK(adc_oneshot_read(adc1_handle, channels[1], &adc_raw[1]));

    sample_t s = {
        .time_since_boot = esp_timer_get_time(),
        .voltage_raw     = adc_raw[1],  // channel 7
        .current_raw     = adc_raw[0],  // channel 6
    };

    BaseType_t higher_priority_task_woken = pdFALSE;
    xQueueSendFromISR(sample_queue, &s, &higher_priority_task_woken);
    if (higher_priority_task_woken)
        portYIELD_FROM_ISR();
}

// ----- POST task -----

static void post_task(void *arg)
{
    sample_t batch[BATCH_SIZE];
    char body[512];

    while (1) {
        for (int i = 0; i < BATCH_SIZE; i++)
            xQueueReceive(sample_queue, &batch[i], portMAX_DELAY);

        UBaseType_t waiting = uxQueueMessagesWaiting(sample_queue);
        ESP_LOGW(TAG, "Queue depth after receive: %d", (int)waiting);

        // Convert the first sample's boot-relative time to an ISO 8601 UTC timestamp
        int64_t offset_us = batch[0].time_since_boot - ntp_boot_us;
        time_t  wall_sec  = ntp_wall_sec + (time_t)(offset_us / 1000000LL);
        int32_t wall_us   = (int32_t)(offset_us % 1000000LL);
        if (wall_us < 0) { wall_sec--; wall_us += 1000000; }

        struct tm tm_info;
        gmtime_r(&wall_sec, &tm_info);

        char ts_buf[32];
        snprintf(ts_buf, sizeof(ts_buf), "%04d-%02d-%02dT%02d:%02d:%02d.%06dZ",
                 tm_info.tm_year + 1900, tm_info.tm_mon + 1, tm_info.tm_mday,
                 tm_info.tm_hour, tm_info.tm_min, tm_info.tm_sec, (int)wall_us);

        // Energy = avg_power * frame_duration
        // Convert raw ADC counts to physical units using the hardware scale constants
        float sum_v = 0.0f, sum_i = 0.0f;
        for (int i = 0; i < BATCH_SIZE; i++) {
            sum_v += batch[i].voltage_raw;
            sum_i += batch[i].current_raw;
        }
        float voltage_v = (sum_v / BATCH_SIZE) * (VOLTAGE_FULL_SCALE_V / ADC_MAX_COUNT);
        float current_a = (sum_i / BATCH_SIZE) * (CURRENT_FULL_SCALE_A / ADC_MAX_COUNT);
        float energy_wh = voltage_v * current_a * FRAME_DURATION_HOURS;

        // Build JSON body matching EnergyFrameIngest
        int pos = 0;
        pos += snprintf(body + pos, sizeof(body) - pos,
                        "{\"ecu_serial\":%d"
                        ",\"timestamp\":\"%s\""
                        ",\"voltage_samples\":[",
                        ECU_SERIAL_NUMBER, ts_buf);

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos,
                            "%d%s", batch[i].voltage_raw, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "],\"current_samples\":[");

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos,
                            "%d%s", batch[i].current_raw, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "],\"energy\":%.6f}", energy_wh);

        http_post(SERVER_URL_BASE "/data", body);
    }
}

// ----- Entry point -----

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES ||
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        nvs_flash_erase();
        nvs_flash_init();
    }

    sample_queue = xQueueCreate(QUEUE_DEPTH, sizeof(sample_t));

    wifi_init();
    sntp_init_and_wait();   // get real wall time before sampling starts
    http_client_init();

    xTaskCreate(post_task, "post_task", 8192, NULL, 10, NULL);

    adc_init();
    ESP_LOGI(TAG, "ADC Started");

    esp_timer_handle_t sample_timer;
    esp_timer_create_args_t timer_args = {
        .callback        = sampling_timer_callback,
        .arg             = NULL,
        .dispatch_method = ESP_TIMER_TASK,
        .name            = "sample_timer",
    };
    esp_timer_create(&timer_args, &sample_timer);
    esp_timer_start_periodic(sample_timer, SAMPLE_PERIOD);

    ESP_LOGI(TAG, "Sampling started at %d Hz", SAMPLE_RATE);
}
