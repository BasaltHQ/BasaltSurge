const fs = require('fs');
const path = require('path');
const http = require('http');

// Plesk scheduled commands do not always inherit the Node application's
// environment. Mirror Next's production file precedence without overriding
// variables Plesk did provide, so CRON_SECRET and PORT resolve consistently
// whether this module is loaded by server.js or launched by Plesk.
for (const envFile of ['.env.production.local', '.env.local', '.env.production', '.env']) {
  require('dotenv').config({
    path: path.join(__dirname, '..', envFile),
    override: false,
    quiet: true,
  });
}

const lockFile = path.join(__dirname, '..', 'cron.lock');
const stateFile = path.join(__dirname, '..', 'cron-state.json');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function acquireLock() {
  try {
    if (fs.existsSync(lockFile)) {
      const pid = parseInt(fs.readFileSync(lockFile, 'utf8'), 10);
      if (pid && isProcessAlive(pid)) {
        return false;
      }
    }
    fs.writeFileSync(lockFile, process.pid.toString(), 'utf8');
    return true;
  } catch (e) {
    return false;
  }
}

function getCronState() {
  try {
    if (fs.existsSync(stateFile)) {
      return JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    }
  } catch (e) {}
  return { lastAutocloseDate: "", lastReindexTime: 0, lastReconcileTime: 0 };
}

function saveCronState(state) {
  try {
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (e) {}
}

function triggerEndpoint(pathname, method = 'POST') {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(`[cron-scheduler] Skip triggering ${pathname}: CRON_SECRET env var is not set`);
    return Promise.resolve({ ok: false, statusCode: 0, body: '', error: 'cron_secret_not_configured' });
  }

  // Must match server.js's production default. server.js also writes the
  // selected port into process.env before loading this scheduler.
  const port = process.env.PORT || 3000;
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: pathname,
    method: method,
    headers: {
      'x-cron-secret': secret,
      ...(method === 'POST' ? { 'Content-Length': '0' } : {})
    }
  };

  return new Promise((resolve) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        if (data.length < 65536) data += chunk;
      });
      res.on('end', () => {
        let payload = null;
        try { payload = data ? JSON.parse(data) : null; } catch (e) {}
        const statusCode = Number(res.statusCode || 0);
        const ok = statusCode >= 200 && statusCode < 300 && payload !== null && payload?.success !== false && payload?.ok !== false;
        console.log(`[cron-scheduler] Triggered ${pathname} (${method}) - Status: ${statusCode}, Success: ${ok}`);
        resolve({ ok, statusCode, body: data });
      });
    });

    req.setTimeout(330000, () => {
      req.destroy(new Error('request_timeout'));
    });

    req.on('error', (e) => {
      console.error(`[cron-scheduler] Failed to trigger ${pathname} (${method}):`, e.message);
      resolve({ ok: false, statusCode: 0, body: '', error: e.message });
    });

    req.end();
  });
}

let checkInProgress = false;

async function checkAndRun() {
  if (checkInProgress) return;
  checkInProgress = true;

  try {
  const now = new Date();
  const state = getCronState();
  const nowMs = now.getTime();

  // 1. Autoclose: once a day, target hour: 8 UTC
  const todayStr = now.toISOString().split('T')[0];
  const currentHourUtc = now.getUTCHours();

  if (currentHourUtc >= 8 && state.lastAutocloseDate !== todayStr) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Autoclose...`);
    const result = await triggerEndpoint('/api/cron/autoclose', 'POST');
    if (result.ok) {
      state.lastAutocloseDate = todayStr;
      saveCronState(state);
    }
  }

  // 2. Reindex-all: every 6 hours (6h elapsed since last run)
  const sixHoursMs = 6 * 60 * 60 * 1000;
  if (nowMs - state.lastReindexTime >= sixHoursMs) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Reindex All...`);
    const result = await triggerEndpoint('/api/split/reindex-all', 'GET');
    if (result.ok) {
      state.lastReindexTime = nowMs;
      saveCronState(state);
    }
  }

  // 3. Reconcile-stuck: every 10 minutes (10m elapsed since last run)
  const tenMinutesMs = 10 * 60 * 1000;
  if (nowMs - (state.lastReconcileTime || 0) >= tenMinutesMs) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Reconcile Stuck Payments...`);
    const result = await triggerEndpoint('/api/cron/reconcile-stuck', 'POST');
    if (result.ok) {
      state.lastReconcileTime = nowMs;
      saveCronState(state);
    }
  }
  } finally {
    checkInProgress = false;
  }
}

function init() {
  if (!acquireLock()) {
    return; // Another process is holding the lock
  }

  console.log(`[cron-scheduler] Initialized scheduler daemon on PID ${process.pid}`);

  // Run initial check after a short startup delay
  setTimeout(() => void checkAndRun(), 15000);

  // Check every 10 minutes
  setInterval(() => void checkAndRun(), 10 * 60 * 1000);
}

// Start scheduler
init();
