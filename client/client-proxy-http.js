// client-proxy-http.js

// @ts-check

'use strict';

const http = require('http');

const TARGET_URL = process.argv[2];
const PROXY_URL = process.argv[3];

const PARSE_TARGET_URL = new URL(TARGET_URL);
const PARSE_PROXY_URL = PROXY_URL ?
	new URL(PROXY_URL) : PARSE_TARGET_URL;

http.request({
	hostname: PARSE_PROXY_URL.hostname,
	port: PARSE_PROXY_URL.port,
	path: PROXY_URL ? TARGET_URL : PARSE_TARGET_URL.pathname,
	method: 'GET',
	headers: {
		Host: PARSE_TARGET_URL.host,
	},
}, res => {
	for (let i = 0; i < res.rawHeaders.length; i += 2)
		console.log(res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1]);
	console.log();
	res.pipe(process.stdout);
})
.end();
