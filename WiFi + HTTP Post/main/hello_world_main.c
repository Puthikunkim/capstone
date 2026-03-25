    #include <string.h>
#include <stdio.h>
#include <stdlib.h>
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

#include "esp_adc/adc_oneshot.h"

#define WIFI_SSID            "2degrees Broadband - 766C"
#define WIFI_PASSWORD        "Kumar1970"
#define SERVER_URL_BASE      "http://192.168.178.168:8000"

#define ECU_SERIAL_NUMBER    1
#define SAMPLE_RATE          100
#define BATCH_SIZE           10
#define SAMPLE_PERIOD        (1000000 / SAMPLE_RATE) // microseconds
#define QUEUE_DEPTH          (BATCH_SIZE * 10)

#define WIFI_CONNECTED_BIT BIT0

#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7

static const char *TAG = "ESP32";
static EventGroupHandle_t wifi_event_group;
static QueueHandle_t sample_queue;
static esp_http_client_handle_t http_client = NULL;

// Time sync anchor — set once on connection via GET /api/time
static char     sync_timestamp[64] = {0};  // ISO string from server
static int64_t  sync_boot_us       = 0;    // esp_timer value at sync moment

typedef struct {
    int64_t time_since_boot;
    int     voltage_raw;
    int     current_raw;
} sample_t;

adc_channel_t channels[2] = {
    ADC_CURRENT_CHANNEL,
    ADC_VOLTAGE_CHANNEL
};

adc_oneshot_unit_handle_t adc1_handle;
static int adc_raw[2];

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
        ESP_LOGI(TAG, "Connected, IP: " IPSTR, IP2STR(&event->ip_info.ip));
        xEventGroupSetBits(wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

static void wifi_init(void)
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

// ----- Time sync -----

static char time_response_buf[256];

static esp_err_t time_sync_http_event_handler(esp_http_client_event_t *evt)
{
    if (evt->event_id == HTTP_EVENT_ON_DATA) {
        int copy_len = evt->data_len < (int)sizeof(time_response_buf) - 1
                       ? evt->data_len
                       : (int)sizeof(time_response_buf) - 1;
        memcpy(time_response_buf, evt->data, copy_len);
        time_response_buf[copy_len] = '\0';
    }
    return ESP_OK;
}

static void fetch_time_sync(void)
{
    memset(time_response_buf, 0, sizeof(time_response_buf));

    esp_http_client_config_t config = {
        .url            = SERVER_URL_BASE "/api/time",
        .method         = HTTP_METHOD_GET,
        .timeout_ms     = 2000,
        .event_handler  = time_sync_http_event_handler,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_err_t err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK) {
        ESP_LOGE(TAG, "Time sync GET failed: %s", esp_err_to_name(err));
        return;
    }

    // Parse {"timestamp": "2026-03-25T12:00:00.000000"}
    // Simple substring extract — no need for a full JSON parser
    char *start = strstr(time_response_buf, "\"timestamp\"");
    if (start) {
        start = strchr(start, ':');          // point to ':'
        if (start) {
            start++;
            while (*start == ' ' || *start == '"') start++;  // skip whitespace and opening quote
            char *end = strchr(start, '"');
            if (end) {
                size_t len = end - start;
                if (len < sizeof(sync_timestamp)) {
                    strncpy(sync_timestamp, start, len);
                    sync_timestamp[len] = '\0';
                }
            }
        }
    }

    sync_boot_us = esp_timer_get_time();
    ESP_LOGI(TAG, "Synced to server time: %s", sync_timestamp);
}

// ----- ADC -----

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
        ESP_ERROR_CHECK(
            adc_oneshot_config_channel(adc1_handle, channels[i], &channel_config)
        );
    }
}

// ----- HTTP -----

static void http_client_init(void)
{
    esp_http_client_config_t config = {
        .url               = SERVER_URL_BASE "/api/data",
        .timeout_ms        = 2000,
        .keep_alive_enable = true,
        .buffer_size       = 512,
        .buffer_size_tx    = 1024,
    };
    http_client = esp_http_client_init(&config);
}

static void http_post(const char *body)
{
    esp_http_client_set_url(http_client, SERVER_URL_BASE "/api/data");
    esp_http_client_set_method(http_client, HTTP_METHOD_POST);
    esp_http_client_set_header(http_client, "Content-Type", "application/json");
    esp_http_client_set_post_field(http_client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(http_client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "POST ok, status=%d", esp_http_client_get_status_code(http_client));
    } else {
        ESP_LOGE(TAG, "POST failed: %s", esp_err_to_name(err));
    }
}

// ----- Sampling timer -----

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
        // Block until we have a full batch
        for (int i = 0; i < BATCH_SIZE; i++)
            xQueueReceive(sample_queue, &batch[i], portMAX_DELAY);

        // Compute timestamp for first sample using offset from sync point
        // mirrors the Python sim's elapsed = time.monotonic() - sync_monotonic
        int64_t elapsed_us  = batch[0].time_since_boot - sync_boot_us;
        int64_t elapsed_ms  = elapsed_us / 1000LL;

        // Append elapsed ms to the synced ISO string
        // e.g. "2026-03-25T12:00:00.000000+1234ms"
        // Server can use this to reconstruct exact wall time if needed
        char ts_buf[96];
        snprintf(ts_buf, sizeof(ts_buf), "%s+%lldms", sync_timestamp, (long long)elapsed_ms);

        // Build JSON payload
        int pos = 0;
        pos += snprintf(body + pos, sizeof(body) - pos,
                        "{\"ecu_serial\":%d,\"timestamp\":\"%s\",\"voltage_samples\":[",
                        ECU_SERIAL_NUMBER, ts_buf);

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos,
                            "%d%s", batch[i].voltage_raw, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "],\"current_samples\":[");

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos,
                            "%d%s", batch[i].current_raw, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "]}");

        http_post(body);
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
    fetch_time_sync();   // GET /api/time once on connection
    http_client_init();

    xTaskCreate(post_task, "post_task", 8192, NULL, 10, NULL);

    adc_init();
    ESP_LOGI(TAG, "ADC started at %d Hz", SAMPLE_RATE);

    esp_timer_handle_t sample_timer;
    esp_timer_create_args_t timer_args = {
        .callback        = sampling_timer_callback,
        .arg             = NULL,
        .dispatch_method = ESP_TIMER_TASK,
        .name            = "sample_timer",
    };
    esp_timer_create(&timer_args, &sample_timer);
    esp_timer_start_periodic(sample_timer, SAMPLE_PERIOD);
}