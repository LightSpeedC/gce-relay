// client-proxy-http.js

// @ts-check

'use strict';

const net = require('net');

const httpRequest = require('./http-request');
const uniqId = require('./uniq-id');
const getNow = require('../lib/get-now');
const redError = require('../lib/red-error');
const myStringify = require('../lib/my-stringify');
const http = require('http');
const { stdout } = require('process');

const AGENT_KEEP_ALIVE = { keepAlive: false };

console.log(getNow());

// Content-Type: application/octet-stream
// Content-Type: application/json; charset=UTF-8

const targetURL = process.argv[2];
const proxyURL = process.argv[3];
const envNo = Number(process.argv[4] || '0');

const envConfig = envNo === 0 ? require('./env-config') :
	envNo === 1 ? require('./env-config1') :
		envNo === 2 ? require('./env-config2') :
			envNo === 3 ? require('./env-config3') :
				envNo === 4 ? require('./env-config4') :
					envNo === 5 ? require('./env-config5') :
						require('./env-config');
const { serverName, timeOut } = envConfig;
const localServerName = serverName;
const serverId = uniqId(serverName).split('.').slice(0, 2).join('.');
const { xRelayCommand, xRelayOptions, xRelayStatus } = envConfig;
const MAX_THREADS = envConfig.maxThreads || 4;
const DATA_TIMEOUT = 50; // msec

