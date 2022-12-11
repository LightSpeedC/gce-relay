// client-proxy-http.js

// @ts-check

'use strict';

const http = require('http');

const TARGET_URL = process.argv[2];
const PROXY_URL = process.argv[3];

main().catch(console.error);

async function main() {
	await httpRequest(process.stdout, TARGET_URL, PROXY_URL);
}

function httpRequest(writeStream, TARGET_URL, PROXY_URL) {

	return new Promise((resolve, reject) => {

		const PARSE_TARGET_URL = new URL(TARGET_URL);
		const PARSE_PROXY_URL = PROXY_URL ?
			new URL(PROXY_URL) : PARSE_TARGET_URL;

		const CRLF = '\r\n';

		const auth = PARSE_PROXY_URL.username ? {
			'Proxy-Authorization': 'Basic ' +
				Buffer.from(PARSE_PROXY_URL.username + ':' + PARSE_PROXY_URL.password)
					.toString('base64')
		} : {};
		const headers = Object.assign({ Host: PARSE_TARGET_URL.host }, auth);

		const onErr = err => err && reject(err);

		const req = http.request({
			hostname: PARSE_PROXY_URL.hostname,
			port: PARSE_PROXY_URL.port,
			path: PROXY_URL ? TARGET_URL : PARSE_TARGET_URL.pathname,
			method: 'GET',
			headers,
		}, res => {
			for (let i = 0; i < res.rawHeaders.length; i += 2)
				writeStream.write(res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + CRLF, onErr);
			writeStream.write(CRLF, onErr);
			res.pipe(writeStream, { end: false });
			res.on('end', resolve);
		});
		req.on('error', reject);
		req.end();

	});

}
