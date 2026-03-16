#include <stdio.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

#include "esp_log.h"

#include "esp_adc/adc_oneshot.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"

static const char *TAG = "ADC_EXAMPLE";

/*---------------------------------------------------------------
                        ADC CONFIG
---------------------------------------------------------------*/

#define ADC_CURRENT_CHANNEL   ADC_CHANNEL_6
#define ADC_VOLTAGE_CHANNEL   ADC_CHANNEL_7

adc_channel_t channels[2] = {
    ADC_CURRENT_CHANNEL,
    ADC_VOLTAGE_CHANNEL
};

adc_oneshot_unit_handle_t adc1_handle;

static int adc_raw[2];
static int voltage[2];

adc_cali_handle_t adc1_cali_chan0_handle = NULL;
adc_cali_handle_t adc1_cali_chan1_handle = NULL;

/*---------------------------------------------------------------
                        ADC CALIBRATION
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

/*---------------------------------------------------------------
                        ADC INIT
---------------------------------------------------------------*/

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

/*---------------------------------------------------------------
                        MAIN
---------------------------------------------------------------*/

void app_main(void)
{

    adc_init();

    ESP_LOGI(TAG, "ADC Started");

    while (1) {

        /* Read Current Channel */

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


        /* Print Result */

        printf("Current: RAW=%d  Voltage=%d mV\n",
               adc_raw[0], voltage[0]);

        printf("Voltage: RAW=%d  Voltage=%d mV\n",
               adc_raw[1], voltage[1]);

        printf("\n");


        /* 100 Hz sampling */

        vTaskDelay(pdMS_TO_TICKS(10));
    }
}