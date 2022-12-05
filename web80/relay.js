// @ts-check

'use strict';

const COLOR_RESET = '\x1b[m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RED_BOLD = '\x1b[31;1m';

module.exports = relay;

const DateTime = require('date-time-string');
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
	send
	recv
*/

const stream2buffer = require('../lib/stream2buffer');

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

async function relay(req, res, log, dt) {
	const relayCommand = req.headers[xRelayCommand] || '';
	const relayOptions = req.headers[xRelayOptions] ?
		JSON.parse(req.headers[xRelayOptions]) : {};
	log(dt, '##' + COLOR_GREEN, relayCommand,
		JSON.stringify(relayOptions).replace(/\"/g, '').replace(/,/g, ', ') + COLOR_RESET);

	const data = await stream2buffer(req);

	function resOK(cmd, args, body = undefined) {
		const sts = '200 OK';
		res.writeHead(200, {
			'Content-Type': 'application/octet-stream',
			[xRelayStatus]: sts,
			[xRelayCommand]: cmd,
			[xRelayOptions]: JSON.stringify(args),
		});
		res.end(body);
		log(getNow() + '.' + dt.substr(-4), '@@' + COLOR_CYAN, sts, cmd,
			JSON.stringify(args).replace(/\"/g, '').replace(/,/g, ', ') + COLOR_RESET);
	}

	function resNG(cmd, args, body = undefined) {
		const sts = '400 Bad Request';
		res.writeHead(400, {
			'Content-Type': 'application/octet-stream',
			[xRelayStatus]: sts,
			[xRelayCommand]: cmd,
			[xRelayOptions]: JSON.stringify(args),
		});
		res.end(body);
		log(dt, '@@' + COLOR_RED_BOLD, sts, cmd,
			JSON.stringify(args).replace(/\"/g, '').replace(/,/g, ', ') + COLOR_RESET);
	}

	switch (relayCommand) {
		case 'recv': // C[0110] recv
			{
				const { serverName, serverId, remoteServiceList } = relayOptions;
				let svr = servers.get(serverName);
				if (svr && svr.serverId !== serverId) {
					// TODO release or dealloc
					console.log(dt, '***RELOAD***', serverName, serverId, '<-', svr.serverId);

					while (true) {
						const func = svr.recvs.shift();
						if (!func) break;
						// C[0180] disconnect
						func.resNG('disconnect', { x: '[discon]', serverName, serverId, remoteServiceList });
					}

					servers.delete(serverName);
					svr = null;
				}
				if (svr) {
					svr.recvs.push({ resOK, resNG });
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
				console.log('locSvr.serverId:', locSvr.serverId, 'serverId:', serverId);
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
						resNG('conn.err', { serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						throw new Error('conn.err eh!? no buffers');
					}
					// console.log(COLOR_RED_BOLD, { serverName, serverId, serviceName, connectionId }, COLOR_RESET);
					// console.log(COLOR_RED_BOLD, obj, COLOR_RESET);
					func.resOK('conn', { x: 'C[2100]', serverName, serverId, serviceName, connectionId });
					// C[2020]
					resOK('conn.ok1', { x: 'C[2020]', connectionId });
				}
				else {
					resNG('conn.err', { x: 'C[2105]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('conn.err eh!? remote service not found');
				}
			}
			return;
		case 'conn.ok': // C[2210] conn.ok resOK
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const locSvr = servers.get(serverName);
				if (!locSvr) {
					resNG('conn.ok.err', { x: 'C[2210]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('conn.ok.err eh!? server not found');
				}

				const func = locSvr.recvs.shift();
				if (!func) {
					resNG('conn.ok.err', { x: 'C[2210]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					throw new Error('conn.ok.err eh!? no buffers');
				}
				// C[2220] conn.ok
				func.resOK('conn.ok.ok', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
				resOK('conn.ok.ok2', { x: 'C[2220]', serverName, serverId, serviceName, connectionId });
			}
			return;
		case 'send': // C[3020] send (local svc -> remote svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const locSvr = servers.get(serverName);
				if (!locSvr) {
					resNG('send.err', { x: 'C[3020]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('send.err eh!? server not found');
				}
				let remoteServerName = '';
				servers.forEach((svr, svrNm) => {
					// console.log(COLOR_GREEN, svrNm, svr, COLOR_RESET);
					if (svr.remoteServices[serviceName]) {
						remoteServerName = svrNm;
					}
				});

				// [3030] send
				if (remoteServerName) {
					const remSvr = servers.get(remoteServerName);
					const func = remSvr.recvs.shift();
					if (!func) {
						// remSvr.sends.push(xxx);
						resNG('send.err', { x: '[3030]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						throw new Error('send.err eh!? no buffers');
					}
					func.resOK('send', { x: '[3030]', ...relayOptions }, data);
					resOK('send.ok', { x: '[3030]', ...relayOptions });
				}
				else {
					resNG('send.err', { x: '[3030]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('send.err eh!? remote service not found');
				}
			}
			return;
		case 'send2': // [3210] send2 (remote svc -> local svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const obj = servers.get(serverName);
				if (!obj) {
					resNG('send2.err', { x: '[3210.send2.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('send2.err eh!? server not found');
				}

				const func = obj.recvs.shift();
				if (!func) {
					// obj.sends.push(xxx);
					resNG('send2.err', { x: '[3210.send2.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					throw new Error('send2.err eh!? no buffers');
				}
				// [3220]
				func.resOK('send2', { x: '[3220]', ...relayOptions }, data);
				resOK('send2.ok', { x: '[3220]', ...relayOptions });
			}
			return;
		case 'end': // [xxxx] end
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const obj = servers.get(serverName);
				if (!obj) {
					resNG('end.err', { x: '[end.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('end.err eh!? server not found');
				}
				let remoteServerName = '';
				servers.forEach((val, key) => {
					if (val.remoteServices[serviceName]) {
						remoteServerName = key;
					}
				});

				// [end.xxxx]
				if (remoteServerName) {
					const obj = servers.get(remoteServerName);
					const func = obj.recvs.shift();
					if (!func) {
						// obj.sends.push(xxx);
						resNG('end.err', { x: '[end.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
						throw new Error('end.err eh!? no buffers');
					}
					func.resOK('end', relayOptions);
				}
				else {
					resNG('end.err', { x: '[end.xxxx]', serverName, serverId, serviceName, connectionId, message: 'remote service not found' });
					throw new Error('end.err eh!? remote service not found');
				}
				resOK('end.ok', { x: '[end.xxxx]', ...relayOptions });
			}
			return;
		case 'end2': // [end2.xxxx] end2 (remote svc -> local svc)
			{
				const { serverName, serverId, serviceName, connectionId } = relayOptions;
				const obj = servers.get(serverName);
				if (!obj) {
					resNG('end2.err', { x: '[end2.xxxx]', serverName, serverId, serviceName, connectionId, message: 'server not found' });
					throw new Error('end2.err eh!? server not found');
				}

				const func = obj.recvs.shift();
				if (!func) {
					// obj.sends.push(xxx);
					resNG('end2.err', { x: '[end2.xxxx]', serverName, serverId, serviceName, connectionId, message: 'no buffers' });
					throw new Error('end2.err eh!? no buffers');
				}
				// [end2.xxxx]
				func.resOK('end2', { x: '[end2.xxxx]', ...relayOptions }, data);
				resOK('end2.ok', { x: '[end2.xxxx]', ...relayOptions });
			}
			return;
		case 'send.ok':
			resOK('send.ok.ok', relayOptions);
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

// getNow
function getNow(dt = new Date()) {
	return DateTime.toDateTimeString(dt);
}
