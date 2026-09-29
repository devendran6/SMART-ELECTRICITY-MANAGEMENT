const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Default Application State
let appState = {
  settings: {
    maxPower: 3500,        // Watts (e.g. 16A * 220V)
    maxCurrent: 16.0,      // Amperes
    minVoltage: 190.0,     // Volts (Undervoltage limit)
    maxVoltage: 255.0,     // Volts (Overvoltage limit)
    tariffRate: 7.50,      // Currency per kWh (e.g. ₹7.50 or $0.15)
    currency: '₹',         // Currency symbol
    telegramBotToken: '',
    telegramChatId: '',
    audioAlarmEnabled: true
  },
  latestTelemetry: {
    voltage: 230.0,
    current: 0.0,
    power: 0.0,
    energy: 0.0,
    frequency: 50.0,
    powerFactor: 0.99,
    timestamp: new Date().toISOString(),
    status: 'NORMAL',      // NORMAL, OVERLOAD, VOLTAGE_LOW, VOLTAGE_HIGH
    overload: false,
    source: 'STANDBY'      // ESP32 or SIMULATOR or STANDBY
  },
  history: [],             // Array of last 100 data points
  alerts: []               // Array of triggered alert events
};

// Load saved data if exists
function loadSavedData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (saved.settings) appState.settings = { ...appState.settings, ...saved.settings };
      if (saved.alerts) appState.alerts = saved.alerts.slice(-100);
      if (saved.latestTelemetry && saved.latestTelemetry.energy) {
        appState.latestTelemetry.energy = saved.latestTelemetry.energy;
      }
    }
  } catch (err) {
    console.error('Error loading saved data:', err.message);
  }
}

// Save data periodically or upon changes
function persistData() {
  try {
    const dataToSave = {
      settings: appState.settings,
      alerts: appState.alerts.slice(-100),
      latestTelemetry: {
        energy: appState.latestTelemetry.energy
      }
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (err) {
    console.error('Error persisting data:', err.message);
  }
}

loadSavedData();

// Broadcast data to all connected WebSocket dashboard clients
function broadcast(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

// Telegram Alert Sender Helper
async function sendTelegramAlert(message) {
  const { telegramBotToken, telegramChatId } = appState.settings;
  if (!telegramBotToken || !telegramChatId) return { success: false, reason: 'Credentials not configured' };

  try {
    const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: telegramChatId,
        text: message,
        parse_mode: 'HTML'
      })
    });
    const result = await response.json();
    return { success: result.ok, data: result };
  } catch (err) {
    console.error('Telegram notification error:', err.message);
    return { success: false, error: err.message };
  }
}

// Helper to record alerts with anti-spam debouncing
let lastAlertTimes = {};
function recordAlert(type, message, value, severity = 'DANGER') {
  const now = Date.now();
  // Don't send telegram / duplicate alert for same type within 30 seconds
  const shouldNotify = !lastAlertTimes[type] || (now - lastAlertTimes[type] > 30000);

  const alertItem = {
    id: Date.now() + Math.random().toString(36).substr(2, 4),
    type,
    severity,
    message,
    value,
    timestamp: new Date().toISOString()
  };

  appState.alerts.unshift(alertItem);
  if (appState.alerts.length > 100) appState.alerts.pop();

  if (shouldNotify) {
    lastAlertTimes[type] = now;
    const tgMessage = `🚨 <b>Smart Electricity Alert: ${type}</b>\n\n${message}\n<b>Current Reading:</b> ${value}\n<b>Time:</b> ${new Date().toLocaleTimeString()}`;
    sendTelegramAlert(tgMessage).catch(() => {});
  }

  // Push alert event via WebSocket
  broadcast({
    type: 'ALERT',
    alert: alertItem
  });

  persistData();
}

