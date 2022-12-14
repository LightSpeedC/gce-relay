// @ts-check

'use strict';

const COLOR_RESET = '\x1b[m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RED_BOLD = '\x1b[31;1m';

module.exports = relay;

const getNow = require('../lib/get-now');
const myStringify = require('../lib/my-stringify');
const redError = require('../lib/red-error');
const stream2buffer = require('../lib/stream2buffer');

/*
relayOptions: {
	serverName
	port
	serviceName
	connectionId
	remoteSeqNo
	localSeqNo
	command
}

connectionIdはDate.now().toString(36) + '.' + 連番で良い
remoteSeqNoは0から
localSeqNoは0から
command
	new
	end
	snd1
	recv
*/

const envConfig = require('./env-config');
const { xRelayCommand, xRelayOptions, xRelayStatus } = envConfig;

// servers
const servers = new Map();
/*
[serverName]: {
	serverId: 'serverId',
	remoteServiceList: [],
	remoteServices: {
		[remoteServiceName]: {
			//
		},
	},
}
*/

// connections
// const connections = new Map();

/**
 * relay
 * @param {*} req request
 * @param {*} res response
 * @param {*} log logger function
 * @param {string} dt Date and Time string
 * @returns 
 */
async function relay(req, res, log, dt) {
	const relayCommand = req.headers[xRelayCommand] || '';
	const relayOptions = req.headers[xRelayOptions] ?
		JSON.parse(req.headers[xRelayOptions]) : {};
	log.trace(dt, '##' + COLOR_GREEN, relayCommand + ':', myStringify(relayOptions) + COLOR_RESET);

	const data = await stream2buffer(req);

	function resOK(cmd, args, body = undefined) {
		const sts = '200 OK';
		res.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			[xRelayStatus]: sts,
			[xRelayCommand]: cmd,
			[xRelayOptions]: JSON.stringify(args),
		});
		body && res.write(body, err => err && log.warn(dt, '@@', ...redError(err)));
		res.end();
		log.trace(getNow() + '.' + dt.substr(-4), '@@' + COLOR_CYAN,
			cmd + ':', myStringify(args) + COLOR_RESET);
	}

	function resNG(cmd, args, body = undefined) {
		const sts = '400 Bad Request';
		res.writeHead(400, {
			'Content-Type': 'application/octet-stream',
			[xRelayStatus]: sts,
			[xRelayCommand]: cmd,
			[xRelayOptions]: JSON.stringify(args),
		});
		body && res.write(body, err => err && log.warn(dt, '@@', ...redError(err)));
		res.end();
		log.warn(dt, '@@' + COLOR_RED_BOLD, sts, cmd + ':', myStringify(args) + COLOR_RESET);
	}

	switch (relayCommand) {
		case 'recv': // C[0110] recv
			{
				const { serverName, serverId, remoteServiceList } = relayOptions;
				let svr = servers.get(serverName);
				if (svr && svr.serverId !== serverId) {
					// TODO release or dealloc
					log.error(dt, '***RELOAD***', serverName, serverId, '<-', svr.serverId);

					// 不要な受信を返す(受信していないと思うけど)
					while (true) {
						const func = svr.recvs.shift();
						if (!func) break;
						// C[0180] disc disconnect
						func.resNG('disc', { x: 'C[0180.discon]', serverName, serverId, remoteServiceList });
					}

					servers.delete(serverName);
					svr = null;
				}
				if (svr) {
					svr.recvs.push({ resOK, resNG });
					if (svr.sends.length) svr.sends.shift()();
				}
				else {
					servers.set(serverName, {
						serverName, serverId, remoteServiceList,
						remoteServices: remoteServiceList.reduce((prev, curr) => {
							prev[curr] = {
								// TODO remoteServices
								// recvs: [],
								// sends: [],
							};
							return prev;
						}, {}),
						recvs: [],
						sends: [],
					});
					const serverList = Array.from(servers)
						.filter(([svrNm]) => svrNm !== serverName)
						.map(([_, svr]) => ({
							serverId: svr.serverId,
							remoteServiceList: svr.remoteServiceList
						}));
					// C[0120] init
					resOK('init', { x: 'C[0120]', serverName, serverId, remoteServiceList, serverList });
					servers.forEach((svr, svrNm) => {
						if (svrNm != serverName) {
							const func = svr.recvs.shift();
							if (!func) return log.error('init.func:', 'serverId:', serverId);
							func.resOK('init', {
								x: 'C[0130]',
								serverName: svr.serverName,
								serverId: svr.serverId,
								remoteServiceList: svr.remoteServiceList,
								serverList: Array.from(servers)
									.filter(([svrNm]) => svrNm !== svr.serverName)
									.map(([_, svr2]) => ({
										serverId: svr2.serverId,
										remoteServiceList: svr2.remoteServiceList
									}))
							});
						}
					});
				}
			}
			return;
		case 'conn': // C[2010] conn
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const locSvr = servers.get(serverName);
				if (!locSvr) {
					resNG('conn.err', { x: 'C[2010]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('eh!? server not found');
				}
				// if (svr.serverId === serverId) throw new Error('eh!?');
				log.trace('locSvr.serverId:', locSvr.serverId, 'serverId:', serverId);
				let remoteServerName = '';
				servers.forEach((remSvr, svrNm) => {
					if (remSvr.remoteServices[serviceName]) {
						remoteServerName = svrNm;
					}
				});

				// C[2100] conn
				if (remoteServerName) {
					const remSvr = servers.get(remoteServerName);
					const func = remSvr.recvs.shift();
					if (!func) {
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('conn', { x: 'C[2100]', serverName, serverId, serviceName, connectionId });
							resOK('con2', { x: 'C[2020]', connectionId });
						});
						// resNG('conn.err', { serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						return; // 'conn.err eh!? no buffers'
					}
					// log.trace(COLOR_RED_BOLD, { serverName, serverId, serviceName, connectionId }, COLOR_RESET);
					// log.trace(COLOR_RED_BOLD, remSvr, COLOR_RESET);
					func.resOK('conn', { x: 'C[2100]', serverName, serverId, serviceName, connectionId });
					resOK('con2', { x: 'C[2020]', connectionId });
				}
				else {
					resNG('conn.err', { x: 'C[2105]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('conn.err eh!? remote service not found');
				}
			}
			return;
		case 'con1': // C[2210] con1 resOK
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const locSvr = servers.get(serverName);
				if (!locSvr) {
					resNG('con1.err', { x: 'C[2210]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('con1.err eh!? server not found');
				}

				const func = locSvr.recvs.shift();
				if (!func) {
					locSvr.sends.push(() => {
						const func = locSvr.recvs.shift();
						func.resOK('con3', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
						resOK('con4', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
					});
					// resNG('con1.err', { x: 'C[2210]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					return; // 'con1.err eh!? no buffers'
				}
				// C[2220] con1
				func.resOK('con3', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
				resOK('con4', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
			}
			return;
		case 'snd1': // C[3020] snd1 (local svc -> remote svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const locSvr = servers.get(serverName);
				if (!locSvr) {
					resNG('snd1.err', { x: 'C[3020]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('snd1.err eh!? server not found');
				}
				let remoteServerName = '';
				servers.forEach((svr, svrNm) => {
					// log.trace(COLOR_GREEN, svrNm, svr, COLOR_RESET);
					if (svr.remoteServices[serviceName]) {
						remoteServerName = svrNm;
					}
				});

				// C[3030] snd1
				if (remoteServerName) {
					const remSvr = servers.get(remoteServerName);
					const func = remSvr.recvs.shift();
					if (!func) {
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('snd1', { x: 'C[3030]', ...relayOptions }, data);
							resOK('snd2', { x: 'C[3030]', ...relayOptions });
						});
						// resNG('snd1.err', { x: 'C[3030]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						return; // 'snd1.err eh!? no buffers');
					}
					func.resOK('snd1', { x: 'C[3030]', ...relayOptions }, data);
					resOK('snd2', { x: 'C[3030]', ...relayOptions });
				}
				else {
					resNG('snd1.err', { x: '[3030]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('snd1.err eh!? remote service not found');
				}
			}
			return;
		case 'snd6': // C[3210] snd6 (remote svc -> local svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const svr = servers.get(serverName);
				if (!svr) {
					resNG('snd6.err', { x: 'C[3210.snd6.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('snd6.err eh!? server not found');
				}

				const func = svr.recvs.shift();
				if (!func) {
					svr.sends.push(() => {
						const func = svr.recvs.shift();
						func.resOK('snd6', { x: 'C[3220]', ...relayOptions }, data);
						resOK('snd7', { x: 'C[3220]', ...relayOptions });
					});
					// resNG('snd6.err', { x: 'C[3210.snd6.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					return; // 'snd6.err eh!? no buffers'
				}
				// C[3220]
				func.resOK('snd6', { x: 'C[3220]', ...relayOptions }, data);
				resOK('snd7', { x: 'C[3220]', ...relayOptions });
			}
			return;
		case 'end1': // [xxxx] end
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const svr = servers.get(serverName);
				if (!svr) {
					resNG('end.err', { x: '[end1.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('end.err eh!? server not found');
				}
				let remoteServerName = '';
				servers.forEach((val, key) => {
					if (val.remoteServices[serviceName]) {
						remoteServerName = key;
					}
				});

				// [end1.xxxx]
				if (remoteServerName) {
					const remSvr = servers.get(remoteServerName);
					const func = remSvr.recvs.shift();
					if (!func) {
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('end1', { x: '[end1]', ...relayOptions });
							resOK('end2', { x: '[end1.xxxx]', ...relayOptions });
						});
						// resNG('end.err', { x: '[end1.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						return; // 'end1.err eh!? no buffers'
					}
					func.resOK('end1', { x: '[end1]', ...relayOptions });
				}
				else {
					resNG('end1.err', { x: '[end1.xxxx]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('end.err eh!? remote service not found');
				}
				resOK('end2', { x: '[end1.xxxx]', ...relayOptions });
			}
			return;
		case 'end6': // [end6.xxxx] end6 (remote svc -> local svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const svr = servers.get(serverName);
				if (!svr) {
					resNG('end6.err', { x: '[end6.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('end6.err eh!? server not found');
				}

				const func = svr.recvs.shift();
				if (!func) {
					svr.sends.push(() => {
						const func = svr.recvs.shift();
						func.resOK('end6', { x: '[end6.xxxx]', ...relayOptions }, data);
						resOK('end7', { x: '[end6.xxxx]', ...relayOptions });
					});
					// resNG('end6.err', { x: '[end6.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					return; // 'end6.err eh!? no buffers'
				}
				// [end6.xxxx]
				func.resOK('end6', { x: '[end6.xxxx]', ...relayOptions }, data);
				resOK('end7', { x: '[end6.xxxx]', ...relayOptions });
			}
			return;
		case 'snd2': // C[3060]
			resOK('snd3', {x:'C[3060]', ...relayOptions});
		case 'else':
			break;
		default:
			resNG('cmd.err', { command: relayCommand });
			throw new Error('cmd = ' + relayCommand);
	}
	// const {
	// 	serverName,
	// 	port,
	// 	serviceName,
	// 	connectionId,
	// 	remoteSeqNo,
	// 	localSeqNo,
	// 	command
	// } = relayOptions;

	resOK(relayCommand, relayOptions);
}
