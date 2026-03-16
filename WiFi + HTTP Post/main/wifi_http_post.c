#include <string.h>
#include <stdio.h>
#include <stdlib.h>
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

#define WIFI_SSID            "BAILEYS-PC" //Whatever you set your hotspot name to
#define WIFI_PASSWORD        "password" //Same for this with password
#define SERVER_URL_BASE      "http://192.168.137.1:8000" //URL of server packets are posted to

#define ECU_SERIAL_NUMBER    1
#define SAMPLE_RATE          100 //Hz
#define BATCH_SIZE           10 //Number of values in POST packet
#define SAMPLE_PERIOD        (1000000 / SAMPLE_RATE) //Microseconds
#define QUEUE_DEPTH          (BATCH_SIZE * 10) //Queue can hold 10 batches of samples if posting is slow

#define WIFI_CONNECTED_BIT BIT0

static const char *TAG = "ESP32";
static EventGroupHandle_t wifi_event_group;
static QueueHandle_t sample_queue;
static esp_http_client_handle_t http_client = NULL;

typedef struct {
    int64_t time_since_boot;
    int     voltage;
    int     current;
} sample_t;

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

static void send_connect(void)
{
    char body[64];
    snprintf(body, sizeof(body), "{\"ecu_serial_number\":%d,\"time_since_boot\":%lld}", ECU_SERIAL_NUMBER, (long long)esp_timer_get_time());

    esp_http_client_config_t config = {
        .url        = SERVER_URL_BASE "/connect",
        .timeout_ms = 2000,
    };
    esp_http_client_handle_t connect_client = esp_http_client_init(&config);
    esp_http_client_set_method(connect_client, HTTP_METHOD_POST);
    esp_http_client_set_header(http_client, "Connection", "keep-alive");
    esp_http_client_set_header(connect_client, "Content-Type", "application/json");
    esp_http_client_set_post_field(connect_client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(connect_client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "Connect ping sent");
    } else {
        ESP_LOGE(TAG, "Connect ping failed: %s", esp_err_to_name(err));
    }
    esp_http_client_cleanup(connect_client);
}

static void http_post(const char *url, const char *body)
{
    esp_http_client_set_url(http_client, url);
    esp_http_client_set_method(http_client, HTTP_METHOD_POST);
    esp_http_client_set_header(http_client, "Content-Type", "application/json");
    esp_http_client_set_post_field(http_client, body, strlen(body));

    esp_err_t err = esp_http_client_perform(http_client);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "POST Ok -> %s", url);
    } else {
        ESP_LOGE(TAG, "POST Failed: %s", esp_err_to_name(err));
    }
}


static int sample_voltage(void)
{
    // static int v = 2900;
    // v += (rand() % 11) - 5;
    // if (v < 2800) v = 2800;
    // if (v > 3000) v = 3000;
    // return v;

    static int v = 0;
    int val = v;
    v = (v + 1) % 10;
    return val;
}

static int sample_current(void)
{
    // static int c = 2100;
    // c += (rand() % 7) - 3;
    // if (c < 2000) c = 2000;
    // if (c > 2200) c = 2200;
    // return c;

    static int c = 0;
    int val = c;
    c = (c + 1) % 10;
    return val;
}

static void sampling_timer_callback(void *arg)
{
    sample_t s = {
        .time_since_boot = esp_timer_get_time(),
        .voltage = sample_voltage(),
        .current = sample_current(),
    };
    BaseType_t higher_priority_task_woken = pdFALSE;
    xQueueSendFromISR(sample_queue, &s, &higher_priority_task_woken);
    if (higher_priority_task_woken)
        portYIELD_FROM_ISR();
}

static void post_task(void *arg)
{
    sample_t batch[BATCH_SIZE];
    char body[256 + BATCH_SIZE * 14];

    while (1) {
        for (int i = 0; i < BATCH_SIZE; i++)
            xQueueReceive(sample_queue, &batch[i], portMAX_DELAY);

        UBaseType_t waiting = uxQueueMessagesWaiting(sample_queue);
        ESP_LOGW(TAG, "Queue depth after receive: %d", (int)waiting);

        int64_t first_time_since_boot = batch[0].time_since_boot;
        int pos = 0;

        pos += snprintf(body + pos, sizeof(body) - pos,
                        "{\"ecu_serial_number\":%d"
                        ",\"time_since_boot\":%lld"
                        ",\"sample_rate\":%d"
                        ",\"voltage\":[",
                        ECU_SERIAL_NUMBER,
                        (long long)first_time_since_boot,
                        SAMPLE_RATE);

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos, "%d%s", batch[i].voltage, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "],\"current\":[");

        for (int i = 0; i < BATCH_SIZE; i++)
            pos += snprintf(body + pos, sizeof(body) - pos, "%d%s", batch[i].current, i < BATCH_SIZE - 1 ? "," : "");

        pos += snprintf(body + pos, sizeof(body) - pos, "]}");

        http_post(SERVER_URL_BASE "/data", body);
    }
}

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
    http_client_init();
    send_connect();

    xTaskCreate(post_task, "post_task", 8192, NULL, 10, NULL);

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