import time
import math
import board
from adafruit_circuitplayground import cp

from adafruit_ble import BLERadio
from adafruit_ble_adafruit.accelerometer_service import AccelerometerService
from adafruit_ble_adafruit.adafruit_service import AdafruitServerAdvertisement

accel_svc = AccelerometerService()
accel_svc.measurement_period = 50
accel_last_update = 0

cp.pixels.brightness = 0.1
cp.pixels.auto_write = False
PIXEL_ANGLES = [270, 234, 198, 162, 126, 90, 54, 18, 342, 306]
color = (52, 61, 235)

ble = BLERadio()
ble.name = "CPlay1"
adv = AdafruitServerAdvertisement()
adv.pid = 0x8046

while True:
    ble.start_advertising(adv)
    while not ble.connected:
        pass
    ble.stop_advertising()

    while ble.connected:
        now_msecs = time.monotonic_ns() // 1000000

        x, y, z = cp.acceleration

        if now_msecs - accel_last_update >= accel_svc.measurement_period:
            accel_svc.acceleration = cp.acceleration
            accel_last_update = now_msecs

        gravity_angle = math.degrees(math.atan2(y, -x)) % 360
        best_pixel = min(range(10), key=lambda i: abs(
            (PIXEL_ANGLES[i] - gravity_angle + 180) % 360 - 180
        ))
        cp.pixels.fill((0, 0, 0))
        cp.pixels[best_pixel] = color
        cp.pixels.show()
