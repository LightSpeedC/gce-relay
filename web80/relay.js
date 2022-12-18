// @ts-check

'use strict';

const COLOR_RESET = '\x1b[m';
const COLOR_GREEN = '\x1b[32m';
const COLOR_CYAN = '\x1b[36m';
const COLOR_RED_BOLD = '\x1b[31;1m';

module.exports = relay;

const { xRelayOptions } = require('./env-config');
const getNow = require('../lib/get-now');
const myStringify = require('../lib/my-stringify');
const redError = require('../lib/red-error');
const stream2buffer = require('../lib/stream2buffer');

/*
relayOptions: {
	sv -- serverName
	port
	svc -- serviceName
	cID -- connectionID
	remSeq -- remote sequence number
	locSeq -- local sequence number
	command
	timeOut
}

cIDはDate.now().toString(36) + '.' + 連番で良い
remSeqは0から
locSeqは0から
command
	new
	end
	snd1
	recv
*/

// servers
const servers = new Map();
/*
[sv]: {
	svID: 'svID', // serverID
	rSvcL: [], // remoteServiceList
	remSvc: { // removeServices
		[svc]: { // serviceName
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
 * @param {object} opts options
 * @returns 
 */
async function relay(req, res, log, dt, opts) {
	const cmd = opts.cmd;
	log.trace && log.trace(dt, '##' + COLOR_GREEN, cmd + ':', myStringify(opts) + COLOR_RESET);

	// if (log.trace) {
	// 	log.trace('req.method:', req.method, ' req.headers:',
	// 		JSON.stringify(req.headers, null, '\t')
	// 			.replace(/\\\"/g, '')
	// 			.replace(/\"/g, ''));
	// }

	const data = await stream2buffer(req);
	let timer = null;

	function resOK(cmd, args, body = undefined) {
		if (timer) { clearTimeout(timer); timer = null; }
		const sts = 200;
		res.writeHead(sts, {
			'Content-Type': 'application/octet-stream',
			[xRelayOptions]: JSON.stringify(Object.assign({ sts, cmd }, args)),
		});
		body && res.write(body, err => err && log.warn && log.warn(dt, '@@', ...redError(err)));
		res.end();
		log.trace && log.trace(getNow() + '.' + dt.substr(-4), '@@' + COLOR_CYAN,
			cmd + ':', myStringify(args) + COLOR_RESET);
	}

	function resNG(cmd, args, body = undefined) {
		if (timer) { clearTimeout(timer); timer = null; }
		const sts = 400;
		res.writeHead(sts, {
			'Content-Type': 'application/octet-stream',
			[xRelayOptions]: JSON.stringify(Object.assign({ sts, cmd }, args)),
		});
		body && res.write(body, err => err && log.warn && log.warn(dt, '@@', ...redError(err)));
		res.end();
		log.warn && log.warn(dt, '@@' + COLOR_RED_BOLD, sts, cmd + ':', myStringify(args) + COLOR_RESET);
	}

	switch (cmd) {
		case 'recv': // C[0110] recv
			{
				const { sv, svID, rSvcL, timeOut } = opts;
				let svr = servers.get(sv);
				if (svr && svr.svID !== svID) {
					// TODO release or dealloc
					log.error && log.error(dt, '***RELOAD***', sv, svID, '<-', svr.svID);

					// 不要な受信を返す(受信していないと思うけど)
					while (true) {
						const func = svr.recvs.shift();
						if (!func) break;
						// C[0180] disc disconnect
						func.resNG('disc', { x: 'C[0180.discon]', sv, svID, rSvcL });
					}

					servers.delete(sv);
					svr = null;
				}
				if (svr) {
					const func = { resOK, resNG };
					if (timeOut) timer = setTimeout(() => {
						if (timer) timer = null;
						const ii = svr.recvs.findIndex(f => f == func);
						if (ii >= 0) {
							const ff = svr.recvs.splice(ii, 1);
							ff[0].resOK('time', {});
						}
					}, timeOut * 1000);
					svr.recvs.push(func);
					if (svr.sends.length) svr.sends.shift()();
				}
				else {
					servers.set(sv, {
						sv, svID, rSvcL,
						remSvc: rSvcL.reduce((prev, curr) => {
							prev[curr] = {
								// TODO remSvc
								// recvs: [],
								// sends: [],
							};
							return prev;
						}, {}),
						recvs: [],
						sends: [],
					});
					const svL = Array.from(servers)
						.filter(([svrNm]) => svrNm !== sv)
						.map(([_, svr]) => ({
							svID: svr.svID,
							rSvcL: svr.rSvcL
						}));
					// C[0120] init
					resOK('init', { x: 'C[0120]', sv, svID, rSvcL, svL });
					servers.forEach((svr, svrNm) => {
						if (svrNm != sv) {
							const func = svr.recvs.shift();
							if (!func) return log.error && log.error('init.func:', 'svID:', svID);
							func.resOK('init', {
								x: 'C[0130]',
								sv: svr.sv,
								svID: svr.svID,
								rSvcL: svr.rSvcL,
								svL: Array.from(servers)
									.filter(([svrNm]) => svrNm !== svr.sv)
									.map(([_, svr2]) => ({
										svID: svr2.svID,
										rSvcL: svr2.rSvcL
									}))
							});
						}
					});
				}
			}
			return;
		case 'conn': // C[2010] conn
			{
				const { sv, svID, svc, cID } = opts;
				const locSvr = servers.get(sv);
				if (!locSvr) {
					resNG('conn.err', { x: 'C[2010]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('conn.err: C[2010]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('eh!? server not found');
				}
				// if (svr.svID === svID) throw new Error('eh!?');
				log.trace && log.trace('locSvr.svID:', locSvr.svID, 'svID:', svID);
				let remSv = '';
				servers.forEach((remSvr, svrNm) => {
					if (remSvr.remSvc[svc]) {
						remSv = svrNm;
					}
				});

				// C[2100] conn
				if (remSv) {
					const remSvr = servers.get(remSv);
					const func = remSvr.recvs.shift();
					if (!func) {
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('conn', { x: 'C[2100]', sv, svID, svc, cID });
							resOK('con2', { x: 'C[2020]', cID });
						});
						// resNG('conn.err', { sv, svID, svc, cID, message: 'no buffers' });
						return; // 'conn.err eh!? no buffers'
					}
					// log.trace && log.trace(COLOR_RED_BOLD, { sv, svID, svc, cID }, COLOR_RESET);
					// log.trace && log.trace(COLOR_RED_BOLD, remSvr, COLOR_RESET);
					func.resOK('conn', { x: 'C[2100]', sv, svID, svc, cID });
					resOK('con2', { x: 'C[2020]', cID });
				}
				else {
					resNG('conn.err', { x: 'C[2105]', sv, svID, svc, cID, message: 'remote service not found' });
					log.fatal && log.fatal('conn.err: C[2105]', sv, svID, svc, cID, 'remote service not found');
					return; // throw new Error('conn.err eh!? remote service not found');
				}
			}
			return;
		case 'con1': // C[2210] con1 resOK
			{
				const { sv, svID, svc, cID } = opts;
				const locSvr = servers.get(sv);
				if (!locSvr) {
					resNG('con1.err', { x: 'C[2210]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('con1.err: C[2210]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('con1.err eh!? server not found');
				}

				const func = locSvr.recvs.shift();
				if (!func) {
					locSvr.sends.push(() => {
						const func = locSvr.recvs.shift();
						func.resOK('con3', { x: 'C[2220]', sv, svID, svc, cID });
						resOK('con4', { x: 'C[2220]', sv, svID, svc, cID });
					});
					// resNG('con1.err', { x: 'C[2210]', sv, svID, svc, cID, message: 'no buffers' });
					return; // 'con1.err eh!? no buffers'
				}
				// C[2220] con1
				func.resOK('con3', { x: 'C[2220]', sv, svID, svc, cID });
				resOK('con4', { x: 'C[2220]', sv, svID, svc, cID });
			}
			return;
		case 'snd1': // C[3020] snd1 (local service -> remote service)
			{
				const { sv, svID, svc, cID } = opts;
				const locSvr = servers.get(sv);
				if (!locSvr) {
					resNG('snd1.err', { x: 'C[3020]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('snd1.err: C[3020]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('snd1.err eh!? server not found');
				}
				let remSv = '';
				servers.forEach((svr, svrNm) => {
					// log.trace && log.trace(COLOR_GREEN, svrNm, svr, COLOR_RESET);
					if (svr.remSvc[svc]) {
						remSv = svrNm;
					}
				});

				// C[3030] snd1
				if (remSv) {
					const remSvr = servers.get(remSv);
					const func = remSvr.recvs.shift();
					if (!func) {
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('snd1', { x: 'C[3030]', ...opts }, data);
							resOK('snd2', { x: 'C[3030]', ...opts });
						});
						// resNG('snd1.err', { x: 'C[3030]', sv, svID, svc, cID, message: 'no buffers' });
						return; // 'snd1.err eh!? no buffers');
					}
					func.resOK('snd1', { x: 'C[3030]', ...opts }, data);
					resOK('snd2', { x: 'C[3030]', ...opts });
				}
				else {
					resNG('snd1.err', { x: 'C[3030]', sv, svID, svc, cID, message: 'remote service not found' });
					log.fatal && log.fatal('snd1.err: C[3030]', sv, svID, svc, cID, 'remote service not found');
					return; // throw new Error('snd1.err eh!? remote service not found');
				}
			}
			return;
		case 'snd6': // C[3210] snd6 (remote service -> local service)
			{
				const { sv, svID, svc, cID } = opts;
				const svr = servers.get(sv);
				if (!svr) {
					resNG('snd6.err', { x: 'C[3210.snd6.xxxx]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('snd6.err: C[3210]', sv, svID, svc, cID, 'remote service not found');
					return; // throw new Error('snd6.err eh!? server not found');
				}

				const func = svr.recvs.shift();
				if (!func) {
					svr.sends.push(() => {
						const func = svr.recvs.shift();
						func.resOK('snd6', { x: 'C[3220]', ...opts }, data);
						resOK('snd7', { x: 'C[3220]', ...opts });
					});
					// resNG('snd6.err', { x: 'C[3210.snd6.xxxx]', sv, svID, svc, cID, message: 'no buffers' });
					return; // 'snd6.err eh!? no buffers'
				}
				// C[3220]
				func.resOK('snd6', { x: 'C[3220]', ...opts }, data);
				resOK('snd7', { x: 'C[3220]', ...opts });
			}
			return;
		case 'end1': // [xxxx] end
			{
				const { sv, svID, svc, cID } = opts;
				const svr = servers.get(sv);
				if (!svr) {
					resNG('end1.err', { x: '[end1.xxxx1]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('end.err: [end1.xxxx1]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('end.err eh!? server not found');
				}
				let remSv = '';
				servers.forEach((val, key) => {
					if (val.remSvc[svc]) {
						remSv = key;
					}
				});

				// [end1.xxxx]
				if (remSv) {
					const remSvr = servers.get(remSv);
					const func = remSvr.recvs.shift();
					if (!func) { // no buffers then push sends
						remSvr.sends.push(() => {
							const func = remSvr.recvs.shift();
							func.resOK('end1', { x: '[end1.xxxx2]', ...opts });
							resOK('end2', { x: '[end1.xxxx2]', ...opts });
						});
						// resNG('end.err', { x: '[end1.xxxx3]', sv, svID, svc, cID, message: 'no buffers' });
						return;
					}
					func.resOK('end1', { x: '[end1.xxxx3]', ...opts });
				}
				else {
					resNG('end1.err', { x: '[end1.xxxx4]', sv, svID, svc, cID, message: 'remote service not found' });
					log.fatal && log.fatal('end1.err: [end1.xxxx4]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('end.err eh!? remote service not found');
				}
				resOK('end2', { x: '[end1.xxxx5]', ...opts });
			}
			return;
		case 'end6': // [end6.xxxx] end6 (remote service -> local service)
			{
				const { sv, svID, svc, cID } = opts;
				const svr = servers.get(sv);
				if (!svr) {
					resNG('end6.err', { x: '[end6.xxxx1]', sv, svID, svc, cID, message: 'server not found' });
					log.fatal && log.fatal('end6.err: [end6.xxxx1]', sv, svID, svc, cID, 'server not found');
					return; // throw new Error('end6.err eh!? server not found');
				}

				const func = svr.recvs.shift();
				if (!func) { // no buffers then push sends
					svr.sends.push(() => {
						const func = svr.recvs.shift();
						func.resOK('end6', { x: '[end6.xxxx2]', ...opts }, data);
						resOK('end7', { x: '[end6.xxxx3]', ...opts });
					});
					return;
				}
				// [end6.xxxx]
				func.resOK('end6', { x: '[end6.xxxx4]', ...opts }, data);
				resOK('end7', { x: '[end6.xxxx5]', ...opts });
			}
			return;
		case 'snd2': // C[3060]
			resOK('snd3', { x: 'C[3060]', ...opts });
		case 'else':
			break;
		default:
			resNG('cmd.err', { cmd });
			log.fatal && log.fatal('cmd.err: ?[xxxx] cmd:', cmd, 'not found');
			return; // throw new Error('cmd = ' + cmd);
	}
	// const {
	// 	sv, // serverName
	// 	port,
	// 	svc, // serviceName
	// 	cID, // connectionID
	// 	remSeq, // remoteSeqNo
	// 	locSeq, // localSeqNo
	// 	command
	// } = relayOptions;

	resOK(cmd, opts);
}