const COLOR_RESET = '\x1b[m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_MAGENTA = '\x1b[35m';

// connections
const localConnections = new Map();
const remoteConnections = new Map();

logInit();
main(log).catch(console.error);

async function main(log) {
	// L:Local
	envConfig.localServices.forEach(x => {
		// L[1010]
		const { port, serviceName } = x;
		const server = net.createServer({
			allowHalfOpen: true,
		}, async (soc) => {
			// L[1030]
			const connectionId = uniqId('ConnId');
			let agent = new http.Agent(AGENT_KEEP_ALIVE);
			try {
				// L[2000] conn
				const res1 = await rpc(agent, port, 'GET', 'conn',
					{ x: 'L[2000]', serverName, serverId, port, serviceName, connectionId });
				// L[2030] con2
				if (res1.status !== '200 OK')
					log.warn(getNow(), port, serverName, serviceName, 'L[2030] conn.status:', res1.status);

				let dataList = [], dataLength = 0, dataTimer = null;

				const locConn = {
					socket: soc,
					status: 'connecting',
					localSeqNo: 0,
					remoteSeqNo: 0,
					sends: {},
					flushLocal() {
						while (this.sends[this.remoteSeqNo]) {
							this.sends[this.remoteSeqNo]();
							delete this.sends[this.remoteSeqNo];
							this.remoteSeqNo++;
						}
					},
					writeLocal(remSeqNo, data, onErr) {
						this.sends[remSeqNo] = () => {
							this.socket.write(data, onErr);
							log.trace(getNow(), port, serverName, 'wrlc:', serviceName, connectionId, 'remSeqNo:', remSeqNo, 'writeLocal');
						};
						this.flushLocal();
					},
					endLocal(remSeqNo) {
						this.sends[remSeqNo] = () => {
							log.trace(getNow(), port, serverName, 'edlc:', serviceName, connectionId, 'remSeqNo:', remSeqNo, 'endLocal', !!this.socket);
							if (this.socket) this.socket.end();
							// @ts-ignore
							this.socket = null;
						};
						this.flushLocal();
					},
				};
				localConnections.set(connectionId, locConn);

				// L[3000] data (local)
				soc.on('data', async (data) => {
					dataList.push(data);
					dataLength += data.length;
					stdout.write(` data[${data.length.toLocaleString()}]`);

					if (!dataTimer)
						dataTimer = setTimeout(async () => {
							try {
								stdout.write(`\r\nTotal[${dataLength.toLocaleString()}]\r\n`);
								// log.warn(getNow(), port, COLOR_MAGENTA + serverName, 'data:', serviceName, 'L[3000] ' + connectionId + COLOR_RESET, 'size:', dataList.length);

								dataTimer = null;
								const data = Buffer.concat(dataList, dataLength);
								dataList = [];
								dataLength = 0;

								log.trace(getNow(), port, COLOR_MAGENTA + serverName, 'data:', serviceName, 'L[3000] ' + connectionId + COLOR_RESET);
								// L[3010]
								const res = await rpc(agent, port, 'POST', 'snd1',
									{ x: 'L[3010]', serverName, port, serviceName, connectionId, localSeqNo: locConn.localSeqNo++ }, data);
								if (res.status !== '200 OK')
									log.warn(getNow(), port, serverName, serviceName, ...redError('conn.snd1.sts: ' + res.status));
							} catch (err) {
								release('soc.data.snd1.err:', ...redError(err));
							}
						}, DATA_TIMEOUT);
				});
				soc.on('error', async (err) => {
					try {
						log.warn(getNow(), port, ...redError(serverName + ' err1: ' + serviceName + ' L[soc.err]:'), ...redError(err));
						// L[err.xxxx]
						const res = await rpc(agent, port, 'GET', 'end1',
							{ x: 'L[err.xxxx]', serverName, port, serviceName, connectionId, localSeqNo: locConn.localSeqNo++ });
						if (res.status !== '200 OK')
							log.warn(getNow(), port, serverName, serviceName, ...redError('soc.err.end.sts: ' + res.status));
						release('soc.err:', ...redError(err), connectionId);
					} catch (err) {
						release('soc.err.err:', ...redError(err), connectionId);
					}
				});
				soc.on('end', async () => {
					try {
						log.warn(getNow(), port, COLOR_MAGENTA + serverName, 'end1:', serviceName, connectionId + COLOR_RESET);
						// L[end1.xxxx]
						const res = await rpc(agent, port, 'GET', 'end1',
							{ x: 'L[end1.xxxx]', serverName, port, serviceName, connectionId, localSeqNo: locConn.localSeqNo++ });
						if (res.status !== '200 OK')
							log.warn(getNow(), port, serverName, 'end1:', serviceName, ...redError('end1.sts: ' + res.status));
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
				log.warn(getNow(), port, COLOR_MAGENTA + serverName, 'rels:', serviceName, '[release]', ...args, COLOR_RESET);
				locConn && locConn.endLocal(locConn.remoteSeqNo);
				localConnections.delete(connectionId);
			}
		});
		server.on('error', err => // L[1090] server.error
			log.trace(getNow(), port, serverName, 'svrx:', serviceName, 'L[1090] svr.err:', ...redError(err)));
		server.listen(port, () => // L[1020] server.listen
			log.trace(getNow(), port, serverName, 'svrx:', serviceName, 'L[1020] svr.listen'));
	});

	await sleep(1000);

	const remoteServiceList = Object.keys(envConfig.remoteServices);

	let waitSeconds = 0;

	// X: Local/Remote: recv
	for (let i = 0; i < MAX_THREADS; ++i) {
		await sleep(i * 1000);
		thread(1000 + i, i);
		async function thread(threadId, i) {
			let agent = new http.Agent(AGENT_KEEP_ALIVE);

			while (true) {
				try {
					// X[0100] recv
					const res = await rpc(agent, threadId, 'GET', 'recv',
						{ x: 'X[0100]', serverName, serverId, remoteServiceList, timeOut });
					if (res.res && res.res.statusCode !== 200)
						console.log('recv: X[0100]', res.res.statusCode, res.res.statusMessage);
					if (res.res && res.res.statusCode === 503)
						process.exit(2);
					const dt = getNow();
					if (res.status !== '200 OK')
						log.warn(dt, threadId, localServerName, 'X[0100] recv.status:', res.status);
					const cmd = res.command;
					const { serviceName, connectionId } = res.options;
					const remConn = remoteConnections.get(connectionId);
					const svc = envConfig.remoteServices[serviceName];
					log.trace(dt, threadId, COLOR_CYAN + localServerName, // 'recv:',
						cmd + ':', myStringify(res.options) + COLOR_RESET);

					if (cmd === 'conn') { // R[2110] conn
						// log.trace(dt, threadId, localServerName, ...redError('[2110] conn: ' + svc));
						if (!svc) throw new Error('serviceName not found: eh!?');
						const { host, port } = svc;
						const { serverName, serverId } = res.options;
						log.trace(dt, threadId, localServerName, 'conn: from:', serverName, serverId,
							'to:', serviceName, connectionId);
						if (remConn) throw new Error('connectionId: eh!? already connected!?');

						let dataList = [], dataLength = 0, dataTimer = null;

						// R[2120] conn
						const soc = net.connect({ host, port }, async () => {
							// log.trace(dt, threadId, localServerName, ...redError('[2200] con1: ' + svc));
							// R[2200] con1
							try {
								const res = await rpc(agent, threadId, 'GET', 'con1',
									{ x: 'R[2200]', serverName, serverId, serviceName, connectionId });
								if (res.status !== '200 OK')
									log.warn(dt, threadId, localServerName, ...redError('R[2200] con1.sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn(dt, threadId, localServerName, 'R[2200] con1.err: ', ...redError(err));
							}
						});
						// R[2130] conn
						remoteConnections.set(connectionId, {
							socket: soc,
							status: 'connecting',
							localSeqNo: 0,
							remoteSeqNo: 0,
							sends: {},
							flushRemote() {
								while (this.sends[this.localSeqNo]) {
									this.sends[this.localSeqNo]();
									delete this.sends[this.localSeqNo];
									this.localSeqNo++;
								}
							},
							writeRemote(locSeqNo, data, onErr) {
								this.sends[locSeqNo] = () => {
									this.socket.write(data, onErr);
									log.trace(getNow(), threadId, 'wrrm:', localServerName, connectionId, 'locSeqNo:', locSeqNo, 'writeRemote');
								};
								this.flushRemote();
							},
							endRemote(locSeqNo) {
								log.trace(getNow(), threadId, 'edrm:', localServerName, connectionId, 'locSeqNo:', locSeqNo, 'endRemote', !!this.socket);
								if (this.socket) this.socket.end();
								// @ts-ignore
								this.socket = null;
							},
						});
						soc.on('data', async (data) => { // R[3200] snd6
							dataList.push(data);
							dataLength += data.length;
							stdout.write(` data[${data.length.toLocaleString()}]`);

							if (!dataTimer)
								dataTimer = setTimeout(async () => {
									try {
										stdout.write(`\r\nTotal[${dataLength.toLocaleString()}]\r\n`)
										// log.warn(getNow(), threadId, COLOR_MAGENTA + localServerName, 'snd6: R[3200] ' + connectionId + COLOR_RESET, 'size:', dataList.length);

										dataTimer = null;
										const data = Buffer.concat(dataList, dataLength);
										dataList = [];
										dataLength = 0;

										const res = await rpc(agent, threadId, 'POST', 'snd6',
											{ x: 'R[3200]', serverName, serverId, serviceName, connectionId, remoteSeqNo: remoteConnections.get(connectionId).remoteSeqNo++ }, data);
										if (res.status !== '200 OK')
											log.warn(dt, threadId, ...redError(localServerName + ' snd6: R[3200] sts: ' + res.status));
									} catch (err) {
										// TODO
										log.warn(dt, threadId, ...redError(localServerName + ' snd6: R[3200] err: '), ...redError(err));
									}
								}, DATA_TIMEOUT);
						});
						soc.on('error', async (err) => { // R[err6] err6.xxxx R[xxxx]
							log.warn(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId), ...redError(err));
							try {
								const res = await rpc(agent, threadId, 'GET', 'end6',
									{ x: 'R[err6]', serverName, serverId, serviceName, connectionId, remoteSeqNo: remoteConnections.get(connectionId).remoteSeqNo++ });
								if (res.status !== '200 OK')
									log.warn(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId + ' sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn(dt, threadId, ...redError(localServerName + ' err6: ' + connectionId + ' err:'), ...redError(err));
							}
						});
						soc.on('end', async () => { // R[end6.xxxx] end6 R[xxxx]
							try {
								const res = await rpc(agent, threadId, 'GET', 'end6',
									{ x: 'R[end6.xxxx]', serverName, serverId, serviceName, connectionId, remoteSeqNo: remoteConnections.get(connectionId).remoteSeqNo++ });
								if (res.status !== '200 OK')
									log.warn(dt, threadId, ...redError(localServerName + ' end6: sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn(dt, threadId, ...redError(localServerName + 'end6: err:'), ...redError(err));
							}
						});
					}
					else if (cmd === 'con3') { // L[2230.xxxx] con3
						const locConn = localConnections.get(connectionId);
						log.trace(dt, threadId, localServerName, 'con3:', connectionId);
						if (locConn.status !== 'connecting') throw new Error('eh!? L[2230] con1: status != connecting');
						locConn.status = 'connected';
					}
					else if (cmd === 'init') { // X[0140] init
						log.trace(dt, threadId, COLOR_CYAN + localServerName, 'init: X[0140]',
							myStringify(res.options) + COLOR_RESET);
					}
					else if (cmd === 'snd1') { // R[3040] snd1 (local -> remote)
						const body1 = res.body;
						const { localSeqNo } = res.options;
						try {
							if (!remConn || !remConn.socket) {
								log.warn(dt, threadId, localServerName, ...redError('snd4: R[3040] snd1.err:'), ...redError('remConn.socket is null'));
								try {
									const res1 = await rpc(agent, threadId, 'GET', 'end6',
										{ x: 'R[end6.zzzz]', serverName, serverId, serviceName, connectionId });
									if (res1.status !== '200 OK')
										log.warn(dt, threadId, ...redError(localServerName + ' end6: zzzz sts: ' + res1.status));
								} catch (err) {
									// TODO
									log.warn(dt, threadId, ...redError(localServerName + 'end6: zzzz err:'), ...redError(err));
								}
							}
							else {
								try {
									remConn.writeRemote(localSeqNo, body1,
										err => err && console.log(dt, threadId, localServerName, ...redError('snd4: R[3041] snd1.err:'), ...redError(err)));
									// remConn.socket.write(body1,
									// 	err => err && console.log(dt, threadId, localServerName, ...redError('snd4: R[3041] snd1.err:'), ...redError(err)));
								} catch (err) {
									if (err.code === 'EPIPE')
										log.warn(dt, threadId, localServerName, ...redError('snd4: R[3042] snd1.err: ' + err));
									else
										log.warn(dt, threadId, localServerName, ...redError('snd4: R[3043] snd1.err:'),
											...redError(err));
									// TODO
									remConn.endRemote(remConn.localSeqNo);
									try {
										const res = await rpc(agent, threadId, 'GET', 'end6',
											{ x: 'R[end6.yyyy]', serverName, serverId, serviceName, connectionId });
										if (res.status !== '200 OK')
											log.warn(dt, threadId, ...redError(localServerName + ' end6: yyyy sts: ' + res.status));
									} catch (err) {
										// TODO
										log.warn(dt, threadId, ...redError(localServerName + 'end6: yyyy err:'), ...redError(err));
									}
								}
							}

							// R[3050]
							const res = await rpc(agent, threadId, 'GET', 'snd2',
								{ x: 'R[3050]', serverName, serverId, serviceName, connectionId });
							if (res.status !== '200 OK')
								log.warn(dt, threadId, localServerName, ...redError('snd2: R[3050] snd2.sts: ' + res.status));
						} catch (err) {
							// TODO
							log.warn(dt, threadId, localServerName, ...redError('snd2: R[3050] snd2.err:'), ...redError(err));
						}
					}
					else if (cmd === 'snd6') { // L[3230] snd6 (remote -> local)
						const { remoteSeqNo } = res.options;
						const locConn = localConnections.get(connectionId);
						if (locConn && locConn.socket)
							locConn.writeLocal(remoteSeqNo, res.body,
								err => err && log.warn(dt, threadId, localServerName, 'snd8:', connectionId, 'L[3230]', ...redError(err)));
						else
							log.warn(dt, threadId, localServerName, 'snd8:', connectionId, 'L[3230]', ...redError('locConn.socket is null'));
					}
					else if (cmd === 'end1') { // R[end1.xxxx] end1
						const { localSeqNo } = res.options;
						remConn && remConn.endRemote(localSeqNo) ||
							log.debug(dt, threadId, COLOR_MAGENTA + localServerName, 'end1:', connectionId, 'remConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'end6') { // R[end6.xxxx] end6
						const locConn = localConnections.get(connectionId);
						const { remoteSeqNo } = res.options;
						locConn && locConn.endLocal(remoteSeqNo) ||
							log.debug(dt, threadId, COLOR_MAGENTA + localServerName, 'end6:', connectionId, 'locConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'time') { // time timeOut
						// TODO
						log.warn(getNow(), threadId, 'time');
					}
					else if (cmd === 'disc') { // X[0190] disc disconnect
						// TODO
						log.error(getNow(), threadId, ...redError('disc'));
					}
					else {
						log.fatal(dt, threadId, ...redError(localServerName + ' recv: cmd.err: \"' + cmd + '\"'));
						agent.destroy();
						agent = new http.Agent(AGENT_KEEP_ALIVE);
						throw /*new Error*/ ('cmd: ' + cmd + ' eh!?');
					}
					waitSeconds = 0;
				}
				catch (err) {
					waitSeconds = Math.floor(10 * (waitSeconds * 1.2 + 1)) / 10;
					if (waitSeconds > 10) waitSeconds = 10;
					const ws = Number((waitSeconds * (1 + i / 10)).toFixed(3));
					log.warn(getNow(), threadId, ...redError(localServerName + ' recv: err:'),
						...redError(err), 'wait:', ws, 'sec');

					await sleep(200 + ws * 1000);
				}
			}
		}
	}

	/**
	 * rpc
	 * @param {http.Agent} agent
	 * @param {number} num
	 * @param {string} method
	 * @param {string} cmd
	 * @param {Object} args
	 * @param {Buffer | undefined} body
	 * @returns any {status, options, body}
	 */
	async function rpc(agent, num, method, cmd, args, body = undefined) {
		log.trace(getNow(), num, COLOR_GREEN + localServerName, cmd + ': ' + myStringify(args) + COLOR_RESET);
		if (body && method !== 'POST')
			log.error(getNow(), num, ...redError(method + ' method has body'));
		else if (!body && method !== 'GET')
			log.error(getNow(), num, ...redError(method + ' method does not have body'));
		if (body) convertBuffer(body);
		const res = await httpRequest({
			method, body, targetURL, proxyURL, agent,
			headers: {
				[xRelayCommand]: cmd,
				[xRelayOptions]: JSON.stringify(args),
			},
		});
		if (res.res && res.res.statusCode !== 200)
			console.log('rpc: cd:', res.res.statusCode, res.res.statusMessage);
		// const dt = getNow();
		// for (let i = 0; i < res.rawHeaders.length; i += 2)
		// 	log.trace(dt, num, localServerName, 'rpc.res', COLOR_CYAN + res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + COLOR_RESET);
		// log.trace(dt, num, localServerName, 'rpc.res', COLOR_CYAN + 'body [' + res.body.toString() + ']' + COLOR_RESET);

		if (res.body && res.body.length > 0) convertBuffer(res.body);
		const options = res.headers[xRelayOptions];
		return {
			command: res.headers[xRelayCommand],
			status: res.headers[xRelayStatus],
			options: options ? JSON.parse(options) : {},
			headers: res.headers,
			rawHeaders: res.rawHeaders,
			body: res.body,
			res: res.res,
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

// log
function log(...args) {
	// const msg = args.reduce((prev, curr) => {
	// 	prev += ' ' + String(curr);
	// 	return prev;
	// }, '').substring(1);
	console.log(...args);
}

// logInit
function logInit() {
	// @ts-ignore
	log.trace = noop;
	// @ts-ignore
	log.info = noop;
	// @ts-ignore
	log.debug = noop;
	// @ts-ignore
	log.warn = log;
	// @ts-ignore
	log.error = log;
	// @ts-ignore
	log.fatal = log;
	function noop() { }
}
