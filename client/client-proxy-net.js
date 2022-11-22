// client-proxy-net.js

// @ts-check

'use strict';

const net = require('net');

const TARGET_URL = process.argv[2];
const PROXY_URL = process.argv[3];

const PARSE_TARGET_URL = new URL(TARGET_URL);
const PARSE_PROXY_URL = PROXY_URL ?
	new URL(PROXY_URL) : PARSE_TARGET_URL;

const CRLF = '\r\n';

console.log(PARSE_PROXY_URL.hostname, Number(PARSE_PROXY_URL.port || 80));

const soc = net.connect({
	port: Number(PARSE_PROXY_URL.port || 80),
	host: PARSE_PROXY_URL.hostname,
	// allowHalfOpen: true,
	// keepAlive: true,
},
// const soc = net.connect(
// 	Number(PARSE_PROXY_URL.port || 80),
// 	PARSE_PROXY_URL.hostname,
() => {

	console.log('HERE');

});

//soc.pipe(process.stdout);
soc.on('error', err => console.error('***CATCH***', err));
soc.on('data', data => data && console.log(data.toString()));
soc.on('end', () => {
	soc.end();
	console.log('***END***');
});

const msg = 'GET ' +
	(PROXY_URL ? TARGET_URL : PARSE_TARGET_URL.pathname) +
	' HTTP/1.1' + CRLF +
	'Host: ' + PARSE_TARGET_URL.host + CRLF +
	'Connection: close' + CRLF +
	CRLF;
soc.write(msg);
console.log(msg);
