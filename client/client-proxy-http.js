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
const LOG_LEVEL = require('../lib/log-level');
const AGENT_KEEP_ALIVE = { keepAlive: true };

console.log(getNow());

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
const { sv, timeOut, xRelayOptions, logLevel, bufferingDelay } = envConfig;
const locSv = sv;
const svID = uniqId(sv).split('.').slice(0, 2).join('.');
const MAX_THREADS = envConfig.maxThreads || 4;
const DATA_TIMEOUT = bufferingDelay || 50; // msec

const COLOR_RESET = '\x1b[m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_MAGENTA = '\x1b[35m';
const COLOR_BLUE = '\x1b[34m';

// connections
const localConnections = new Map();
const remoteConnections = new Map();

logInit();
main(log).catch(console.error);

async function main(log) {
	// L:Local
	envConfig.locSvc.forEach(x => {
		// L[1010]
		const { port, svc } = x;
		const server = net.createServer({
			allowHalfOpen: true,
		}, async (soc) => {
			// L[1030]
			const cID = uniqId('cID');
			let agent = new http.Agent(AGENT_KEEP_ALIVE);
			try {
				// L[2000] conn
				const res1 = await rpc(agent, port, 'GET', 'conn',
					{ x: 'L[2000]', sv, svID, port, svc, cID });
				// L[2030] con2
				if (res1.status !== 200)
					log.warn && log.warn(getNow(), port, sv, svc, 'L[2030] conn.status:', res1.status);

				let dataList = [], dataLength = 0, dataTimer = null;

				const locConn = {
					socket: soc,
					status: 'connecting',
					locSeq: 0,
					remSeq: 0,
					sends: {},
					flushLocal() {
						while (this.sends[this.remSeq]) {
							this.sends[this.remSeq]();
							delete this.sends[this.remSeq];
							this.remSeq++;
						}
					},
					writeLocal(seq, data, onErr) {
						this.sends[seq] = () => {
							this.socket.write(data, onErr);
							log.trace && log.trace(getNow(), port, sv, 'wrlc:', svc, cID, 'r#:', seq, 'writeLocal');
						};
						this.flushLocal();
					},
					endLocal(seq) {
						this.sends[seq] = () => {
							log.trace && log.trace(getNow(), port, sv, 'edlc:', svc, cID, 'r#:', seq, 'endLocal', !!this.socket);
							if (this.socket) this.socket.end();
							// @ts-ignore
							this.socket = null;
						};
						this.flushLocal();
					},
				};
				localConnections.set(cID, locConn);

				soc.on('data', async (data) => { // L[3000] data
					dataList.push(data);
					dataLength += data.length;

					if (!dataTimer)
						dataTimer = setTimeout(async () => {
							try {
								log.info && log.info(getNow(), port, COLOR_GREEN + sv, 'data:', svc, 'L[3000] ' + cID + COLOR_RESET, 'size:', dataLength, ...(dataList.length > 1 ? ['[', ...dataList.map(x => x.length), ']']: []));

								dataTimer = null;
								const data = Buffer.concat(dataList, dataLength);
								dataList = [];
								dataLength = 0;

								log.trace && log.trace(getNow(), port, COLOR_MAGENTA + sv, 'data:', svc, 'L[3000] ' + cID + COLOR_RESET);
								// L[3010]
								const res = await rpc(agent, port, 'POST', 'snd1',
									{ x: 'L[3010]', sv, port, svc, cID, locSeq: locConn.locSeq++ }, data);
								if (res.status !== 200)
									log.warn && log.warn(getNow(), port, sv, svc, ...redError('conn.snd1.sts: ' + res.status));
							} catch (err) {
								errorRelease('soc.data.snd1.err:', ...redError(err));
							}
						}, DATA_TIMEOUT);
				});
				soc.on('error', async (err) => {
					try {
						log.warn && log.warn(getNow(), port, ...redError(sv + ' err1: ' + svc + ' L[soc.err]:'), ...redError(err));
						// L[err.xxxx]
						const res = await rpc(agent, port, 'GET', 'end1',
							{ x: 'L[err.xxxx]', sv, port, svc, cID, locSeq: locConn.locSeq++ });
						if (res.status !== 200)
							log.warn && log.warn(getNow(), port, sv, svc, ...redError('soc.err.end.sts: ' + res.status));
						okRelease('soc.err:', ...redError(err), cID);
					} catch (err) {
						errorRelease('soc.err.err:', ...redError(err), cID);
					}
				});
				soc.on('end', async () => {
					try {
						log.debug && log.debug(getNow(), port, COLOR_MAGENTA + sv, 'end1:', svc, cID + COLOR_RESET);
						// L[end1.xxxx]
						const res = await rpc(agent, port, 'GET', 'end1',
							{ x: 'L[end1.xxxx]', sv, port, svc, cID, locSeq: locConn.locSeq++ });
						if (res.status !== 200)
							log.warn && log.warn(getNow(), port, sv, 'end1:', svc, ...redError('end1.sts: ' + res.status));
						okRelease('soc.end:', cID);
					} catch (err) {
						errorRelease('soc.end.err:', ...redError(err), cID);
					}
				});
			} catch (err) {
				errorRelease('soc.conn.err:', ...redError(err));
			};
			function errorRelease(...args) {
				log.warn && log.warn(getNow(), port, COLOR_MAGENTA + sv, 'rels:', svc, '[release]', ...args, COLOR_RESET);
				commonRelease();
			}
			function okRelease(...args) {
				log.info && log.info(getNow(), port, COLOR_MAGENTA + sv, 'rels:', svc, '[release]', ...args, COLOR_RESET);
				commonRelease();
			}
			function commonRelease() {
				const locConn = localConnections.get(cID);
				locConn && locConn.endLocal(locConn.remSeq);
				localConnections.delete(cID);
			}
		});
		server.on('error', err => // L[1090] server.error
			log.trace && log.trace(getNow(), port, sv, 'svrx:', svc, 'L[1090] svr.err:', ...redError(err)));
		server.listen(port, () => // L[1020] server.listen
			log.trace && log.trace(getNow(), port, sv, 'svrx:', svc, 'L[1020] svr.listen'));
	});

	await sleep(1000);

	const rSvcL = Object.keys(envConfig.remSvc);

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
						{ x: 'X[0100]', sv, svID, rSvcL, timeOut });
					if (res.res && res.res.statusCode !== 200)
						console.log('recv: X[0100]', res.res.statusCode, res.res.statusMessage);
					if (res.res && res.res.statusCode === 503)
						process.exit(2);
					const dt = getNow();
					if (res.status !== 200)
						log.warn && log.warn(dt, threadId, locSv, 'X[0100] recv.status:', res.status);
					const cmd = res.command;
					const { svc, cID } = res.options;
					const remConn = remoteConnections.get(cID);
					const hostPort = envConfig.remSvc[svc];
					log.trace && log.trace(dt, threadId, COLOR_CYAN + locSv, // 'recv:',
						cmd + ':', myStringify(res.options) + COLOR_RESET);

					if (cmd === 'conn') { // R[2110] conn
						// log.trace && log.trace(dt, threadId, locSv, ...redError('[2110] conn: '), hostPort);
						if (!hostPort) throw new Error('svc not found: eh!?');
						const { host, port } = hostPort;
						const { sv, svID } = res.options;
						log.trace && log.trace(dt, threadId, locSv, 'conn: from:', sv, svID,
							'to:', svc, cID);
						if (remConn) throw new Error('cID: eh!? already connected!?');

						let dataList = [], dataLength = 0, dataTimer = null;

						// R[2120] conn
						const soc = net.connect({ host, port }, async () => {
							// log.trace && log.trace(dt, threadId, locSv, ...redError('[2200] con1:'), hostPort);
							// R[2200] con1
							try {
								const res = await rpc(agent, threadId, 'GET', 'con1',
									{ x: 'R[2200]', sv, svID, svc, cID });
								if (res.status !== 200)
									log.warn && log.warn(dt, threadId, locSv, ...redError('R[2200] con1.sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn && log.warn(dt, threadId, locSv, 'R[2200] con1.err: ', ...redError(err));
							}
						});
						// R[2130] conn
						remoteConnections.set(cID, {
							socket: soc,
							status: 'connecting',
							locSeq: 0,
							remSeq: 0,
							sends: {},
							flushRemote() {
								while (this.sends[this.locSeq]) {
									this.sends[this.locSeq]();
									delete this.sends[this.locSeq];
									this.locSeq++;
								}
							},
							writeRemote(seq, data, onErr) {
								this.sends[seq] = () => {
									this.socket.write(data, onErr);
									log.trace && log.trace(getNow(), threadId, 'wrrm:', locSv, cID, 'l#:', seq, 'writeRemote');
								};
								this.flushRemote();
							},
							endRemote(seq) {
								log.trace && log.trace(getNow(), threadId, 'edrm:', locSv, cID, 'l#:', seq, 'endRemote', !!this.socket);
								if (this.socket) this.socket.end();
								// @ts-ignore
								this.socket = null;
							},
						});
						soc.on('data', async (data) => { // R[3200] snd6
							dataList.push(data);
							dataLength += data.length;

							if (!dataTimer)
								dataTimer = setTimeout(async () => {
									try {
										log.info && log.info(getNow(), threadId, COLOR_GREEN + locSv, 'snd6: R[3200] ' + cID + COLOR_RESET, 'size:', dataLength, ...(dataList.length > 1 ? ['[', ...dataList.map(x => x.length), ']']: []));

										dataTimer = null;
										const data = Buffer.concat(dataList, dataLength);
										dataList = [];
										dataLength = 0;

										const res = await rpc(agent, threadId, 'POST', 'snd6',
											{ x: 'R[3200]', sv, svID, svc, cID, remSeq: remoteConnections.get(cID).remSeq++ }, data);
										if (res.status !== 200)
											log.warn && log.warn(dt, threadId, ...redError(locSv + ' snd6: R[3200] sts: ' + res.status));
									} catch (err) {
										// TODO
										log.warn && log.warn(dt, threadId, ...redError(locSv + ' snd6: R[3200] err: '), ...redError(err));
									}
								}, DATA_TIMEOUT);
						});
						soc.on('error', async (err) => { // R[err6] err6.xxxx R[xxxx]
							log.warn && log.warn(dt, threadId, ...redError(locSv + ' err6: ' + cID), ...redError(err));
							try {
								const res = await rpc(agent, threadId, 'GET', 'end6',
									{ x: 'R[err6]', sv, svID, svc, cID, remSeq: remoteConnections.get(cID).remSeq++ });
								if (res.status !== 200)
									log.warn && log.warn(dt, threadId, ...redError(locSv + ' err6: ' + cID + ' sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn && log.warn(dt, threadId, ...redError(locSv + ' err6: ' + cID + ' err:'), ...redError(err));
							}
						});
						soc.on('end', async () => { // R[end6.xxxx] end6 R[xxxx]
							try {
								const res = await rpc(agent, threadId, 'GET', 'end6',
									{ x: 'R[end6.xxxx]', sv, svID, svc, cID, remSeq: remoteConnections.get(cID).remSeq++ });
								if (res.status !== 200)
									log.warn && log.warn(dt, threadId, ...redError(locSv + ' end6: sts: ' + res.status));
							} catch (err) {
								// TODO
								log.warn && log.warn(dt, threadId, ...redError(locSv + 'end6: err:'), ...redError(err));
							}
						});
					}
					else if (cmd === 'con3') { // L[2230.xxxx] con3
						const locConn = localConnections.get(cID);
						log.trace && log.trace(dt, threadId, locSv, 'con3:', cID, locConn ? 'exists' : 'not exists');
						if (!locConn || locConn.status !== 'connecting') throw new Error('eh!? L[2230] con1: status != connecting');
						locConn.status = 'connected';
					}
					else if (cmd === 'init') { // X[0140] init
						log.trace && log.trace(dt, threadId, COLOR_CYAN + locSv, 'init: X[0140]',
							myStringify(res.options) + COLOR_RESET);
					}
					else if (cmd === 'snd1') { // R[3040] snd1 (local -> remote)
						const body1 = res.body;
						const { locSeq } = res.options;
						try {
							if (!remConn || !remConn.socket) {
								log.warn && log.warn(dt, threadId, locSv, ...redError('snd4: R[3040] snd1.err:'), ...redError('remConn.socket is null'));
								try {
									const res1 = await rpc(agent, threadId, 'GET', 'end6',
										{ x: 'R[end6.zzzz]', sv, svID, svc, cID });
									if (res1.status !== 200)
										log.warn && log.warn(dt, threadId, ...redError(locSv + ' end6: zzzz sts: ' + res1.status));
								} catch (err) {
									// TODO
									log.warn && log.warn(dt, threadId, ...redError(locSv + 'end6: zzzz err:'), ...redError(err));
								}
							}
							else {
								try {
									remConn.writeRemote(locSeq, body1,
										err => err && console.log(dt, threadId, locSv, ...redError('snd4: R[3041] snd1.err:'), ...redError(err)));
								} catch (err) {
									if (err.code === 'EPIPE')
										log.warn && log.warn(dt, threadId, locSv, ...redError('snd4: R[3042] snd1.err: ' + err));
									else
										log.warn && log.warn(dt, threadId, locSv, ...redError('snd4: R[3043] snd1.err:'),
											...redError(err));
									// TODO
									remConn.endRemote(remConn.locSeq);
									try {
										const res = await rpc(agent, threadId, 'GET', 'end6',
											{ x: 'R[end6.yyyy]', sv, svID, svc, cID });
										if (res.status !== 200)
											log.warn && log.warn(dt, threadId, ...redError(locSv + ' end6: yyyy sts: ' + res.status));
									} catch (err) {
										// TODO
										log.warn && log.warn(dt, threadId, ...redError(locSv + 'end6: yyyy err:'), ...redError(err));
									}
								}
							}

							// R[3050]
							const res = await rpc(agent, threadId, 'GET', 'snd2',
								{ x: 'R[3050]', sv, svID, svc, cID });
							if (res.status !== 200)
								log.warn && log.warn(dt, threadId, locSv, ...redError('snd2: R[3050] snd2.sts: ' + res.status));
						} catch (err) {
							// TODO
							log.warn && log.warn(dt, threadId, locSv, ...redError('snd2: R[3050] snd2.err:'), ...redError(err));
						}
					}
					else if (cmd === 'snd6') { // L[3230] snd6 (remote -> local)
						const { remSeq } = res.options;
						const locConn = localConnections.get(cID);
						if (locConn && locConn.socket)
							locConn.writeLocal(remSeq, res.body,
								err => err && log.warn && log.warn(dt, threadId, locSv, 'snd8:', cID, 'L[3230]', ...redError(err)));
						else
							log.warn && log.warn(dt, threadId, locSv, 'snd8:', cID, 'L[3230]', ...redError('locConn.socket is null'));
					}
					else if (cmd === 'end1') { // R[end1.xxxx] end1
						const { locSeq } = res.options;
						remConn && remConn.endRemote(locSeq) ||
							log.debug && log.debug(dt, threadId, COLOR_MAGENTA + locSv, 'end1:', cID, 'remConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'end6') { // R[end6.xxxx] end6
						const locConn = localConnections.get(cID);
						const { remSeq } = res.options;
						locConn && locConn.endLocal(remSeq) ||
							log.debug && log.debug(dt, threadId, COLOR_MAGENTA + locSv, 'end6:', cID, 'locConn.socket closed' + COLOR_RESET);
					}
					else if (cmd === 'time') { // time timeOut
						// TODO
						log.warn && log.warn(getNow(), threadId, COLOR_BLUE + 'time' + COLOR_RESET);
					}
					else if (cmd === 'disc') { // X[0190] disc disconnect
						// TODO
						log.error && log.error(getNow(), threadId, ...redError('disc'));
					}
					else {
						log.fatal && log.fatal(dt, threadId, ...redError(locSv + ' recv: cmd.err: \"' + cmd + '\"'));
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
					log.warn && log.warn(getNow(), threadId, ...redError(locSv + ' recv: err:'),
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
		log.trace && log.trace(getNow(), num, COLOR_GREEN + locSv, cmd + ': ' + myStringify(args) + COLOR_RESET);
		if (body && method !== 'POST')
			log.error && log.error(getNow(), num, ...redError(method + ' method has body'));
		else if (!body && method !== 'GET')
			log.error && log.error(getNow(), num, ...redError(method + ' method does not have body'));
		if (body) convertBuffer(body);
		const res = await httpRequest({
			method, body, targetURL, proxyURL, agent,
			headers: {
				[xRelayOptions]: JSON.stringify(Object.assign({ cmd }, args)),
			},
		});
		if (res.res && res.res.statusCode !== 200)
			console.log(getNow(), 'rpc: cd:', res.res.statusCode, res.res.statusMessage);
		// const dt = getNow();
		// for (let i = 0; i < res.rawHeaders.length; i += 2)
		// 	log.trace && log.trace(dt, num, locSv, 'rpc.res', COLOR_CYAN + res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1] + COLOR_RESET);
		// log.trace && log.trace(dt, num, locSv, 'rpc.res', COLOR_CYAN + 'body [' + res.body.toString() + ']' + COLOR_RESET);

		if (res.body && res.body.length > 0) convertBuffer(res.body);
		const options = JSON.parse(res.headers[xRelayOptions] || '{}');
		return {
			command: options.cmd,
			status: options.sts,
			options: options,
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
	log.trace = LOG_LEVEL.TRACE >= logLevel ? log : null;
	// @ts-ignore
	log.info = LOG_LEVEL.INFO >= logLevel ? log : null;
	// @ts-ignore
	log.debug = LOG_LEVEL.DEBUG >= logLevel ? log : null;
	// @ts-ignore
	log.warn = LOG_LEVEL.WARN >= logLevel ? log : null;
	// @ts-ignore
	log.error = LOG_LEVEL.ERROR >= logLevel ? log : null;
	// @ts-ignore
	log.fatal = LOG_LEVEL.FATAL >= logLevel ? log : null;
}
