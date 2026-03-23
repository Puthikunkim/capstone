idf_component_register(SRCS "hello_world_main.c"
                    INCLUDE_DIRS "."
                    PRIV_REQUIRES
                        esp_timer
                        esp_wifi 
                        esp_netif 
                        esp_http_client 
                        nvs_flash
                        esp_event
                        esp_adc)