// Process incoming telemetry (from ESP32 or Simulator)
function processTelemetry(data, source = 'ESP32') {
  const voltage = parseFloat(data.voltage) || 0.0;
  const current = parseFloat(data.current) || 0.0;
  // Calculate power if not provided (P = V * I * PF)
  const powerFactor = (data.powerFactor !== undefined && data.powerFactor !== null) ? parseFloat(data.powerFactor) : 0.98;
  const power = (data.power !== undefined && data.power !== null) ? parseFloat(data.power) : (voltage * current * powerFactor);
  const frequency = parseFloat(data.frequency) || 50.0;
  
  // Calculate or increment energy
  let energy = appState.latestTelemetry.energy;
  if (data.energy !== undefined && data.energy !== null) {
    energy = parseFloat(data.energy);
  } else {
    // Accumulate ~1 second worth of kWh: (Watts * seconds) / (3600 * 1000)
    energy += (power * 1) / 3600000;
  }

  const { maxPower, maxCurrent, minVoltage, maxVoltage } = appState.settings;

  let status = 'NORMAL';
  let isOverload = false;

  // Overload checks
  if (power > maxPower || current > maxCurrent) {
    status = 'OVERLOAD';
    isOverload = true;
    recordAlert(
      'OVERLOAD',
      `Power load exceeded safe limit! (${power.toFixed(0)}W / ${maxPower}W or ${current.toFixed(1)}A / ${maxCurrent}A)`,
      `${power.toFixed(0)}W, ${current.toFixed(2)}A`,
      'DANGER'
    );
  } else if (voltage > maxVoltage) {
    status = 'VOLTAGE_HIGH';
    recordAlert(
      'HIGH_VOLTAGE',
      `Dangerous high voltage surge detected (${voltage.toFixed(1)}V > ${maxVoltage}V limit)!`,
      `${voltage.toFixed(1)} V`,
      'WARNING'
    );
  } else if (voltage < minVoltage && voltage > 50) {
    status = 'VOLTAGE_LOW';
    recordAlert(
      'LOW_VOLTAGE',
      `Undervoltage brownout detected (${voltage.toFixed(1)}V < ${minVoltage}V limit)!`,
      `${voltage.toFixed(1)} V`,
      'WARNING'
    );
  }

  const telemetry = {
    voltage: Number(voltage.toFixed(1)),
    current: Number(current.toFixed(2)),
    power: Number(power.toFixed(1)),
    energy: Number(energy.toFixed(3)),
    frequency: Number(frequency.toFixed(1)),
    powerFactor: Number(powerFactor.toFixed(2)),
    timestamp: new Date().toISOString(),
    status,
    overload: isOverload,
    source
  };

  appState.latestTelemetry = telemetry;

  // Append to history buffer (up to 120 points for live graphs)
  appState.history.push({
    time: new Date().toLocaleTimeString(),
    timestamp: Date.now(),
    voltage: telemetry.voltage,
    current: telemetry.current,
    power: telemetry.power
  });
  if (appState.history.length > 120) {
    appState.history.shift();
  }

  // Broadcast to Web clients
  broadcast({
    type: 'TELEMETRY',
    data: telemetry
  });

  return telemetry;
}

// REST Endpoints
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ONLINE',
    connectedClients: wss.clients.size,
    lastUpdate: appState.latestTelemetry.timestamp,
    source: appState.latestTelemetry.source
  });
});

app.get('/api/telemetry', (req, res) => {
  res.json(appState.latestTelemetry);
});

// Endpoint for ESP32 or Simulator to post data
app.post('/api/telemetry', (req, res) => {
  const telemetry = processTelemetry(req.body, req.body.source || 'ESP32');
  res.json({ success: true, telemetry });
});

app.get('/api/history', (req, res) => {
  res.json(appState.history);
});

app.get('/api/alerts', (req, res) => {
  res.json(appState.alerts);
});

app.post('/api/alerts/clear', (req, res) => {
  appState.alerts = [];
  persistData();
  broadcast({ type: 'ALERTS_CLEARED' });
  res.json({ success: true });
});

app.get('/api/settings', (req, res) => {
  res.json(appState.settings);
});

app.post('/api/settings', (req, res) => {
  appState.settings = { ...appState.settings, ...req.body };
  persistData();
  broadcast({ type: 'SETTINGS_UPDATED', settings: appState.settings });
  res.json({ success: true, settings: appState.settings });
});

app.post('/api/reset-energy', (req, res) => {
  appState.latestTelemetry.energy = 0.0;
  persistData();
  broadcast({ type: 'ENERGY_RESET' });
  res.json({ success: true, energy: 0.0 });
});

app.post('/api/test-telegram', async (req, res) => {
  const result = await sendTelegramAlert('🔔 <b>Test Notification</b>\nSmart Electricity Management connection test successful!');
  res.json(result);
});

// WebSocket Connection Handling
wss.on('connection', (ws) => {
  // Send current state immediately on connection
  ws.send(JSON.stringify({
    type: 'INIT',
    telemetry: appState.latestTelemetry,
    settings: appState.settings,
    alerts: appState.alerts.slice(0, 30),
    history: appState.history
  }));

  ws.on('message', (message) => {
    try {
      const parsed = JSON.parse(message);
      if (parsed.type === 'TELEMETRY_POST') {
        processTelemetry(parsed.data, parsed.source || 'SIMULATOR');
      }
    } catch (e) {
      console.error('Invalid WS message:', e.message);
    }
  });
});

// Start Server
server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`⚡ SMART ELECTRICITY MANAGEMENT DASHBOARD ONLINE`);
  console.log(`🌐 Web UI: http://localhost:${PORT}`);
  console.log(`📡 ESP32 Ingestion: POST http://<YOUR_PC_IP>:${PORT}/api/telemetry`);
  console.log(`=======================================================`);
});
