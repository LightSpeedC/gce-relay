// http-proxy-server-in-80-lines.js

// https://qiita.com/LightSpeedC/items/5c1edc2c974206c743f4

// @ts-check

'use strict';

const http = require('http');
const net = require('net');

const HTTP_PORT = process.argv[2] || 8080;  // internal proxy server port
const PROXY_URL = process.argv[3] || null;  // external proxy server URL
const PARSE_URL = PROXY_URL ? new URL(PROXY_URL || '') : {};
const PROXY_HOST = PROXY_URL ? PARSE_URL.hostname : null;
const PROXY_PORT = PROXY_URL ? Number(PARSE_URL.port || 80) : null;

const server = http.createServer(function onCliReq(cliReq, cliRes) {
  // ステルスモード
  if ('proxy-connection' in cliReq.headers) {
    // @ts-ignore
    cliReq.headers.connection = cliReq.headers['proxy-connection'];
    delete cliReq.headers['proxy-connection'];
    delete cliReq.headers['cache-control'];
  }

  let svrSoc;

  const cliSoc = cliReq.socket, x = new URL(cliReq.url || '');
  const svrReq = http.request({host: PROXY_HOST || x.hostname,
      port: PROXY_PORT || x.port || 80,
      path: PROXY_URL ? cliReq.url : x.pathname,
      method: cliReq.method, headers: cliReq.headers,
      // @ts-ignore
      agent: cliSoc.$agent}, function onSvrRes(svrRes) {
    svrSoc = svrRes.socket;
    cliRes.writeHead(svrRes.statusCode || 500, svrRes.headers);
    svrRes.pipe(cliRes);
  });
  cliReq.pipe(svrReq);
  svrReq.on('error', function onSvrReqErr(err) {
    cliRes.writeHead(400, err.message, {'Content-Type': 'text/html; charset=UTF-8'});
    cliRes.write('<h1>' + err.message + '<br/>' + cliReq.url + '</h1>',
      err => onErr(err, 'svrReqErr', x.hostname + ':' + (x.port || 80), svrSoc));
    cliRes.end();
    onErr(err, 'svrReq', x.hostname + ':' + (x.port || 80), svrSoc);
  });
})
.on('clientError', (err, soc) => onErr(err, 'cliErr', '', soc))
.on('connect', function onCliConn(cliReq, cliSoc, cliHead) {
  const x = new URL('https://' + cliReq.url);
  let svrSoc;
  if (PROXY_URL) {
    const svrReq = http.request({host: PROXY_HOST, port: PROXY_PORT,
        path: cliReq.url, method: cliReq.method, headers: cliReq.headers,
        // @ts-ignore
        agent: cliSoc.$agent});
    svrReq.end();
    svrReq.on('connect', function onSvrConn(svrRes, svrSoc2, svrHead) {
      svrSoc = svrSoc2;
      cliSoc.write('HTTP/1.0 200 Connection established\r\n\r\n',
        err => onErr(err, 'cliSocY', cliReq.url, svrSoc));
      if (cliHead && cliHead.length) svrSoc.write(cliHead,
        err => onErr(err, 'svrSocX', cliReq.url, cliSoc));
      if (svrHead && svrHead.length) cliSoc.write(svrHead,
        err => onErr(err, 'cliSocX', cliReq.url, svrSoc));
      svrSoc.pipe(cliSoc);
      cliSoc.pipe(svrSoc);
      svrSoc.on('error', err => onErr(err, 'svrSoc', cliReq.url, cliSoc));
    });
    svrReq.on('error', err => onErr(err, 'svrRq2', cliReq.url, cliSoc));
  }
  else {
    svrSoc = net.connect(Number(x.port || 443),
        x.hostname || undefined,
        function onSvrConn() {
      cliSoc.write('HTTP/1.0 200 Connection established\r\n\r\n',
        err => onErr(err, 'cliSocZ', cliReq.url, svrSoc));
      if (cliHead && cliHead.length) svrSoc.write(cliHead,
        err => onErr(err, 'svrSoc', cliReq.url, cliSoc));
      cliSoc.pipe(svrSoc);
    });
    svrSoc.pipe(cliSoc);
    svrSoc.on('error', err => onErr(err, 'svrSoc', cliReq.url, cliSoc));
  }
  cliSoc.on('error', err => onErr(err, 'cliSoc', cliReq.url, svrSoc));
})
.on('connection', function onConn(cliSoc) {
  // @ts-ignore
  cliSoc.$agent = new http.Agent({keepAlive: true});
  // @ts-ignore
  cliSoc.$agent.on('error', err => console.log('agent:', err));
})
.listen(HTTP_PORT, () =>
  console.log('http proxy server started on port ' + HTTP_PORT +
    (PROXY_URL ? ' -> ' + PROXY_HOST + ':' + PROXY_PORT : '')));

function onErr(err, msg, url, soc) {
  if (!err) return;
  if (soc) soc.end();
  console.log('%s %s: %s', new Date().toLocaleTimeString(), msg, url, err + '');
}

// node http-proxy-server-in-80-lines 8080

// ブラックリスト
const whiteAddressList = {};
whiteAddressList['::1'] = true;
whiteAddressList['::ffff:127.0.0.1'] = true;
whiteAddressList['::ffff:192.168.251.1'] = true;
server.on('connection', function onConn(cliSoc) {
  if ((cliSoc.remoteAddress || 'x') in whiteAddressList) return;
  console.log(new Date().toLocaleTimeString() +
    ' reject: from: ' + cliSoc.remoteAddress);
  cliSoc.destroy();
});

// 接続時間・接続数の表示
let connCount = 0;
server.on('connection', function onConn(cliSoc) {
  // @ts-ignore
  cliSoc.connTime = new Date();
  console.log('++conn: ' + (++connCount) + ' from: ' + cliSoc.remoteAddress);
  cliSoc.on('close', function onDisconn() {
    console.log('--conn: ' + (--connCount) + ' time: ' + 
    // @ts-ignore
      (new Date() - cliSoc.connTime) / 1000.0 + ' sec');
  });
});
