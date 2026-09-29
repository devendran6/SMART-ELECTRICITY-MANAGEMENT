// State Management
let state = {
  settings: {
    maxPower: 3500,
    maxCurrent: 16.0,
    minVoltage: 190.0,
    maxVoltage: 255.0,
    tariffRate: 7.50,
    currency: '₹',
    telegramBotToken: '',
    telegramChatId: '',
    audioAlarmEnabled: true
  },
  telemetry: {
    voltage: 230.0,
    current: 4.5,
    power: 1035.0,
    energy: 3.42,
    frequency: 50.0,
    powerFactor: 0.98,
    status: 'NORMAL',
    overload: false,
    source: 'SIMULATOR'
  },
  peakPower: 1035.0,
  alerts: [],
  isConnected: false,
  soundMuted: false,
  chartMode: 'both' // 'both', 'power', 'voltage'
};

// Web Audio API Synthesizer & Alert Siren Engine
let audioCtx = null;
let sirenInterval = null;
let activeOscillators = [];

function initAudio() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Play pleasant chirp when user un-mutes
function playConfirmationChirp() {
  if (state.soundMuted) return;
  initAudio();
  if (!audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.type = 'sine';
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(523.25, now);       // C5
    osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now);
    osc.stop(now + 0.2);
  } catch (e) {
    console.warn('Confirmation sound error:', e);
  }
}

// Single siren pulse (880Hz down to 440Hz warning sweep)
function playSirenPulse() {
  if (state.soundMuted || !state.settings.audioAlarmEnabled) return;
  initAudio();
  if (!audioCtx) return;

  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sawtooth';
    const now = audioCtx.currentTime;
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(440, now + 0.35);

    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.start(now);
    osc.stop(now + 0.35);
    activeOscillators.push(osc);
    osc.onended = () => {
      const idx = activeOscillators.indexOf(osc);
      if (idx > -1) activeOscillators.splice(idx, 1);
    };
  } catch (e) {
    console.warn('Siren audio error:', e);
  }
}

// Start repeating siren alarm (pulses every 800ms)
function startAlarmSiren() {
  if (state.soundMuted || !state.settings.audioAlarmEnabled) return;
  if (sirenInterval) return; // Already running

  playSirenPulse();
  sirenInterval = setInterval(() => {
    if (state.soundMuted || !state.settings.audioAlarmEnabled) {
      stopAlarmSiren();
      return;
    }
    playSirenPulse();
  }, 800);
}

// Stop siren immediately and clean up
function stopAlarmSiren() {
  if (sirenInterval) {
    clearInterval(sirenInterval);
    sirenInterval = null;
  }
  activeOscillators.forEach(osc => {
    try { osc.stop(); } catch (e) {}
  });
  activeOscillators = [];
}

// Master Mute/Unmute State Manager - Keeps all UI and Audio perfectly synchronized
function setMuteState(muted) {
  initAudio();
  state.soundMuted = muted;
  state.settings.audioAlarmEnabled = !muted;

  // 1. Update Top Bar Toggle Button
  const soundBtn = document.getElementById('toggle-sound-btn');
  const soundIcon = document.getElementById('sound-icon');
  const soundText = document.getElementById('sound-text');
  if (soundBtn) {
    if (muted) {
      if (soundIcon) soundIcon.textContent = '🔇';
      if (soundText) soundText.textContent = 'Muted';
      soundBtn.title = 'Sound is Muted (Click to Unmute)';
      soundBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-950/60 hover:bg-red-900/80 border border-red-600/70 text-red-300 transition text-xs font-semibold';
    } else {
      if (soundIcon) soundIcon.textContent = '🔊';
      if (soundText) soundText.textContent = 'Sound ON';
      soundBtn.title = 'Sound is Active (Click to Mute)';
      soundBtn.className = 'flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 transition text-xs font-semibold';
    }
  }

  // 2. Update Emergency Banner Button
  const bannerMuteBtn = document.getElementById('silence-alarm-btn');
  if (bannerMuteBtn) {
    if (muted) {
      bannerMuteBtn.textContent = '🔊 Unmute Siren';
      bannerMuteBtn.className = 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow';
    } else {
      bannerMuteBtn.textContent = '🔇 Mute Siren';
      bannerMuteBtn.className = 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-black/50 hover:bg-black/70 text-white rounded-lg transition border border-white/30';
    }
  }

  // 3. Audio Action
  if (muted) {
    stopAlarmSiren();
  } else {
    // If we unmute and system is currently in overload/hazard, restart siren
    const isHazard = state.telemetry.overload ||
                     state.telemetry.power > state.settings.maxPower ||
                     state.telemetry.current > state.settings.maxCurrent ||
                     state.telemetry.voltage > state.settings.maxVoltage ||
                     (state.telemetry.voltage < state.settings.minVoltage && state.telemetry.voltage > 50);
    if (isHazard) {
      startAlarmSiren();
    } else {
      playConfirmationChirp();
    }
  }
}

