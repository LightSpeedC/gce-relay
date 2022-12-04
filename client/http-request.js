// @ts-check

'use strict';

const http = require('http');
const envConfig = require('./env-config');
const { xRelayCommand, xRelayOptions, xRelayStatus } = envConfig;

module.exports = httpRequest;

/**
 * httpRequest
 * @param {any} reqOptions {
 *		method: string, // GET or POST, ...
 *		headers: object, // request headers
 *		body: Buffer | string | null | undefined, // contents to send
 *		targetURL: string, // URL
 *		proxyURL: string, // URL
 * }
 * @returns any {headers: object, body: Buffer}
 */
function httpRequest({ method, headers, body, targetURL, proxyURL }) {

	return new Promise((resolve, reject) => {

		const parseTargetURL = new URL(targetURL);
		const parseProxyURL = proxyURL ?
			new URL(proxyURL) : parseTargetURL;

		const req = http.request({
			hostname: parseProxyURL.hostname,
			port: parseProxyURL.port,
			path: proxyURL ? targetURL : parseTargetURL.pathname,
			method,
			headers: Object.assign({ Host: parseTargetURL.host },
				parseProxyURL.username ? {
					'Proxy-Authorization': 'Basic ' +
						Buffer.from(parseProxyURL.username + ':' + parseProxyURL.password)
							.toString('base64')
				} : {}, headers || {}),
		}, res => {

			const dataList = [];
			let dataLength = 0;

			res.on('error', reject);
			res.on('data', data => {
				dataList.push(data);
				dataLength += data.length;
			});
			res.on('end', () => resolve({
				headers: res.headers,
				rawHeaders: res.rawHeaders,
				body: Buffer.concat(dataList, dataLength),
				status: res.headers[xRelayStatus],
				command: res.headers[xRelayCommand],
				options: res.headers[xRelayOptions],
			}));

		});

		req.on('error', reject);
		// if (body) req.write(body);
		req.end(body);

	});

}