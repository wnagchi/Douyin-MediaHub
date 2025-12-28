function send(res, statusCode, body, headers = {}) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "");
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": buf.length,
    ...headers,
  });
  res.end(buf);
}

function sendJson(res, statusCode, obj, headers = {}) {
  const body = JSON.stringify(obj);
  send(res, statusCode, body, {
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
}

module.exports = { send, sendJson };


