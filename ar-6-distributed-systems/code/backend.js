const http = require('http');

const port = Number(process.argv[2]) || 9001;
const id = process.argv[3] || `${port}`;

const server = http.createServer((req, res) => {
  console.log(`[BE ${id}] ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end(`Response from backend server ${id} on port ${port}\n`);
});

server.listen(port, () => {
  console.log(`Backend server ${id} listening on http://localhost:${port}`);
});
