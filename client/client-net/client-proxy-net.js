// client-proxy-net.js

// @ts-check

'use strict';

const net = require('net');

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

		const auth = PARSE_PROXY_URL.username ?
			'Proxy-Authorization: Basic ' +
			Buffer.from(PARSE_PROXY_URL.username + ':' + PARSE_PROXY_URL.password)
				.toString('base64') + CRLF : '';

		console.log(PARSE_PROXY_URL.hostname, Number(PARSE_PROXY_URL.port || 80));

		const port = Number(PARSE_PROXY_URL.port ||
			(PARSE_PROXY_URL.protocol === 'https:' ? '443' : '80'));
		const soc = net.connect({
			port, host: PARSE_PROXY_URL.hostname,
			// allowHalfOpen: true,
			// keepAlive: true,
		}, () => console.log('***CONNECTED***'));

		soc.pipe(writeStream, { end: false });
		soc.on('error', reject);
		soc.on('end', () => {
			soc.end();
			resolve(undefined);
			console.log('***END***');
		});

		// send request
		const pathname = (PROXY_URL ? TARGET_URL : PARSE_TARGET_URL.pathname);
		const msg = [['GET', pathname, 'HTTP/1.1'].join(' '),
			'Host: ' + PARSE_TARGET_URL.host,
			auth + 'Connection: close',
			'', ''].join(CRLF);
		soc.write(msg);
		writeStream.write(msg);
	});
}
