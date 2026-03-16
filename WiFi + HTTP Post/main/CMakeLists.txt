idf_component_register(SRCS "wifi_http_post.c"
                    INCLUDE_DIRS "."
                    PRIV_REQUIRES
                        esp_timer
                        esp_wifi 
                        esp_netif 
                        esp_http_client 
                        nvs_flash
                        esp_event)