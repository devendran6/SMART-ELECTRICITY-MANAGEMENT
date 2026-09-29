# ⚡ VoltGuard: Smart Electricity Management & Overload Protection Dashboard

A real-time, responsive home electricity monitoring system designed for the **ESP32** microcontroller and **PZEM-004T v3.0** energy sensor. Features live telemetry waveforms, intelligent overload detection, audio warning sirens, browser push alerts, Telegram notifications, and a built-in load simulator.

---

## 🌟 Key Features

1. **Real-Time Electricity Telemetry:**
   - **Incoming Mains Voltage (V):** With visual range gauge (<190V Undervoltage, 230V Nominal, >255V Surge).
   - **Current in Usage (A):** With breaker load percentage and peak amperage tracking.
   - **Active Power Load (W / kW):** Dynamic power calculation with peak tracking.
   - **Cumulative Energy & Billing:** Real-time kWh consumption and estimated bill calculation based on configurable tariff rates.
   - **Grid Frequency & Power Factor:** True RMS metrics from the sensor.

2. **Automated Safety & Overload Protection:**
   - **Overload Alerting:** Triggers instant visual pulse warning, audio siren (Web Audio API), and event logging when consumption crosses household thresholds (e.g. 3,500W or 16A).
   - **Voltage Anomaly Detection:** Detects high voltage spikes/surges (>255V) and low voltage brownouts (<190V) to safeguard home appliances.
   - **Audio Siren & Desktop Notifications:** Built-in siren with one-click mute and browser notifications.
   - **Optional Telegram Alerts:** Send real-time hazard alerts directly to your phone via Telegram Bot.

3. **Interactive Load Simulator:**
   - Test and demonstrate the dashboard immediately without hardware attached!
   - 1-click preset scenarios:
     - 🌱 *Standby / Idle (~180W)*
     - 📺 *TV + Refrigerator (~1.2 kW)*
     - 🍳 *AC + Microwave (~2.7 kW)*
     - 🚨 *CRITICAL OVERLOAD SPIKE (~4.3 kW / 20A)*
     - 📉 *Low Voltage Brownout (172V)*
     - ⚡ *High Voltage Surge (264V)*
   - Manual sliders for Voltage (150V–280V), Amperage (0A–30A), and Power Factor (0.70–1.00).

4. **ESP32 Hardware Ready:**
   - Ready-to-flash Arduino sketch in `esp32_firmware/esp32_energy_monitor.ino`.
   - REST API endpoint: `POST http://<YOUR_PC_IP>:3000/api/telemetry`.
   - WebSocket real-time data sync.

---

## 🚀 How to Run the Dashboard

### 1. Start the Server
In this project directory, run:
```bash
npm start
```
The server will start on port `3000`.

### 2. Open in Your Browser
Visit:
```
http://localhost:3000
```
*(You can also open this link on your smartphone or tablet connected to the same home Wi-Fi network by replacing `localhost` with your PC's local IP address, e.g. `http://192.168.1.15:3000`).*

---

## 🔌 Connecting Your ESP32 Hardware

1. **Hardware Requirements:**
   - ESP32 Development Board (NodeMCU / DevKit V1)
   - PZEM-004T v3.0 Energy Sensor Module (with Split-Core CT coil)
   - 5V Power Supply for ESP32

2. **Wiring:**
   - `PZEM TX` ➔ `ESP32 GPIO 16 (RX2)`
   - `PZEM RX` ➔ `ESP32 GPIO 17 (TX2)`
   - `PZEM 5V & GND` ➔ `ESP32 VIN & GND`
   - `PZEM Voltage Terminals` ➔ AC Mains Live (L) & Neutral (N)
   - `CT Coil` ➔ Clamped around the **Live wire only**

3. **Flashing Firmware:**
   - Open `esp32_firmware/esp32_energy_monitor.ino` in Arduino IDE.
   - Install the **PZEM004Tv30** library via Tools > Manage Libraries.
   - Enter your Wi-Fi credentials and PC IP address.
   - Click **Upload**.
   - Your dashboard will automatically switch source badge to **"Source: Live ESP32 Hardware"** as soon as data arrives!

---

## 📱 Telegram Alerts Setup (Optional)

1. Open Telegram and search for `@BotFather` to create a new bot and get a **Bot Token**.
2. Search for `@userinfobot` or `@RawDataBot` to find your personal **Chat ID**.
3. Open the dashboard, click **⚙️ Thresholds**, enter your Token and Chat ID, and click **Test Alert**.
4. You will receive instant notifications on your phone whenever an overload occurs!
