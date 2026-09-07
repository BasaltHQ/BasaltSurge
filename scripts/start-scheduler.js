const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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

const stateFile = path.join(__dirname, '..', 'cron-state.json');
let serverAddress = null;

function getRequestTarget() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const hostHeaders = appUrl ? { Host: new URL(appUrl).host } : {};

  // Passenger intercepts listen(port) and uses a Unix socket. Calls from the
  // application process must use server.address() rather than the requested port.
  if (typeof serverAddress === 'string') {
    return { transport: http, options: { socketPath: serverAddress }, headers: hostHeaders };
  }
  if (serverAddress && serverAddress.port) {
    return { transport: http, options: { hostname: '127.0.0.1', port: serverAddress.port }, headers: hostHeaders };
  }

  // Scheduled --once commands are outside Passenger and cannot discover the
  // current worker socket. Reach the configured application origin instead.
  const baseUrl = process.env.CRON_BASE_URL || process.env.INTERNAL_BASE_URL ||
    (process.env.HOSTING_PROVIDER === 'plesk' ? appUrl : '');
  if (baseUrl) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('invalid_cron_base_url');
    }
    return {
      transport: url.protocol === 'https:' ? https : http,
      options: { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80) },
      headers: { Host: url.host },
    };
  }
  if (process.env.HOSTING_PROVIDER === 'plesk') {
    throw new Error('plesk_cron_url_not_configured');
  }
  return { transport: http, options: { hostname: '127.0.0.1', port: process.env.PORT || 3001 }, headers: hostHeaders };
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

  let target;
  try {
    target = getRequestTarget();
  } catch (error) {
    console.error(`[cron-scheduler] Cannot trigger ${pathname}:`, error.message);
    return Promise.resolve({ ok: false, statusCode: 0, body: '', error: error.message });
  }
  const options = {
    ...target.options,
    path: pathname,
    method: method,
    headers: {
      ...target.headers,
      'x-cron-secret': secret,
      ...(method === 'POST' ? { 'Content-Length': '0' } : {})
    }
  };

  return new Promise((resolve) => {
    const req = target.transport.request(options, (res) => {
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
      const failResponse = (error) => {
        console.error(`[cron-scheduler] Incomplete response from ${pathname}:`, error.message);
        resolve({ ok: false, statusCode: Number(res.statusCode || 0), body: '', error: error.message });
      };
      res.on('aborted', () => failResponse(new Error('response_aborted')));
      res.on('error', failResponse);
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

const jobsInProgress = new Set();

async function checkAndRun() {
  const now = new Date();
  const state = getCronState();
  const nowMs = now.getTime();
  const jobs = [];

  function schedule(stateKey, due, pathname, method, completedValue) {
    if (!due || jobsInProgress.has(stateKey)) return;
    jobsInProgress.add(stateKey);
    jobs.push((async () => {
      try {
        const result = await triggerEndpoint(pathname, method);
        if (result.ok) {
          // Other jobs can complete while this request runs. Preserve their
          // timestamps instead of overwriting them with this tick's snapshot.
          saveCronState({ ...getCronState(), [stateKey]: completedValue });
        }
        return result.ok;
      } catch (error) {
        console.error(`[cron-scheduler] Scheduled ${pathname} failed:`, error);
        return false;
      } finally {
        jobsInProgress.delete(stateKey);
      }
    })());
  }

  // Each endpoint has its own in-process guard. Slow maintenance requests must
  // not hold reconciliation behind them or cause the next reconciliation tick
  // to be skipped. Cross-process financial claims remain enforced by the routes.
  const tenMinutesMs = 10 * 60 * 1000;
  schedule('lastReconcileTime', nowMs - (state.lastReconcileTime || 0) >= tenMinutesMs,
    '/api/cron/reconcile-stuck', 'POST', nowMs);

  // Autoclose: once a day, target hour: 8 UTC.
  const todayStr = now.toISOString().split('T')[0];
  const currentHourUtc = now.getUTCHours();
  schedule('lastAutocloseDate', currentHourUtc >= 8 && state.lastAutocloseDate !== todayStr,
    '/api/cron/autoclose', 'POST', todayStr);

  // Reindex-all: every 6 hours since the last successful run.
  const sixHoursMs = 6 * 60 * 60 * 1000;
  schedule('lastReindexTime', nowMs - (state.lastReindexTime || 0) >= sixHoursMs,
    '/api/split/reindex-all', 'GET', nowMs);

  return (await Promise.all(jobs)).every(Boolean);
}

function init({ address = null } = {}) {
  serverAddress = address;
  if (process.argv.includes('--once')) {
    console.log(`[cron-scheduler] Running one-shot fallback check on PID ${process.pid}`);
    return checkAndRun().then((ok) => {
      if (!ok) process.exitCode = 1;
    }).catch((error) => {
      console.error('[cron-scheduler] One-shot fallback check failed:', error);
      process.exitCode = 1;
    });
  }

  // The scheduler is native to every application process. There is no
  // filesystem leader lock to strand a replacement process during a Plesk or
  // Passenger rolling rebuild. Financial concurrency is controlled narrowly
  // by partner+wallet settlement claims inside the transfer executor.
  console.log(`[cron-scheduler] Initialized native scheduler on PID ${process.pid}`);

  // Run initial check after a short startup delay
  const run = () => void checkAndRun().catch((error) => {
    console.error('[cron-scheduler] Scheduled check failed:', error);
  });
  setTimeout(run, 15000);

  // Check every 10 minutes
  setInterval(run, 10 * 60 * 1000);
}

module.exports = { init, checkAndRun };
if (require.main === module) init();
