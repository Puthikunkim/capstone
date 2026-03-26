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

#define WIFI_SSID "enter_ssid_here"
#define WIFI_PASSWORD "enter_password_here"
#define SERVER_URL_BASE "https://<SERVER_IP>:8443"

#define ECU_SERIAL_NUMBER 1
#define SAMPLE_RATE 100
#define BATCH_SIZE 10
#define SAMPLE_PERIOD (1000000 / SAMPLE_RATE) // microseconds
#define QUEUE_DEPTH (BATCH_SIZE * 10)

#define WIFI_CONNECTED_BIT BIT0

#define ADC_CURRENT_CHANNEL ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL ADC_CHANNEL_7

static const char *TAG = "ESP32";
static const char *ca_cert = R"EOF(
-----BEGIN CERTIFICATE-----
MIIDFTCCAf2gAwIBAgIUZAcNdCitZV5/kCAkaIbOUjhCnugwDQYJKoZIhvcNAQEL
BQAwGjEYMBYGA1UEAwwPMTkyLjE2OC4xNzguMTY4MB4XDTI2MDMyNjA2NTEwMloX
DTI3MDMyNjA2NTEwMlowGjEYMBYGA1UEAwwPMTkyLjE2OC4xNzguMTY4MIIBIjAN
BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtY9c3uQtjomG2WqtGu56KFlqrib8
XKC9SMXFprspPVQj/YnbBfB+RW0BOJ608o8fYDDt7lzVAJbjFL8IrYnD9JTIh+UO
bZ5du1bcsbz+hRrlfiflMZNnoH+x3oM9oBqBxs+tXg+r4DFUXK5aiWsAXjmo4jSC
7Mdd4A10N1AFfDMyrebtYQtgssu7jEGGoh+pLL+nzi/k1/XUa9ehKmLMAQ+awMwM
rxeZIi5cea5i/ANuGl+bKq8Ocz5E/eipQUMXx1xp70CnCSt7ctmipGhC/SvipnEq
BHCe01GVgur7QZAKqx9hh62P5AMisNaAqpEBQdQDwg79ln5JNxiKTPhlPQIDAQAB
o1MwUTAdBgNVHQ4EFgQUsl5aCePxOjstkqJrd1ByF9VejCwwHwYDVR0jBBgwFoAU
sl5aCePxOjstkqJrd1ByF9VejCwwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0B
AQsFAAOCAQEACYbrJRKdVgKmZ3yYWdYDw1RGvD2e0JgEhGNjzPli7Ys3hilYUIUY
szF9wPqe6TXn6VQM5ELHAJbGg98+ssbWgYBJU6yiPFZ4J6EzV0rybKLkRl+PMM/+
/jIJpqcmKS54DYScw7dLMIL4qK+V7tAGC+ynJBAGhMOzpDMhfpti61axipbOfO6X
tnmwUD1ImsG0BIaFNhGZABK9L18mE0kj9wLN7oXOudxNgec1a9/9dXhmescgxZgY
HTbNVn4iq0M84zb95DK03pOLvuJc73S7UaxIzbG+a7jl74ZFHxXzENYq0Uq5fG/u
kcKE+qsj+lbWGNLMMpa1XS00HujJMwaAgQ==
-----END CERTIFICATE-----
)EOF";
static EventGroupHandle_t wifi_event_group;
static QueueHandle_t sample_queue;
static esp_http_client_handle_t http_client = NULL;

// Time sync anchor — set once on connection via GET /api/time
static char sync_timestamp[64] = {0}; // ISO string from server
static int64_t sync_boot_us = 0;      // esp_timer value at sync moment

typedef struct
{
    int64_t time_since_boot;
    int voltage_raw;
    int current_raw;
} sample_t;

adc_channel_t channels[2] = {
    ADC_CURRENT_CHANNEL,
    ADC_VOLTAGE_CHANNEL};

adc_oneshot_unit_handle_t adc1_handle;
static int adc_raw[2];

// ----- WiFi -----

