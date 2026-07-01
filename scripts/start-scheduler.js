const fs = require('fs');
const path = require('path');
const http = require('http');

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
    return;
  }

  const port = process.env.PORT || 3000;
  const hasQuery = pathname.includes('?');
  const options = {
    hostname: '127.0.0.1',
    port: port,
    path: hasQuery ? `${pathname}&cronSecret=${encodeURIComponent(secret)}` : `${pathname}?cronSecret=${encodeURIComponent(secret)}`,
    method: method,
    headers: {
      'x-cron-secret': secret,
      ...(method === 'POST' ? { 'Content-Length': '0' } : {})
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      console.log(`[cron-scheduler] Triggered ${pathname} (${method}) - Status: ${res.statusCode}`);
    });
  });

  req.on('error', (e) => {
    console.error(`[cron-scheduler] Failed to trigger ${pathname} (${method}):`, e.message);
  });

  req.end();
}

function checkAndRun() {
  const now = new Date();
  const state = getCronState();
  const nowMs = now.getTime();

  // 1. Autoclose: once a day, target hour: 8 UTC
  const todayStr = now.toISOString().split('T')[0];
  const currentHourUtc = now.getUTCHours();

  if (currentHourUtc >= 8 && state.lastAutocloseDate !== todayStr) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Autoclose...`);
    state.lastAutocloseDate = todayStr;
    saveCronState(state);
    triggerEndpoint('/api/cron/autoclose', 'POST');
  }

  // 2. Reindex-all: every 6 hours (6h elapsed since last run)
  const sixHoursMs = 6 * 60 * 60 * 1000;
  if (nowMs - state.lastReindexTime >= sixHoursMs) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Reindex All...`);
    state.lastReindexTime = nowMs;
    saveCronState(state);
    triggerEndpoint('/api/split/reindex-all', 'GET');
  }

  // 3. Reconcile-stuck: every 10 minutes (10m elapsed since last run)
  const tenMinutesMs = 10 * 60 * 1000;
  if (nowMs - (state.lastReconcileTime || 0) >= tenMinutesMs) {
    console.log(`[cron-scheduler] Time is ${now.toISOString()} - Triggering Reconcile Stuck Payments...`);
    state.lastReconcileTime = nowMs;
    saveCronState(state);
    triggerEndpoint('/api/cron/reconcile-stuck', 'POST');
  }
}

function init() {
  if (!acquireLock()) {
    return; // Another process is holding the lock
  }

  console.log(`[cron-scheduler] Initialized scheduler daemon on PID ${process.pid}`);

  // Run initial check after a short startup delay
  setTimeout(checkAndRun, 15000);

  // Check every 10 minutes
  setInterval(checkAndRun, 10 * 60 * 1000);
}

// Start scheduler
init();