// Request Browser Push Notifications
function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function showDesktopNotification(title, body) {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/564/564619.png'
      });
    } catch (e) {}
  }
}

// Chart.js Setup
let telemetryChart;
const maxChartPoints = 40;
const chartData = {
  labels: [],
  datasets: [
    {
      label: 'Active Power (Watts)',
      borderColor: '#eab308',
      backgroundColor: 'rgba(234, 179, 8, 0.1)',
      borderWidth: 2,
      fill: true,
      tension: 0.3,
      yAxisID: 'yPower',
      data: []
    },
    {
      label: 'Voltage (Volts)',
      borderColor: '#06b6d4',
      backgroundColor: 'transparent',
      borderWidth: 2,
      borderDash: [4, 4],
      tension: 0.3,
      yAxisID: 'yVoltage',
      data: []
    }
  ]
};

function initChart() {
  const ctx = document.getElementById('liveTelemetryChart').getContext('2d');
  telemetryChart = new Chart(ctx, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 300 },
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: {
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#94a3b8', font: { family: 'JetBrains Mono', size: 10 }, maxRotation: 0 }
        },
        yPower: {
          type: 'linear',
          position: 'left',
          grid: { color: 'rgba(51, 65, 85, 0.3)' },
          ticks: { color: '#eab308', font: { family: 'JetBrains Mono', size: 10 } },
          suggestedMin: 0,
          suggestedMax: 4000
        },
        yVoltage: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: '#06b6d4', font: { family: 'JetBrains Mono', size: 10 } },
          suggestedMin: 180,
          suggestedMax: 270
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#0f172a',
          borderColor: '#334155',
          borderWidth: 1,
          titleColor: '#f8fafc',
          bodyColor: '#94a3b8',
          bodyFont: { family: 'JetBrains Mono' }
        }
      }
    }
  });
}

function updateChart(time, power, voltage) {
  if (!telemetryChart) return;
  if (chartData.labels.length >= maxChartPoints) {
    chartData.labels.shift();
    chartData.datasets[0].data.shift();
    chartData.datasets[1].data.shift();
  }
  chartData.labels.push(time);
  chartData.datasets[0].data.push(power);
  chartData.datasets[1].data.push(voltage);
  telemetryChart.update('none');
}

// WebSocket Connection
let ws = null;
let reconnectTimer = null;

function connectWebSocket() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host || 'localhost:3000';
  const wsUrl = `${protocol}//${host}`;

  try {
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      console.log('Connected to backend WebSocket');
      state.isConnected = true;
      updateConnectionStatus(true);
      if (reconnectTimer) clearInterval(reconnectTimer);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleIncomingMessage(msg);
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    };

    ws.onclose = () => {
      console.warn('WebSocket closed, attempting reconnect in 3s...');
      state.isConnected = false;
      updateConnectionStatus(false);
      scheduleReconnect();
    };

    ws.onerror = (err) => {
      console.warn('WebSocket connection error:', err);
      state.isConnected = false;
      updateConnectionStatus(false);
    };
  } catch (err) {
    console.error('WS Init exception:', err);
    updateConnectionStatus(false);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearInterval(reconnectTimer);
  reconnectTimer = setInterval(() => {
    if (!state.isConnected) {
      connectWebSocket();
    }
  }, 3000);
}

function updateConnectionStatus(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  if (connected) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    text.textContent = 'ESP32 Server Connected';
    text.className = 'text-emerald-400 font-medium';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-amber-400 animate-pulse';
    text.textContent = 'Local Simulator Active';
    text.className = 'text-amber-400 font-medium';
  }
}

function handleIncomingMessage(msg) {
  if (msg.type === 'INIT') {
    if (msg.settings) {
      state.settings = { ...state.settings, ...msg.settings };
      applySettingsToUI();
    }
    if (msg.alerts && Array.isArray(msg.alerts)) {
      state.alerts = msg.alerts;
      renderAlerts();
    }
    if (msg.history && Array.isArray(msg.history)) {
      msg.history.forEach(pt => {
        updateChart(pt.time, pt.power, pt.voltage);
      });
    }
    if (msg.telemetry) {
      renderTelemetry(msg.telemetry);
    }
  } else if (msg.type === 'TELEMETRY') {
    renderTelemetry(msg.data);
  } else if (msg.type === 'ALERT') {
    handleAlertEvent(msg.alert);
  } else if (msg.type === 'ALERTS_CLEARED') {
    state.alerts = [];
    renderAlerts();
  } else if (msg.type === 'SETTINGS_UPDATED') {
    state.settings = { ...state.settings, ...msg.settings };
    applySettingsToUI();
  } else if (msg.type === 'ENERGY_RESET') {
    state.telemetry.energy = 0.0;
    document.getElementById('val-energy').textContent = '0.00';
    updateCost();
  }
}