static void wifi_event_handler(void *arg, esp_event_base_t event_base, int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START)
    {
        esp_wifi_connect();
    }
    else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED)
    {
        ESP_LOGI(TAG, "Disconnected, retrying");
        esp_wifi_connect();
    }
    else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP)
    {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *)event_data;
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

    wifi_config_t wifi_config = {0};
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
    if (evt->event_id == HTTP_EVENT_ON_DATA)
    {
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
        .url = SERVER_URL_BASE "/api/time",
        .method = HTTP_METHOD_GET,
        .timeout_ms = 2000,
        .event_handler = time_sync_http_event_handler,
        .cert_pem = ca_cert,
    };

    esp_http_client_handle_t client = esp_http_client_init(&config);
    esp_err_t err = esp_http_client_perform(client);
    esp_http_client_cleanup(client);

    if (err != ESP_OK)
    {
        ESP_LOGE(TAG, "Time sync GET failed: %s", esp_err_to_name(err));
        return;
    }

    // Parse {"timestamp": "2026-03-25T12:00:00.000000"}
    // Simple substring extract — no need for a full JSON parser
    char *start = strstr(time_response_buf, "\"timestamp\"");
    if (start)
    {
        start = strchr(start, ':'); // point to ':'
        if (start)
        {
            start++;
            while (*start == ' ' || *start == '"')
                start++; // skip whitespace and opening quote
            char *end = strchr(start, '"');
            if (end)
            {
                size_t len = end - start;
                if (len < sizeof(sync_timestamp))
                {
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
        .unit_id = ADC_UNIT_1};
    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_config, &adc1_handle));

    adc_oneshot_chan_cfg_t channel_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12};
    for (int i = 0; i < 2; i++)
    {
        ESP_ERROR_CHECK(
            adc_oneshot_config_channel(adc1_handle, channels[i], &channel_config));
    }
}

// ----- HTTP -----

static void http_client_init(void)
{
    esp_http_client_config_t config = {
        .url = SERVER_URL_BASE "/api/data",
        .timeout_ms = 2000,
        .keep_alive_enable = true,
        .buffer_size = 512,
        .buffer_size_tx = 1024,
        .cert_pem = ca_cert,
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
    if (err == ESP_OK)
    {
        ESP_LOGI(TAG, "POST ok, status=%d", esp_http_client_get_status_code(http_client));
    }
    else
    {
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
        .voltage_raw = adc_raw[1], // channel 7
        .current_raw = adc_raw[0], // channel 6
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

    while (1)
    {
        // Block until we have a full batch
        for (int i = 0; i < BATCH_SIZE; i++)
            xQueueReceive(sample_queue, &batch[i], portMAX_DELAY);

        // Compute timestamp for first sample using offset from sync point
        // mirrors the Python sim's elapsed = time.monotonic() - sync_monotonic
        int64_t elapsed_us = batch[0].time_since_boot - sync_boot_us;

        // parse sync_timestamp "2026-03-25T12:00:00.000000" into a struct tm
        struct tm tm_base = {0};
        // parse up to microseconds
        char base_no_us[32];
        int us = 0;
        char *dot = strchr(sync_timestamp, '.');
        if (dot)
        {
            strncpy(base_no_us, sync_timestamp, dot - sync_timestamp);
            base_no_us[dot - sync_timestamp] = '\0';
            us = atoi(dot + 1);
        }
        else
        {
            strncpy(base_no_us, sync_timestamp, sizeof(base_no_us));
        }
        strptime(base_no_us, "%Y-%m-%dT%H:%M:%S", &tm_base);
        time_t base_epoch = mktime(&tm_base);

        // add elapsed ms
        int64_t total_us = (int64_t)base_epoch * 1000000LL + us + elapsed_us;
        time_t final_epoch = total_us / 1000000LL;
        int final_us = total_us % 1000000LL;

        struct tm *final_tm = gmtime(&final_epoch);
        char ts_buf[96];
        snprintf(ts_buf, sizeof(ts_buf),
                 "%04d-%02d-%02dT%02d:%02d:%02d.%06d",
                 final_tm->tm_year + 1900, final_tm->tm_mon + 1, final_tm->tm_mday,
                 final_tm->tm_hour, final_tm->tm_min, final_tm->tm_sec, final_us);


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
        ret == ESP_ERR_NVS_NEW_VERSION_FOUND)
    {
        nvs_flash_erase();
        nvs_flash_init();
    }

    sample_queue = xQueueCreate(QUEUE_DEPTH, sizeof(sample_t));

    wifi_init();
    fetch_time_sync(); // GET /api/time once on connection
    http_client_init();

    xTaskCreate(post_task, "post_task", 8192, NULL, 10, NULL);

    adc_init();
    ESP_LOGI(TAG, "ADC started at %d Hz", SAMPLE_RATE);

    esp_timer_handle_t sample_timer;
    esp_timer_create_args_t timer_args = {
        .callback = sampling_timer_callback,
        .arg = NULL,
        .dispatch_method = ESP_TIMER_TASK,
        .name = "sample_timer",
    };
    esp_timer_create(&timer_args, &sample_timer);
    esp_timer_start_periodic(sample_timer, SAMPLE_PERIOD);
}