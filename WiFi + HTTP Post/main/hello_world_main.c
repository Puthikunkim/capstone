#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
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
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

#define WIFI_SSID            "JOES_LAPTOP" //Whatever you set your hotspot name to
#define WIFI_PASSWORD        "password" //Same for this with password
#define SERVER_URL_BASE      "http://172.23.178.242:8000" //URL of server packets are posted to

#define ECU_SERIAL_NUMBER    1
#define SAMPLE_RATE          100 //Hz
#define BATCH_SIZE           10 //Number of values in POST packet
#define SAMPLE_PERIOD        (1000000 / SAMPLE_RATE) //Microseconds
#define QUEUE_DEPTH          (BATCH_SIZE * 10) //Queue can hold 10 batches of samples if posting is slow

#define WIFI_CONNECTED_BIT BIT0

#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7

static const char *TAG = "ESP32";
static EventGroupHandle_t wifi_event_group;
static QueueHandle_t sample_queue;
static esp_http_client_handle_t http_client = NULL;

typedef struct {
    int64_t time_since_boot;
    int     voltage;
    int     current;
} sample_t;

adc_channel_t channels[2] = {
    ADC_CURRENT_CHANNEL,
    ADC_VOLTAGE_CHANNEL
};

adc_oneshot_unit_handle_t adc1_handle;

static int adc_raw[2];
static int voltage[2];

adc_cali_handle_t adc1_cali_chan0_handle = NULL;
adc_cali_handle_t adc1_cali_chan1_handle = NULL;

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

void adc_init(void)
{

    adc_oneshot_unit_init_cfg_t unit_config = {
        .unit_id = ADC_UNIT_1
    };

    ESP_ERROR_CHECK(adc_oneshot_new_unit(&unit_config, &adc1_handle));

    adc_oneshot_chan_cfg_t channel_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12
    };

    for (int i = 0; i < 2; i++) {
        ESP_ERROR_CHECK(
            adc_oneshot_config_channel(
                adc1_handle,
                channels[i],
                &channel_config
            )
        );
    }

    /* Calibration */

    adc_calibration_init(
        ADC_UNIT_1,
        channels[0],
        ADC_ATTEN_DB_12,
        &adc1_cali_chan0_handle
    );

    adc_calibration_init(
        ADC_UNIT_1,
        channels[1],
        ADC_ATTEN_DB_12,
        &adc1_cali_chan1_handle
    );
}

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
    //ESP_LOGI(TAG, "HTTP POST triggered");
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


/*static int sample_voltage(void)
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
}*/

static void sampling_timer_callback(void *arg)
{
    //ESP_LOGI(TAG, "callback triggered");
    ESP_ERROR_CHECK(
            adc_oneshot_read(
                adc1_handle,
                channels[0],
                &adc_raw[0]
            )
        );
    adc_cali_raw_to_voltage(
            adc1_cali_chan0_handle,
            adc_raw[0],
            &voltage[0]
        );


        /* Read Voltage Channel */

    ESP_ERROR_CHECK(
        adc_oneshot_read(
            adc1_handle,
            channels[1],
            &adc_raw[1]
        )
    );

    adc_cali_raw_to_voltage(
        adc1_cali_chan1_handle,
        adc_raw[1],
        &voltage[1]
    );

    sample_t s = {
        .time_since_boot = esp_timer_get_time(),
        .voltage = voltage[1],
        .current = voltage[0],
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

    adc_init();

    ESP_LOGI(TAG, "ADC Started");

    esp_timer_create(&timer_args, &sample_timer);
    esp_timer_start_periodic(sample_timer, SAMPLE_PERIOD);

    ESP_LOGI(TAG, "Sampling started at %d Hz", SAMPLE_RATE);
}