// Alert Handlers
function handleAlertEvent(alert) {
  state.alerts.unshift(alert);
  if (state.alerts.length > 50) state.alerts.pop();
  renderAlerts();

  if (alert.severity === 'DANGER' || alert.type === 'OVERLOAD') {
    triggerAlarmUI(alert.type, alert.message);
    startAlarmSiren();
    showDesktopNotification(`🚨 Smart Electricity Alert: ${alert.type}`, alert.message);
  } else {
    if (!state.soundMuted) playConfirmationChirp();
  }
}

function triggerAlarmUI(type, message) {
  const banner = document.getElementById('emergency-banner');
  const tag = document.getElementById('banner-alert-tag');
  const msg = document.getElementById('banner-alert-message');
  const card = document.getElementById('card-power');

  if (banner) {
    banner.classList.remove('hidden');
    if (tag) tag.textContent = type;
    if (msg) msg.textContent = message;
  }
  if (card) card.classList.add('overload-active');

  // Keep banner mute button in perfect sync with current mute state
  const bannerMuteBtn = document.getElementById('silence-alarm-btn');
  if (bannerMuteBtn) {
    bannerMuteBtn.textContent = state.soundMuted ? '🔊 Unmute Siren' : '🔇 Mute Siren';
    bannerMuteBtn.className = state.soundMuted
      ? 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg transition shadow'
      : 'px-3 py-1.5 text-xs font-bold uppercase tracking-wider bg-black/50 hover:bg-black/70 text-white rounded-lg transition border border-white/30';
  }
}

function clearAlarmUI() {
  const banner = document.getElementById('emergency-banner');
  const card = document.getElementById('card-power');
  if (banner) banner.classList.add('hidden');
  if (card) card.classList.remove('overload-active');
  stopAlarmSiren();
}

