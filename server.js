const { createServer } = require('http');
const { parse } = require('url');
// `npm start` is the production entrypoint. Plesk normally injects NODE_ENV,
// but set the expected default before Next is initialized when it does not.
if (!process.env.NODE_ENV) process.env.NODE_ENV = 'production';
const next = require('next');

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
// Preserve the existing production/start default when Plesk does not inject a
// port. The scheduler receives this exact value after the server starts.
const port = process.env.PORT || 3001;
// when using middleware `hostname` and `port` must be provided below
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
    createServer(async (req, res) => {
        try {
            // Be sure to pass `true` as the second argument to `url.parse`.
            // This tells it to parse the query portion of the URL.
            const parsedUrl = parse(req.url, true);
            const { pathname, query } = parsedUrl;

            if (pathname === '/a') {
                await app.render(req, res, '/a', query);
            } else if (pathname === '/b') {
                await app.render(req, res, '/b', query);
            } else {
                await handle(req, res, parsedUrl);
            }
        } catch (err) {
            console.error('Error occurred handling', req.url, err);
            res.statusCode = 500;
            res.end('internal server error');
        }
    })
        .once('error', (err) => {
            console.error(err);
            process.exit(1);
        })
        .listen(port, () => {
            console.log(`> Ready on http://${hostname}:${port}`);
            // Start background cron scheduler in production or when START_SCHEDULER is enabled
            if (process.env.NODE_ENV === 'production' || process.env.START_SCHEDULER === 'true') {
                try {
                    // Keep the in-process scheduler on the exact port selected
                    // by this server. This also covers deployments where Plesk
                    // does not explicitly inject PORT.
                    process.env.PORT = String(port);
                    require('./scripts/start-scheduler.js');
                } catch (e) {
                    console.error('Failed to load startup scheduler:', e);
                }
            }
        });
});
