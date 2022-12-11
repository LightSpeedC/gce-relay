// client-proxy-http.js

// @ts-check

'use strict';

const net = require('net');

const httpRequest = require('./http-request');
const uniqId = require('./uniq-id');
const getNow = require('../lib/get-now');
const redError = require('../lib/red-error');
const myStringify = require('../lib/my-stringify');

// Content-Type: application/octet-stream
// Content-Type: application/json; charset=UTF-8

const targetURL = process.argv[2];
const proxyURL = process.argv[3];
const envNo = Number(process.argv[4] || '0');

const envConfig = envNo === 0 ? require('./env-config') :
	envNo === 1 ? require('./env-config1') :
		envNo === 2 ? require('./env-config2') :
			envNo === 3 ? require('./env-config3') :
				require('./env-config4');
const { serverName } = envConfig;
const localServerName = serverName;
const serverId = uniqId(serverName).split('.').slice(0, 2).join('.');
const { xRelayCommand, xRelayOptions, xRelayStatus } = envConfig;
const MAX_THREADS = envConfig.maxThreads || 4;

const COLOR_RESET = '\x1b[m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_MAGENTA = '\x1b[35m';

// connections
const localConnections = new Map();
const remoteConnections = new Map();

main().catch(console.error);

async function main() {
	// L:Local
	envConfig.localServices.forEach(x => {
		// L[1010]
		const { port, serviceName } = x;
		const server = net.createServer({
			//allowHalfOpen: true,
		}, async (soc) => {
			// L[1030]
			const connectionId = uniqId('ConnId');
			try {
				// L[2000] conn
				const res1 = await rpc(port, 'GET', 'conn',
					{ x: 'L[2000]', serverName, serverId, port, serviceName, connectionId });
				// L[2030] con2
				if (res1.status !== '200 OK')
					console.log(getNow(), port, serverName, serviceName, 'L[2030] conn.status:', res1.status);

				let remoteSeqNo = 0;
				// let localSeqNo = 0;

				const locConn = {
					socket: soc,
					status: 'connecting',
					end() {
						if (this.socket) this.socket.end();
						// @ts-ignore
						this.socket = null;
					},
				};
				localConnections.set(connectionId, locConn);

				// L[3000] data (local)
				soc.on('data', async (data) => {
					try {
						console.log(getNow(), port, COLOR_MAGENTA + serverName, 'data:', serviceName, 'L[3000] ' + connectionId + COLOR_RESET);
						++remoteSeqNo;
						// L[3010]
						const res = await rpc(port, 'POST', 'snd1',
							{ x: 'L[3010]', serverName, port, serviceName, connectionId, remoteSeqNo }, data);
						if (res.status !== '200 OK')
							console.log(getNow(), port, serverName, serviceName, ...redError('conn.snd1.sts: ' + res.status));
					} catch (err) {
						release('soc.data.snd1.err:', ...redError(err));
					}
				});
				soc.on('error', async (err) => {
					try {
						console.log(getNow(), port, ...redError(serverName + ' err1: ' + serviceName + ' L[soc.err]:'), ...redError(err));
						++remoteSeqNo;
						// L[err.xxxx]
						const res = await rpc(port, 'GET', 'end1',
							{ x: 'L[err.xxxx]', serverName, port, serviceName, connectionId, remoteSeqNo });
						if (res.status !== '200 OK')
							console.log(getNow(), port, serverName, serviceName, ...redError('soc.err.end.sts: ' + res.status));
						release('soc.err:', ...redError(err), connectionId);
					} catch (err) {
						release('soc.err.err:', ...redError(err), connectionId);
					}
				});
				soc.on('end', async () => {
					try {
						console.log(getNow(), port, COLOR_MAGENTA + serverName, 'end1:', serviceName, connectionId + COLOR_RESET);
						++remoteSeqNo;
						// L[end1.xxxx]
						const res = await rpc(port, 'GET', 'end1',
							{ x: 'L[end1.xxxx]', serverName, port, serviceName, connectionId, remoteSeqNo });
						if (res.status !== '200 OK')
							console.log(getNow(), port, serverName, 'end1:', serviceName, ...redError('end1.sts: ' + res.status));
						release('soc.end:', connectionId);
					} catch (err) {
						release('soc.end.err:', ...redError(err), connectionId);
					}
				});
			} catch (err) {
				release('soc.conn.err:', ...redError(err));
			};
			function release(...args) {
				const locConn = localConnections.get(connectionId);
				console.log(getNow(), port, COLOR_MAGENTA + serverName, 'rels:', serviceName, '[release]', ...args, COLOR_RESET);
				locConn && locConn.end();
				localConnections.delete(connectionId);
			}
		});
		server.on('error', err => // L[1090] server.error
			console.log(getNow(), port, serverName, 'svrx:', serviceName, 'L[1090] svr.err:', ...redError(err)));
		server.listen(port, () => // L[1020] server.listen
			console.log(getNow(), port, serverName, 'svrx:', serviceName, 'L[1020] svr.listen'));
	});

	await sleep(1000);

	const remoteServiceList = Object.keys(envConfig.remoteServices);

	let waitSeconds = 0;

	// X: Local/Remote: recv
	for (let i = 0; i < MAX_THREADS; ++i) {
		thread(1000 + i, i);
		async function thread(threadId, i) {
			while (true) {
				try {
					// X[0100] recv
					const res = await rpc(threadId, 'GET', 'recv',
						{ x: 'X[0100]', serverName, serverId, remoteServiceList });
					const dt = getNow();
					if (res.status !== '200 OK')
						console.log(dt, threadId, localServerName, 'X[0100] recv.status:', res.status);
					const cmd = res.command;
					const { serviceName, connectionId } = res.options;
					const remConn = remoteConnections.get(connectionId);
					const svc = envConfig.remoteServices[serviceName];
					console.log(dt, threadId, COLOR_CYAN + localServerName, // 'recv:',
						cmd + ':', myStringify(res.options) + COLOR_RESET);

					if (cmd === 'conn') { // R[2110] conn
						// console.log(dt, threadId, localServerName, ...redError('[2110] conn: ' + svc));
						if (!svc) throw new Error('serviceName not found: eh!?');
						const { host, port } = svc;
						const { serverName, serverId } = res.options;
						console.log(dt, threadId, localServerName, 'conn: from:', serverName, serverId,
							'to:', serviceName, connectionId);
						if (remConn) throw new Error('connectionId: eh!? already connected!?');
						// R[2120] conn
						const soc = net.connect({ host, port }, async () => {
							// console.log(dt, threadId, localServerName, ...redError('[2200] con1: ' + svc));
							// R[2200] con1
							try {
								const res = await rpc(threadId, 'GET', 'con1',
									{ x: 'R[2200]', serverName, serverId, serviceName, connectionId });
								if (res.status !== '200 OK')
									console.log(dt, threadId, localServerName, ...redError('R[2200] con1.sts: ' + res.status));
							} catch (err) {
								// TODO
								console.log(dt, threadId, localServerName, 'R[2200] con1.err: ', ...redError(err));
							}
						});
						// R[2130] conn
						remoteConnections.set(connectionId, {
							socket: soc,
							status: 'connecting',
							end() {
								if (this.socket) this.socket.end();
								// @ts-ignore
								this.socket = null;
							},
						});
						soc.on('data', async (data) => { // R[3200] snd6
							try {
								const res = await rpc(threadId, 'POST', 'snd6',
									{ x: 'R[3200]', serverName, serverId, serviceName, connectionId }, data);
								if (res.status !== '200 OK')
									console.log(dt, threadId, ...redError(localServerName + ' snd6: R[3200] sts: ' + res.status));
							} catch (err) {
								// TODO
								console.log(dt, threadId, ...redError(localServerName + ' snd6: R[3200] err: '), ...redError(err));
							}
						});
						soc.on('error', async (err) => { // R[err6] err6.xxxx R[xxxx]
							console.log(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId), ...redError(err));
							try {
								const res = await rpc(threadId, 'GET', 'end6',
									{ x: 'R[err6]', serverName, serverId, serviceName, connectionId });
								if (res.status !== '200 OK')
									console.log(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId + ' sts: ' + res.status));
							} catch (err) {
								// TODO
								console.log(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId + ' err:'), ...redError(err));
							}
						});
						soc.on('end', async () => { // R[end6.xxxx] end6 R[xxxx]
							try {
								const res = await rpc(threadId, 'GET', 'end6',
									{ x: 'R[end6.xxxx]', serverName, serverId, serviceName, connectionId });
								if (res.status !== '200 OK')
									console.log(dt, threadId, ...redError(localServerName + ' end6: sts: ' + res.status));
							} catch (err) {
								// TODO
								console.log(dt, threadId, ...redError(localServerName + 'end6: err:'), ...redError(err));
							}
						});
					}
					else if (cmd === 'con3') { // L[2230.xxxx] con3
						const locConn = localConnections.get(connectionId);
						console.log(dt, threadId, localServerName, 'con3:', connectionId);
						if (locConn.status !== 'connecting') throw new Error('eh!? L[2230] con1: status != connecting');
						locConn.status = 'connected';
					}
					else if (cmd === 'init') { // X[0140] init
						console.log(dt, threadId, COLOR_CYAN + localServerName, 'init: X[0140]',
							myStringify(res.options) + COLOR_RESET);
					}
					else if (cmd === 'snd1') { // R[3040] snd1 (local -> remote)
						const body1 = res.body;
						try {
							if (!remConn || !remConn.socket)
								console.log(dt, threadId, localServerName, ...redError('snd4: R[3040] snd1.err:'), ...redError('remConn.socket is null'));
							else
								remConn.socket.write(body1,
									err => err && console.log(dt, threadId, localServerName, ...redError('snd4: R[3040] snd1.err:'), ...redError(err)));

							// R[3050]
							const res = await rpc(threadId, 'GET', 'snd2',
								{ x: 'R[3050]', serverName, serverId, serviceName, connectionId });
							if (res.status !== '200 OK')
								console.log(dt, threadId, localServerName, ...redError('snd2: R[3050] snd2.sts: ' + res.status));
						} catch (err) {
							// TODO
							console.log(dt, threadId, localServerName, ...redError('snd2: R[3050] snd2.err:'), ...redError(err));
						}
					}
					else if (cmd === 'snd6') { // L[3230] snd6 (remote -> local)
						const locConn = localConnections.get(connectionId);
						if (!locConn || !locConn.socket)
							console.log(dt, threadId, localServerName, 'snd8:', connectionId, 'L[3230]', ...redError('locConn.socket is null'));
						else
							locConn.socket.write(res.body,
								err => err && console.log(dt, threadId, localServerName, 'snd8:', connectionId, 'L[3230]', ...redError(err)));
						// TODO
					}
					else if (cmd === 'end1') { // R[end1.xxxx] end1
						remConn && remConn.end() ||
							console.log(dt, threadId, COLOR_MAGENTA + localServerName, 'end1:', connectionId, 'remConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'end6') { // R[end6.xxxx] end6
						const locConn = localConnections.get(connectionId);
						locConn && locConn.end() ||
							console.log(dt, threadId, COLOR_MAGENTA + localServerName, 'end6:', connectionId, 'locConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'disc') { // X[0190] disc disconnect
						// TODO
						console.log(getNow(), threadId, ...redError('disc'));
					}
					else {
						console.log(dt, threadId, ...redError(localServerName + ' recv: cmd.err: \"' + cmd + '\"'));
						throw new Error('cmd: ' + cmd + ' eh!?');
					}
					waitSeconds = 0;
				}
				catch (err) {
					waitSeconds = Math.floor(10 * (waitSeconds * 1.2 + 1)) / 10;
					if (waitSeconds > 10) waitSeconds = 10;
					const ws = Number((waitSeconds * (1 + i / 10)).toFixed(3));
					console.log(getNow(), threadId, ...redError(localServerName + ' recv: err:'),
						...redError(err), 'wait:', ws, 'sec');

					await sleep(200 + ws * 1000);
				}
			}
		}
	}

	/**
	 * rpc
	 * @param {number} num
	 * @param {string} method
	 * @param {string} cmd
	 * @param {any} args
	 * @param {any} body
	 * @returns any {status, options, body}
	 */
	async function rpc(num, method, cmd, args, body = null) {
		console.log(getNow(), num, COLOR_GREEN + localServerName, cmd + ': ' + myStringify(args) + COLOR_RESET);
		if (body && method !== 'POST')
			console.log(getNow(), num, ...redError(method + ' method has body'));
		else if (!body && method !== 'GET')
			console.log(getNow(), num, ...redError(method + ' method does not have body'));
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
		// 	console.log(dt, num, localServerName, 'rpc.res', COLOR_CYAN + res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + COLOR_RESET);
		// console.log(dt, num, localServerName, 'rpc.res', COLOR_CYAN + 'body [' + res.body.toString() + ']' + COLOR_RESET);

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