// UI Render Engine
function renderTelemetry(data) {
  state.telemetry = data;

  const { voltage, current, power, energy, frequency, powerFactor, status, overload, source } = data;

  // Track Peak
  if (power > state.peakPower) {
    state.peakPower = power;
    document.getElementById('val-peak-power').textContent = `${Math.round(state.peakPower)} W`;
  }

  // Update Numerical Values
  document.getElementById('val-voltage').textContent = voltage.toFixed(1);
  document.getElementById('val-current').textContent = current.toFixed(2);
  document.getElementById('val-power').textContent = Math.round(power).toLocaleString();
  document.getElementById('val-energy').textContent = energy.toFixed(2);
  document.getElementById('val-frequency').textContent = `${frequency.toFixed(1)} Hz`;
  document.getElementById('val-pf').textContent = powerFactor.toFixed(2);

  // Update Source Badge
  const srcBadge = document.getElementById('source-badge');
  if (source === 'ESP32') {
    srcBadge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
    srcBadge.textContent = 'Source: Live ESP32 Hardware';
  } else {
    srcBadge.className = 'px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/30';
    srcBadge.textContent = 'Source: Interactive Simulator';
  }

  // Update Voltage Bar & Status
  const vMin = state.settings.minVoltage;
  const vMax = state.settings.maxVoltage;
  const vPct = Math.min(Math.max(((voltage - 160) / (280 - 160)) * 100, 0), 100);
  document.getElementById('voltage-bar').style.width = `${vPct}%`;

  const vPill = document.getElementById('voltage-status-pill');
  if (voltage < vMin) {
    vPill.textContent = 'Undervoltage';
    vPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40';
  } else if (voltage > vMax) {
    vPill.textContent = 'Overvoltage!';
    vPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/40';
  } else {
    vPill.textContent = 'Optimal (230V)';
    vPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-cyan-500/10 text-cyan-400 border border-cyan-500/20';
  }

  // Update Current Bar & Status
  const iMax = state.settings.maxCurrent;
  const iPct = Math.min(Math.max((current / iMax) * 100, 0), 100);
  const currentBar = document.getElementById('current-bar');
  currentBar.style.width = `${iPct}%`;

  const iPill = document.getElementById('current-status-pill');
  if (current > iMax) {
    iPill.textContent = 'Overload (Trip!)';
    iPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-red-500/20 text-red-400 border border-red-500/40';
    currentBar.className = 'h-full bg-red-500 rounded-full transition-all duration-300';
  } else if (current > iMax * 0.8) {
    iPill.textContent = 'Heavy Load';
    iPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/40';
    currentBar.className = 'h-full bg-gradient-to-r from-amber-500 to-red-400 rounded-full transition-all duration-300';
  } else {
    iPill.textContent = 'Safe';
    iPill.className = 'text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
    currentBar.className = 'h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-300';
  }

  // Update Power Bar & Status
  const wMax = state.settings.maxPower;
  const loadPercentage = ((power / wMax) * 100).toFixed(1);
  const cappedLoadPct = Math.min(Math.max(loadPercentage, 0), 100);
  
  document.getElementById('load-percentage').textContent = `${loadPercentage}%`;
  document.getElementById('load-bar').style.width = `${cappedLoadPct}%`;
  document.getElementById('power-bar').style.width = `${cappedLoadPct}%`;

  const headroom = Math.max(wMax - power, 0);
  document.getElementById('val-headroom').textContent = `${Math.round(headroom)} W`;

  // Update Safety Master Card & Overload Banner
  const safetyCard = document.getElementById('safety-status-card');
  const safetyTitle = document.getElementById('safety-title');
  const safetyBadge = document.getElementById('safety-badge');
  const safetyDesc = document.getElementById('safety-description');
  const safetyIcon = document.getElementById('safety-indicator-icon');

  if (overload || power > wMax || current > iMax) {
    safetyCard.className = 'rounded-2xl p-5 bg-gradient-to-r from-red-950 via-slate-900 to-red-950 border border-red-500/60 shadow-xl transition-all duration-300 overload-active';
    safetyTitle.textContent = 'OVERLOAD DETECTED - BREAKER HAZARD';
    safetyTitle.className = 'text-lg font-bold text-red-400 tracking-tight';
    safetyBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500/30 text-red-300 border border-red-500';
    safetyBadge.textContent = 'CRITICAL OVERLOAD';
    safetyDesc.innerHTML = `<span class="text-red-300 font-semibold">Load has exceeded the household limit (${Math.round(power)}W > ${wMax}W). Disconnect heavy appliances immediately!</span>`;
    safetyIcon.textContent = '🚨';
    safetyIcon.className = 'w-12 h-12 rounded-xl bg-red-500/30 text-red-400 border border-red-500/60 flex items-center justify-center text-2xl';

    triggerAlarmUI('OVERLOAD ALERT', `Power consumption (${Math.round(power)}W) exceeds safe threshold (${wMax}W)!`);
    startAlarmSiren();
  } else if (voltage > vMax) {
    safetyCard.className = 'rounded-2xl p-5 bg-slate-900 border border-red-500/40 shadow-xl transition-all duration-300';
    safetyTitle.textContent = 'HIGH VOLTAGE SURGE WARNING';
    safetyBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-red-500/20 text-red-400 border border-red-500/40';
    safetyBadge.textContent = 'SURGE DANGER';
    safetyIcon.textContent = '⚡';
    triggerAlarmUI('HIGH VOLTAGE SURGE', `Mains voltage is dangerously high (${voltage.toFixed(1)}V > ${vMax}V limit)!`);
    startAlarmSiren();
  } else if (voltage < vMin && voltage > 50) {
    safetyCard.className = 'rounded-2xl p-5 bg-slate-900 border border-amber-500/40 shadow-xl transition-all duration-300';
    safetyTitle.textContent = 'UNDERVOLTAGE / BROWNOUT DETECTED';
    safetyBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border border-amber-500/40';
    safetyBadge.textContent = 'BROWNOUT';
    safetyIcon.textContent = '📉';
    triggerAlarmUI('UNDERVOLTAGE DETECTED', `Mains voltage is abnormally low (${voltage.toFixed(1)}V < ${vMin}V limit)!`);
    startAlarmSiren();
  } else {
    // Normal Safe Operation
    clearAlarmUI();
    safetyCard.className = 'rounded-2xl p-5 bg-gradient-to-r from-slate-900 via-slate-900 to-slate-800 border border-slate-800 shadow-xl transition-all duration-300';
    safetyTitle.textContent = 'System Status: All Parameters Normal';
    safetyTitle.className = 'text-lg font-bold text-white tracking-tight';
    safetyBadge.className = 'px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider bg-emerald-500/20 text-emerald-400 border border-emerald-500/40';
    safetyBadge.textContent = 'Safe Load';
    safetyDesc.innerHTML = `Household load is well within the safe operational threshold of <span class="text-slate-200 font-semibold">${wMax}W</span>.`;
    safetyIcon.textContent = '🛡️';
    safetyIcon.className = 'w-12 h-12 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center text-2xl';
  }

  // Update Estimated Cost
  updateCost();

  // Update Appliance Estimation
  updateApplianceEstimator(power);

  // Update Graph
  const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  updateChart(timeLabel, Math.round(power), Number(voltage.toFixed(1)));
}

function updateCost() {
  const cost = state.telemetry.energy * state.settings.tariffRate;
  document.getElementById('val-cost').textContent = `${state.settings.currency}${cost.toFixed(2)}`;
}

