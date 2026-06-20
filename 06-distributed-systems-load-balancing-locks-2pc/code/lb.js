const http = require('http');

const listenPort = Number(process.env.LB_PORT) || 8000;
const algorithm = process.env.ALGORITHM || 'round-robin';

const backends = [
  { host: '127.0.0.1', port: 9001, name: 'BE1', weight: 1, active: 0 },
  { host: '127.0.0.1', port: 9002, name: 'BE2', weight: 2, active: 0 },
  { host: '127.0.0.1', port: 9003, name: 'BE3', weight: 1, active: 0 },
];

let rrIndex = 0;
const weightedBackends = backends.flatMap(backend => Array(backend.weight).fill(backend));

function roundRobin() {
  const backend = backends[rrIndex % backends.length];
  rrIndex += 1;
  return backend;
}

function weightedRoundRobin() {
  const backend = weightedBackends[rrIndex % weightedBackends.length];
  rrIndex += 1;
  return backend;
}

function leastConnections() {
  return backends.reduce((prev, current) =>
    current.active < prev.active ? current : prev
  );
}

function randomBackend() {
  return backends[Math.floor(Math.random() * backends.length)];
}

const strategies = {
  'round-robin': roundRobin,
  'weighted-round-robin': weightedRoundRobin,
  'least-connections': leastConnections,
  random: randomBackend,
};

const selectBackend = strategies[algorithm] || roundRobin;

if (!strategies[algorithm]) {
  console.warn(`[LB] Unknown algorithm '${algorithm}', defaulting to round-robin.`);
}

const server = http.createServer((req, res) => {
  const backend = selectBackend();
  backend.active += 1;

  const proxyOptions = {
    hostname: backend.host,
    port: backend.port,
    path: req.url,
    method: req.method,
    headers: req.headers,
  };

  const proxyReq = http.request(proxyOptions, proxyRes => {
    res.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(res, { end: true });

    proxyRes.on('end', () => {
      backend.active -= 1;
    });
  });

  proxyReq.on('error', err => {
    backend.active -= 1;
    console.error(`[LB] Proxy error to ${backend.name}:${backend.port} - ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
    }
    res.end('Bad gateway\n');
  });

  req.pipe(proxyReq, { end: true });

  console.log(
    `[LB] ${req.method} ${req.url} -> ${backend.name} (${backend.port}) active=${backend.active}`
  );
});

server.listen(listenPort, () => {
  console.log(`Load balancer listening on http://localhost:${listenPort}`);
  console.log(`Algorithm: ${algorithm}`);
  console.log('Available algorithms: round-robin, weighted-round-robin, least-connections, random');
});
