// client-proxy-http.js

// @ts-check

'use strict';

const net = require('net');
const DateTime = require('date-time-string');

const httpRequest = require('./http-request');
const uniqId = require('./uniq-id');
// const stream2buffer = require('../lib/stream2buffer');

// Content-Type: application/octet-stream
// Content-Type: application/json; charset=UTF-8

const targetURL = process.argv[2];
const proxyURL = process.argv[3];
const envNo = Number(process.argv[4] || "0");

const envConfig = envNo === 0 ? require('./env-config') :
	envNo === 1 ? require('./env-config1') :
		require('./env-config2');
const { serverName } = envConfig;
const localServerName = serverName;
const serverId = uniqId(serverName).split('.').slice(0, 2).join('.');
const { xRelayCommand, xRelayOptions, xRelayStatus } = envConfig;
const MAX_THREADS = 4;

const COLOR_RESET = '\x1b[m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_RED_BOLD = '\x1b[31;1m';

// connections
const localConnections = new Map();
const remoteConnections = new Map();

main().catch(console.error);

async function main() {
	// local
	envConfig.localServices.forEach(x => {
		// [1010]
		const { port, serviceName } = x;
		const server = net.createServer({
			//allowHalfOpen: true,
		}, async (soc) => {
			// [1030]
			const connectionId = uniqId('ConnId');
			let closed = false;
			try {
				// [2000] conn
				const res1 = await rpc('GET', 'conn',
					{ x: '[2000]', serverName, serverId, port, serviceName, connectionId });
				// [2030]
				if (res1.status !== '200 OK')
					console.log(getNow(), '[2030] conn.status:', res1.status);

				let remoteSeqNo = 0;
				let localSeqNo = 0;

				localConnections.set(connectionId, {
					socket: soc,
					status: 'connecting',
					func: async function (cmd, args, body) {
						console.log(getNow(), 'func:', connectionId, cmd, args);
						if (cmd === 'send3') { // send2 @@@@@@@@@@@@@@###########
							++localSeqNo;
							console.log(getNow(), 'func.recv:', serverName, port, serviceName, connectionId, localSeqNo);
							soc.write(body, err => err && console.log('soc.write.error:', err));
						}
						else {
							console.log(getNow(), COLOR_RED_BOLD, cmd, args, COLOR_RESET);
						}
					},
				});

				// [3000] data (local)
				soc.on('data', async (data) => {
					try {
						console.log(getNow(), 'conn.data:', serverName, port, serviceName);
						++remoteSeqNo;
						// [3010]
						const res = await rpc('POST', 'send',
							{ x: '[3010]', serverName, port, serviceName, connectionId, remoteSeqNo }, data);
						if (res.status !== '200 OK')
							console.log(getNow(), 'conn.send.status:', res.status);
					} catch (err) {
						release('soc.data.send.error:', err);
					}
				});
				soc.on('error', async (err) => {
					try {
						console.log(getNow(), 'soc.err:', serverName, port, serviceName, err);
						++remoteSeqNo;
						// [err.xxxx]
						const res = await rpc('GET', 'end',
							{ x: '[err.xxxx]', serverName, port, serviceName, connectionId, remoteSeqNo });
						if (res.status !== '200 OK')
							console.log(getNow(), 'soc.err.end.status:', res.status);
						release('soc.err:', serverName, port, serviceName);
					} catch (err) {
						release('soc.err.error:', serverName, port, serviceName, err);
					}
				});
				soc.on('end', async () => {
					try {
						console.log(getNow(), 'end:', serverName, port, serviceName);
						++remoteSeqNo;
						// [end.xxxx]
						const res = await rpc('GET', 'end',
							{ x: '[end.xxxx]', serverName, port, serviceName, connectionId, remoteSeqNo });
						if (res.status !== '200 OK')
							console.log(getNow(), 'end.status:', res.status);
						release('soc.end:', serverName, port, serviceName);
					} catch (err) {
						release('soc.end.error:', err);
					}
				});
			} catch (err) {
				release('soc.conn.error:', err);
			};
			function release(...args) {
				console.log(getNow(), ...args);
				if (!closed) {
					soc.end();
					closed = true;
				}
				localConnections.delete(connectionId);
			}
		});
		server.on('error', err => {
			console.log(getNow(), serverName, 'server.error:', port, serviceName, err);
		});
		// [1020]
		server.listen(port, () => {
			console.log(getNow(), serverName, 'server.listen:', port, serviceName);
		});
	});

	await sleep(1000);

	// [0000] init
	const remoteServiceList = Object.keys(envConfig.remoteServices);

	let waitSeconds = 0;

	// recv
	for (let threadId = 0; threadId < MAX_THREADS; ++threadId) {
		thread(threadId);
		async function thread(threadId) {
			while (true) {
				try {
					// [0100] recv
					const res = await rpc('GET', 'recv',
						{ x: '[0100]', serverName, serverId, remoteServiceList });
					const dt = getNow();
					if (res.status !== '200 OK')
						console.log(dt, localServerName, threadId, '[0100] recv.status:', res.status);
					const cmd = res.command;
					const { serviceName, connectionId } = res.options;
					const obj = remoteConnections.get(connectionId);
					const svcObj = envConfig.remoteServices[serviceName];
					console.log(dt, localServerName, threadId, 'recv:', COLOR_CYAN + cmd,
						JSON.stringify(res.options).replace(/\"/g, '').replace(/,/g, ', ') + COLOR_RESET);

					// [2110] conn
					if (cmd === 'conn') {
						// console.log(COLOR_RED_BOLD, '[2110] conn', svcObj, COLOR_RESET);
						if (!svcObj) throw new Error('serviceName not found: eh!?');
						const { host, port } = svcObj;
						const { serverName, serverId } = res.options;
						console.log(dt, localServerName, threadId, 'conn.from:', serverName, serverId,
							'conn.to:', serviceName, connectionId);
						if (obj) throw new Error('connectionId: eh!?');
						// [2120] conn
						const soc = net.connect({ host, port }, async () => {
							// console.log(COLOR_RED_BOLD, '[2200] conn.ok', svcObj, COLOR_RESET);
							// [2200] conn.ok
							try {
								const res = await rpc('GET', 'conn.ok',
									{ x: '[2200]', serverName, serverId, serviceName, connectionId });
								console.log(dt, localServerName, threadId, '[2200] conn.ok.status:', res.status);
							} catch (err) {
								// TODO
								console.log(dt, localServerName, threadId, '[2200] conn.ok.error:', err);
							}
						});
						// [2130] conn
						if (remoteConnections.get(connectionId))
							throw new Error('connectionId! eh!?');
						remoteConnections.set(connectionId, {
							socket: soc,
							status: 'connecting',
						});
						// [3200] send2
						soc.on('data', async (data) => {
							try {
								const res = await rpc('POST', 'send2',
									{ x: '[3200]', serverName, serverId, serviceName, connectionId }, data);
								if (res.status !== '200 OK')
									console.log(dt, localServerName, threadId, '[3200] send2.status:', res.status);
							} catch (err) {
								// TODO
								console.log(dt, localServerName, threadId, '[3200] send2.error:', err);
							}
						});
						// [err2.xxxx]
						soc.on('error', async (err) => {
							if (err['code'] === 'ECONNRESET')
								console.log(COLOR_RED_BOLD + '[err2.xxxx] ' + err + COLOR_RESET);
							else
								console.log(COLOR_RED_BOLD, err, COLOR_RESET);
							try {
								const res = await rpc('GET', 'end2',
									{ x: '[err2.xxxx]', serverName, serverId, serviceName, connectionId });
								console.log(dt, localServerName, threadId, '[err2.xxxx] err2 status:', res.status);
							} catch (err) {
								// TODO
								console.log(dt, localServerName, threadId, '[err2.xxxx] err2.error:', err);
							}
						});
						// [end2.xxxx] end2
						soc.on('end', async () => {
							try {
								const res = await rpc('GET', 'end2',
									{ x: '[end2.xxxx]', serverName, serverId, serviceName, connectionId });
								console.log(dt, localServerName, threadId, '[end2.xxxx] end2.status:', res.status);
							} catch (err) {
								// TODO
								console.log(dt, localServerName, threadId, '[end2.xxxx] end2.error:', err);
							}
						});
					}
					// [2230] conn.ok
					else if (cmd === 'conn.ok') {
						const conn = localConnections.get(connectionId);
						if (conn.status !== 'connecting') throw new Error('eh!? [2230] conn.ok: status != connecting');
						conn.status = 'connected';
					}
					// [0130] init
					else if (cmd === 'init') {
						// init
						// console.log(dt, localServerName, threadId, COLOR_CYAN + 'init',
						// 	JSON.stringify(res.options).replace(/\"/g, '').replace(/,/g, ', ') +
						// 	COLOR_RESET);
					}
					// [3040] send (local -> remote)
					else if (cmd === 'send') {
						obj.socket.write(res.body,
							err => err && console.log(COLOR_RED_BOLD + '[3040] send.err', err, COLOR_RESET));
						// @@@@@@@@@@@@@@@@
						try {
							// [3050]
							const res = await rpc('GET', 'send.ok',
								{ x: '[3050]', serverName, serverId, serviceName, connectionId });
							if (res.status !== '200 OK')
								console.log(dt, localServerName, threadId, '[3050] send.ok.status:', res.status);
						} catch (err) {
							// TODO
							console.log(dt, localServerName, threadId, '[3050] send.ok.error:', err);
						}
					}
					// [3230] send2 (remote -> local)
					else if (cmd === 'send2') {
						const obj = localConnections.get(connectionId);
						obj.socket.write(res.body,
							err => err && console.log(COLOR_RED_BOLD, '[3230] send2.err', err, COLOR_RESET));
						// @@@@@@@@@@@@@@@@);
						// try {
						// 	// [3240]
						// 	const res = await rpc('GET', 'send2.ok',
						// 		{ serverName, serverId, serviceName, connectionId });
						// 	console.log(dt, localServerName, threadId, 'send2.ok.status:', res.status);
						// } catch (err) {
						// 	// TODO
						// 	console.log(dt, localServerName, threadId, 'send2.ok.error:', err);
						// }
					}
					// [end.xxxx] end
					else if (cmd === 'end') {
						if (obj && obj.socket) {
							obj.socket.end(err => {
								if (err) {
									if (err.code === 'ERR_STREAM_DESTROYED')
										console.log(COLOR_RED_BOLD, '[end.xxxx] end.err ' + err + COLOR_RESET);
									else
										console.log(COLOR_RED_BOLD, '[end.xxxx] end.err', err, COLOR_RESET);
								}
							});
						}
						else
							console.log(COLOR_RED_BOLD, '[end.xxxx] obj or obj.socket is null', COLOR_RESET);
					}
					// [end2.xxxx] end2
					else if (cmd === 'end2') {
						const obj = localConnections.get(connectionId);
						console.log(obj && obj.socket && '[end2.xxxx] obj.socket' || '[end2.xxxx] obj.socket is null');
						if (obj && obj.socket)
							obj.socket.end(err => err && console.log(COLOR_RED_BOLD + '[end2.xxxx] end2.err', err, COLOR_RESET));
						else
							console.log(COLOR_RED_BOLD + '[end2.xxxx] obj or obj.socket is null' + COLOR_RESET);
					}
					// [xxxx] disconnect
					else if (cmd === 'disconnect') {
						//
						console.log(getNow(), COLOR_RED_BOLD, 'disconnect', COLOR_RESET);
					}
					else {
						console.log(dt, localServerName, threadId, 'err - cmd:', cmd);
						throw new Error('cmd: ' + cmd + ' eh!?');
					}
					// if (!obj) throw new Error('connectionId: eh!?');
					// obj.func(cmd, res.options, res.body);
					waitSeconds = 0;
				}
				catch (err) {
					waitSeconds = Math.floor(10 * (waitSeconds * 1.2 + 1)) / 10;
					if (waitSeconds > 10) waitSeconds = 10;
					const ws = waitSeconds * (1 + threadId / 10);
					if (err.code === 'ECONNREFUSED')
						console.log(getNow(), localServerName, threadId, 'recv.error:' + err);
					else
						console.log(getNow(), localServerName, threadId, 'recv.error:', err);

					console.log(getNow(), localServerName, threadId, 'wait...', ws, 'sec');
					await sleep(200 + ws * 1000);
					console.log(getNow(), localServerName, threadId, 'wait.');
				}
			}
		}
	}

	/**
	 * getNow
	 * @param {Date | undefined} dt 
	 * @returns string date-time-string
	 */
	function getNow(dt = new Date()) {
		return DateTime.toDateTimeString(dt);
	}

	/**
	 * rpc
	 * @param {string} cmd 
	 * @param {any} args 
	 * @param {any} body
	 * @returns any {status, options, body}
	 */
	async function rpc(method, cmd, args, body = null) {
		console.log(getNow(), localServerName, 'rpc:', COLOR_GREEN + cmd + ' ' +
			JSON.stringify(args).replace(/\"/g, '').replace(/,/g, ', ') + COLOR_RESET);
		if (body && method !== 'POST')
			console.log(getNow(), COLOR_RED_BOLD + method + ' method has body' + COLOR_RESET);
		else if (!body && method !== 'GET') 
			console.log(getNow(), COLOR_RED_BOLD + method + ' method does not have body' + COLOR_RESET);
		if (body) convertBuffer(body);
		const res = await httpRequest({
			method, body, targetURL, proxyURL,
			headers: {
				[xRelayCommand]: cmd,
				[xRelayOptions]: JSON.stringify(args),
			},
		});
		// const dt = getNow();
		// for (let i = 0; i < res.rawHeaders.length; i += 2)
		// 	console.log(dt, localServerName, 'rpc.res', COLOR_CYAN + res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + COLOR_RESET);
		// console.log(dt, localServerName, 'rpc.res', COLOR_CYAN + 'body [' + res.body.toString() + ']' + COLOR_RESET);

		if (res.body && res.body.length > 0) convertBuffer(res.body);
		const options = res.headers[xRelayOptions];
		return {
			command: res.headers[xRelayCommand],
			status: res.headers[xRelayStatus],
			options: options ? JSON.parse(options) : {},
			headers: res.headers,
			rawHeaders: res.rawHeaders,
			body: res.body,
		};
	}
}

/**
 * sleep
 * @param {number} msec
 * @returns Promise<void>
 */
function sleep(msec) {
	return new Promise(resolve => setTimeout(resolve, msec));
}

function convertBuffer(data) {
	for (let i = 0; i < data.length; ++i)
		data[i] = data[i] ^ envConfig.xRelayCode;
}