function updateApplianceEstimator(power) {
  const badgeFridge = document.getElementById('badge-fridge');
  const badgeAc = document.getElementById('badge-ac');
  const badgeHeater = document.getElementById('badge-heater');

  // Fridge active logic
  if (power >= 180) {
    badgeFridge.textContent = 'RUNNING';
    badgeFridge.className = 'text-xs font-mono font-bold text-emerald-400';
  } else {
    badgeFridge.textContent = 'IDLE';
    badgeFridge.className = 'text-xs font-mono font-bold text-slate-500';
  }

  // AC active logic (>1100W)
  if (power >= 1100) {
    badgeAc.textContent = 'HIGH LOAD';
    badgeAc.className = 'text-xs font-mono font-bold text-cyan-400';
  } else {
    badgeAc.textContent = 'OFF';
    badgeAc.className = 'text-xs font-mono font-bold text-slate-500';
  }

  // Heater / Induction active logic (>2400W)
  if (power >= 2400) {
    badgeHeater.textContent = 'SURGE ON';
    badgeHeater.className = 'text-xs font-mono font-bold text-red-400 animate-pulse';
  } else {
    badgeHeater.textContent = 'OFF';
    badgeHeater.className = 'text-xs font-mono font-bold text-slate-500';
  }
}

function renderAlerts() {
  const container = document.getElementById('alerts-container');
  const badge = document.getElementById('alert-counter-badge');
  badge.textContent = `${state.alerts.length} Events`;

  if (state.alerts.length === 0) {
    container.innerHTML = `
      <div class="text-center py-8 text-xs text-slate-500">
        No safety incidents logged. Everything running within nominal thresholds!
      </div>
    `;
    return;
  }

  container.innerHTML = state.alerts.map(a => {
    const isDanger = a.severity === 'DANGER' || a.type === 'OVERLOAD';
    const borderCol = isDanger ? 'border-red-500/40 bg-red-950/20' : 'border-amber-500/40 bg-amber-950/20';
    const tagCol = isDanger ? 'bg-red-500/20 text-red-400 border-red-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30';
    const timeFormatted = new Date(a.timestamp).toLocaleTimeString();

    return `
      <div class="p-3 rounded-xl border ${borderCol} flex items-center justify-between gap-4 text-xs transition hover:bg-slate-800/40">
        <div class="flex items-center gap-3">
          <span class="text-lg">${isDanger ? '🚨' : '⚠️'}</span>
          <div>
            <div class="flex items-center gap-2">
              <span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${tagCol}">${a.type}</span>
              <span class="text-slate-200 font-semibold">${a.message}</span>
            </div>
            <div class="text-[11px] text-slate-400 mt-0.5">Reading: <b class="text-white">${a.value || 'N/A'}</b></div>
          </div>
        </div>
        <div class="text-[11px] text-slate-500 font-mono whitespace-nowrap">${timeFormatted}</div>
      </div>
    `;
  }).join('');
}

function applySettingsToUI() {
  document.getElementById('summary-max-w').textContent = `${state.settings.maxPower}W`;
  document.getElementById('val-w-max').textContent = state.settings.maxPower;
  document.getElementById('val-i-max').textContent = state.settings.maxCurrent.toFixed(1);
  document.getElementById('val-v-min').textContent = `${state.settings.minVoltage}V`;
  document.getElementById('val-v-max').textContent = `${state.settings.maxVoltage}V`;
  document.getElementById('val-tariff-rate').textContent = `${state.settings.currency}${state.settings.tariffRate.toFixed(2)} / kWh`;

  // Form fields
  document.getElementById('setting-maxPower').value = state.settings.maxPower;
  document.getElementById('setting-maxCurrent').value = state.settings.maxCurrent;
  document.getElementById('setting-minVoltage').value = state.settings.minVoltage;
  document.getElementById('setting-maxVoltage').value = state.settings.maxVoltage;
  document.getElementById('setting-tariffRate').value = state.settings.tariffRate;
  document.getElementById('setting-currency').value = state.settings.currency;
  document.getElementById('setting-telegramBotToken').value = state.settings.telegramBotToken || '';
  document.getElementById('setting-telegramChatId').value = state.settings.telegramChatId || '';
}

// Interactive Simulator Logic
let simAutoTimer = null;
let currentSimValues = {
  voltage: 230.0,
  current: 4.5,
  powerFactor: 0.98
};

function updateSimulatorSliders() {
  document.getElementById('sim-voltage').value = currentSimValues.voltage;
  document.getElementById('sim-v-val').textContent = `${Math.round(currentSimValues.voltage)} V`;
  document.getElementById('sim-current').value = currentSimValues.current;
  document.getElementById('sim-i-val').textContent = `${currentSimValues.current.toFixed(1)} A`;
  document.getElementById('sim-pf').value = currentSimValues.powerFactor;
  document.getElementById('sim-pf-val').textContent = currentSimValues.powerFactor.toFixed(2);
}

function pushSimulatorTelemetry() {
  const v = currentSimValues.voltage;
  const i = currentSimValues.current;
  const pf = currentSimValues.powerFactor;
  const p = v * i * pf;

  const payload = {
    voltage: v,
    current: i,
    power: p,
    powerFactor: pf,
    frequency: 50.0 + (Math.random() * 0.1 - 0.05),
    source: 'SIMULATOR'
  };

  if (state.isConnected && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'TELEMETRY_POST',
      data: payload,
      source: 'SIMULATOR'
    }));
  } else {
    // Local standalone simulation fallback
    payload.energy = state.telemetry.energy + (p * 1) / 3600000;
    payload.overload = (p > state.settings.maxPower || i > state.settings.maxCurrent);
    payload.status = payload.overload ? 'OVERLOAD' : (v > state.settings.maxVoltage ? 'VOLTAGE_HIGH' : (v < state.settings.minVoltage ? 'VOLTAGE_LOW' : 'NORMAL'));
    renderTelemetry(payload);

    if (payload.overload) {
      handleAlertEvent({
        id: Date.now().toString(),
        type: 'OVERLOAD',
        severity: 'DANGER',
        message: `Power exceeded ${state.settings.maxPower}W limit!`,
        value: `${Math.round(p)}W, ${i.toFixed(1)}A`,
        timestamp: new Date().toISOString()
      });
    }
  }
}

function startAutoCycle() {
  if (simAutoTimer) clearInterval(simAutoTimer);
  simAutoTimer = setInterval(() => {
    if (!document.getElementById('sim-auto-cycle').checked) return;
    // Add realistic micro-fluctuations
    currentSimValues.voltage += (Math.random() * 1.6 - 0.8);
    currentSimValues.voltage = Math.max(160, Math.min(275, currentSimValues.voltage));

    currentSimValues.current += (Math.random() * 0.16 - 0.08);
    currentSimValues.current = Math.max(0.1, currentSimValues.current);

    updateSimulatorSliders();
    pushSimulatorTelemetry();
  }, 1000);
}

// Event Listeners Setup
function setupEventListeners() {
  // Sound Mute Toggle in Header
  const soundBtn = document.getElementById('toggle-sound-btn');
  if (soundBtn) {
    soundBtn.addEventListener('click', () => {
      setMuteState(!state.soundMuted);
    });
  }

  // Emergency Banner Silence / Unmute Button
  const bannerMuteBtn = document.getElementById('silence-alarm-btn');
  if (bannerMuteBtn) {
    bannerMuteBtn.addEventListener('click', () => {
      setMuteState(!state.soundMuted);
    });
  }

  document.getElementById('view-alert-details-btn').addEventListener('click', () => {
    document.getElementById('alerts-container').scrollIntoView({ behavior: 'smooth' });
  });

  // Simulator Drawer Toggle
  const simDrawer = document.getElementById('sim-drawer');
  document.getElementById('toggle-sim-btn').addEventListener('click', () => {
    simDrawer.classList.toggle('hidden');
  });
  document.getElementById('close-sim-btn').addEventListener('click', () => {
    simDrawer.classList.add('hidden');
  });

  // Simulator Scenario Buttons
  document.querySelectorAll('.sim-scenario-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      initAudio();
      currentSimValues.voltage = parseFloat(btn.dataset.v);
      currentSimValues.current = parseFloat(btn.dataset.i);
      currentSimValues.powerFactor = parseFloat(btn.dataset.pf);
      updateSimulatorSliders();
      pushSimulatorTelemetry();
    });
  });

  // Slider Inputs
  document.getElementById('sim-voltage').addEventListener('input', (e) => {
    currentSimValues.voltage = parseFloat(e.target.value);
    document.getElementById('sim-v-val').textContent = `${Math.round(currentSimValues.voltage)} V`;
    pushSimulatorTelemetry();
  });

  document.getElementById('sim-current').addEventListener('input', (e) => {
    currentSimValues.current = parseFloat(e.target.value);
    document.getElementById('sim-i-val').textContent = `${currentSimValues.current.toFixed(1)} A`;
    pushSimulatorTelemetry();
  });

  document.getElementById('sim-pf').addEventListener('input', (e) => {
    currentSimValues.powerFactor = parseFloat(e.target.value);
    document.getElementById('sim-pf-val').textContent = currentSimValues.powerFactor.toFixed(2);
    pushSimulatorTelemetry();
  });

  // Reset Energy Button
  document.getElementById('reset-energy-btn').addEventListener('click', async () => {
    if (confirm('Reset cumulative energy consumption (kWh) counter to 0?')) {
      try {
        await fetch('/api/reset-energy', { method: 'POST' });
      } catch (e) {
        state.telemetry.energy = 0.0;
        document.getElementById('val-energy').textContent = '0.00';
        updateCost();
      }
    }
  });

  // Clear Alerts
  document.getElementById('clear-alerts-btn').addEventListener('click', async () => {
    try {
      await fetch('/api/alerts/clear', { method: 'POST' });
    } catch (e) {
      state.alerts = [];
      renderAlerts();
    }
  });

  // Settings Modal
  const settingsModal = document.getElementById('settings-modal');
  document.getElementById('open-settings-btn').addEventListener('click', () => {
    applySettingsToUI();
    settingsModal.classList.remove('hidden');
  });
  document.getElementById('close-settings-modal-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });
  document.getElementById('cancel-settings-btn').addEventListener('click', () => {
    settingsModal.classList.add('hidden');
  });

  // Settings Form Submit
  document.getElementById('settings-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const updated = {
      maxPower: parseFloat(document.getElementById('setting-maxPower').value),
      maxCurrent: parseFloat(document.getElementById('setting-maxCurrent').value),
      minVoltage: parseFloat(document.getElementById('setting-minVoltage').value),
      maxVoltage: parseFloat(document.getElementById('setting-maxVoltage').value),
      tariffRate: parseFloat(document.getElementById('setting-tariffRate').value),
      currency: document.getElementById('setting-currency').value,
      telegramBotToken: document.getElementById('setting-telegramBotToken').value.trim(),
      telegramChatId: document.getElementById('setting-telegramChatId').value.trim()
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated)
      });
      const data = await res.json();
      state.settings = { ...state.settings, ...data.settings };
    } catch (err) {
      state.settings = { ...state.settings, ...updated };
    }

    applySettingsToUI();
    settingsModal.classList.add('hidden');
    alert('Settings successfully updated!');
  });

  // Test Telegram Button
  document.getElementById('test-telegram-btn').addEventListener('click', async () => {
    try {
      const res = await fetch('/api/test-telegram', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert('Telegram test alert sent successfully! Check your phone.');
      } else {
        alert('Telegram test failed: ' + (data.reason || data.error || 'Check Bot Token & Chat ID'));
      }
    } catch (err) {
      alert('Could not send test: ' + err.message);
    }
  });

  // ESP32 Modal
  const espModal = document.getElementById('esp-modal');
  document.getElementById('open-esp-btn').addEventListener('click', () => {
    espModal.classList.remove('hidden');
  });
  document.getElementById('close-esp-modal-btn').addEventListener('click', () => {
    espModal.classList.add('hidden');
  });

  // Copy Arduino Sketch
  document.getElementById('copy-sketch-btn').addEventListener('click', () => {
    const code = document.getElementById('arduino-code-block').innerText;
    navigator.clipboard.writeText(code).then(() => {
      const btn = document.getElementById('copy-sketch-btn');
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = 'Copy Code'; }, 2000);
    });
  });

  // Chart View Buttons
  document.getElementById('chart-view-both').addEventListener('click', () => {
    telemetryChart.data.datasets[0].hidden = false;
    telemetryChart.data.datasets[1].hidden = false;
    telemetryChart.update();
  });
  document.getElementById('chart-view-power').addEventListener('click', () => {
    telemetryChart.data.datasets[0].hidden = false;
    telemetryChart.data.datasets[1].hidden = true;
    telemetryChart.update();
  });
  document.getElementById('chart-view-voltage').addEventListener('click', () => {
    telemetryChart.data.datasets[0].hidden = true;
    telemetryChart.data.datasets[1].hidden = false;
    telemetryChart.update();
  });

  // Theme Dropdown Toggle & Options
  const themeBtn = document.getElementById('theme-btn');
  const themeDropdown = document.getElementById('theme-dropdown');
  const themeContainer = document.getElementById('theme-menu-container');

  if (themeBtn && themeDropdown) {
    themeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      themeDropdown.classList.toggle('hidden');
    });

    document.querySelectorAll('.theme-option').forEach(opt => {
      opt.addEventListener('click', () => {
        applyTheme(opt.dataset.theme);
        themeDropdown.classList.add('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (themeContainer && !themeContainer.contains(e.target)) {
        themeDropdown.classList.add('hidden');
      }
    });
  }

  // Enable audio context on any user click
  document.body.addEventListener('click', () => {
    initAudio();
  }, { once: true });
}

// Multi-Theme Controller
const themeMeta = {
  'cyber': { label: 'Cyber Dark', icon: '🌌', gridColor: 'rgba(51, 65, 85, 0.3)', tickColor: '#94a3b8' },
  'electric-blue': { label: 'Electric Azure', icon: '⚡', gridColor: 'rgba(30, 58, 110, 0.4)', tickColor: '#93c5fd' },
  'emerald': { label: 'Eco Emerald', icon: '🌿', gridColor: 'rgba(6, 78, 59, 0.4)', tickColor: '#a7f3d0' },
  'solar-amber': { label: 'Industrial Amber', icon: '☀️', gridColor: 'rgba(120, 53, 15, 0.4)', tickColor: '#fde68a' },
  'midnight-oled': { label: 'Midnight OLED', icon: '🖤', gridColor: 'rgba(39, 39, 46, 0.5)', tickColor: '#a1a1aa' },
  'light': { label: 'Clean Studio', icon: '☀️', gridColor: 'rgba(203, 213, 225, 0.7)', tickColor: '#475569' }
};

function applyTheme(themeKey) {
  const meta = themeMeta[themeKey] || themeMeta['cyber'];
  
  // Cleanly replace theme classes
  document.body.className = document.body.className
    .replace(/\btheme-[a-z\-]+\b/g, '')
    .trim();
  
  document.body.classList.add(`theme-${themeKey}`);

  // Update button label and icon
  const themeLabel = document.getElementById('theme-label');
  const themeIcon = document.getElementById('theme-icon');
  if (themeLabel) themeLabel.textContent = meta.label;
  if (themeIcon) themeIcon.textContent = meta.icon;

  // Persist preference
  localStorage.setItem('voltguard_theme', themeKey);

  // Update Chart colors if initialized
  if (telemetryChart && telemetryChart.options && telemetryChart.options.scales) {
    if (telemetryChart.options.scales.x) {
      telemetryChart.options.scales.x.grid.color = meta.gridColor;
      telemetryChart.options.scales.x.ticks.color = meta.tickColor;
    }
    if (telemetryChart.options.scales.yPower) {
      telemetryChart.options.scales.yPower.grid.color = meta.gridColor;
    }
    telemetryChart.update('none');
  }
}

// Populate Arduino Code Block in Modal
function loadArduinoSnippet() {
  const code = `/*
 * Smart Electricity Management & Overload Protection
 * ESP32 + PZEM-004T v3.0 Energy Monitor
 * Sends Live Voltage, Current, Power & Energy to Local Dashboard
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <PZEM004Tv30.h>

// --- Wi-Fi Configuration ---
const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// --- Server Configuration ---
// Replace with the IP address of your PC running the dashboard
const char* serverUrl = "http://192.168.1.100:3000/api/telemetry";

// --- Hardware Pins (PZEM-004T v3.0) ---
// ESP32 Serial2: RX = GPIO 16 (Connects to PZEM TX)
//                TX = GPIO 17 (Connects to PZEM RX)
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17
PZEM004Tv30 pzem(Serial2, PZEM_RX_PIN, PZEM_TX_PIN);

// Optional Buzzer / Contactor Relay Pin
#define RELAY_PIN 25
#define BUZZER_PIN 26

void setup() {
  Serial.begin(115200);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, HIGH); // Normal ON

  Serial.println("\\nConnecting to Wi-Fi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nWiFi Connected! IP: " + WiFi.localIP().toString());
}

void loop() {
  // Read sensor values from PZEM-004T
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  // Validate readings
  if (isnan(voltage)) {
    Serial.println("Error reading from PZEM-004T!");
    delay(2000);
    return;
  }

  // Print to Serial Monitor
  Serial.printf("V: %.1fV | I: %.2fA | P: %.1fW | E: %.3fkWh | PF: %.2f\\n",
                voltage, current, power, energy, pf);

  // Send JSON payload to Dashboard Server
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(serverUrl);
    http.addHeader("Content-Type", "application/json");

    String jsonPayload = String("{") +
      "\"voltage\":" + String(voltage, 1) + "," +
      "\"current\":" + String(current, 2) + "," +
      "\"power\":" + String(power, 1) + "," +
      "\"energy\":" + String(energy, 3) + "," +
      "\"frequency\":" + String(frequency, 1) + "," +
      "\"powerFactor\":" + String(pf, 2) + "," +
      "\"source\":\"ESP32\"" +
    "}";

    int httpCode = http.POST(jsonPayload);
    if (httpCode > 0) {
      Serial.printf("HTTP Response code: %d\\n", httpCode);
    } else {
      Serial.printf("HTTP POST failed, error: %s\\n", http.errorToString(httpCode).c_str());
    }
    http.end();
  }

  delay(1000); // 1-second telemetry interval
}`;

  document.getElementById('arduino-code-block').textContent = code;
}

// Initialization on DOM Load
window.addEventListener('DOMContentLoaded', () => {
  initChart();
  setupEventListeners();
  loadArduinoSnippet();
  applySettingsToUI();
  updateSimulatorSliders();
  requestNotificationPermission();
  setMuteState(false);

  // Apply User Theme Preference
  const savedTheme = localStorage.getItem('voltguard_theme') || 'cyber';
  applyTheme(savedTheme);

  // Try to connect to Node backend
  connectWebSocket();

  // Start realistic auto-cycle
  startAutoCycle();
});
