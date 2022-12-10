// @ts-check

'use strict';

const RELEASE = '2022-12-10 10:34 JST Release (since 2022-11-21)';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const DateTime = require('date-time-string');
const dnsReverse = require('./dns-reverse');
const dnsResolve = require('./dns-resolve');
const relay = require('./relay');
const envConfig = require('./env-config');

const PORT = 80;
const COLOR_REGEXP = /\x1b\[[0-9;]*m/g;
const COLOR_RESET = '\x1b[m';
const COLOR_GREEN_BOLD = '\x1b[32;1m';
const GENERIC_USER_TIMEOUT = 3000;

const STARTED = getNow() + ' Started';
const CRLF = '\r\n';

const { stdout } = process;

// mkdir logs
const LOGS_ROOT = path.resolve(__dirname, '../../gce-relay-logs');

let w = null;
let yyyymmdd = '00000000';
logRotate();

// mkdirSync
function mkdirSync(dir, num, dt) {
	try {
		fs.mkdirSync(dir);
	} catch (err) {
		if (err.code !== 'EEXIST') {
			console.error(err);
			fs.writeFileSync('../../' + dt + '-' + num + '.log',
				err + os.EOL + err.stack + os.EOL);
			process.exit(1);
		}
	}
}

// favicon
const IMAGES_PATH = path.resolve(__dirname, 'images');
const FAVICON = fs.readFileSync(path.resolve(IMAGES_PATH, 'icons8-rgb-circle2-color-96.png'));

let seq = 0;
function getSeq() {
	const s = String(seq);
	seq = (seq + 1) % 10000;
	return ('0000' + s).substr(-4);
}

// logRotate
function logRotate() {
	const DATE_TIME = getNow().replace(/-/g, '').replace(/ /g, '-')
		.replace(/:/g, '').replace(/\./g, '-');
	const YYYYMMDD = DATE_TIME.substring(0, 8);
	if (yyyymmdd === YYYYMMDD) return;
	yyyymmdd = YYYYMMDD;
	const YYYYMM = DATE_TIME.substring(0, 6);

	// mkdir logs
	mkdirSync(LOGS_ROOT, '0', DATE_TIME);
	mkdirSync(path.resolve(LOGS_ROOT, YYYYMM), '1', DATE_TIME);
	const LOGS_PATH = path.resolve(LOGS_ROOT, YYYYMM, YYYYMMDD);
	mkdirSync(LOGS_PATH, '2', DATE_TIME);
	const LOG_FILE = path.resolve(LOGS_PATH, DATE_TIME + '.log');
	if (w) w.close();
	w = fs.createWriteStream(LOG_FILE);
}

// map<string, {date: Date, clientNames: string}>
const cacheMap = new Map();
const CLEAR_CACHE_INTERVAL_TIMER = 3 * 3600 * 1000; // 3 hours.
const CLEAR_CACHE_TIMEOUT = 24 * 3600 * 1000; // 24 hours.
setInterval(() => {
	const dt = new Date();
	cacheMap.forEach((val, key) => {
		const deltaTime = dt.valueOf() - val.date.valueOf();
		if (deltaTime > CLEAR_CACHE_TIMEOUT) {
			log(getNow(dt) + '      ?? delete cache ip:', key, 'time:', deltaTime, 'msec', val.clientNames);
			cacheMap.delete(key);
		}
	});
}, CLEAR_CACHE_INTERVAL_TIMER);

// http.server
http.createServer((req, res) => {
	const dtStart = new Date();
	const dt = getNow(dtStart) + '-' + getSeq();
	const reqUrl = req.url || '';
	const clientIp = (req.socket.remoteAddress || '').replace('::ffff:', '');
	const serverIp = req.headers.host || req.socket.localAddress || '';
	const reqVer = 'HTTP/' + req.httpVersion;
	processRequest().catch(err => {
		log(dt, '//', err);
		log(dt, '//', err.stack);
		console.error(err);
	});
	async function processRequest() {
		try {
			const ent = cacheMap.get(clientIp);
			let clientNames = ent && ent.clientNames || '';
			if (!clientNames) {
				const clientNameList = await dnsReverse(clientIp);
				const list = await Promise.all(clientNameList.filter(x => !x.match(/\d*\.\d*\.\d*\.\d*/)).map(dnsResolve));
				list.forEach(x => x.forEach(y => !clientNameList.includes(y) && clientNameList.push(y)));
				clientNames = clientNameList.join(', ');
				cacheMap.set(clientIp, { date: dtStart, clientNames });
			}
			const serverIpUrl = serverIp + (reqUrl.startsWith('/') ? '' : ' ') + reqUrl;
			let info = [clientNames, req.method, serverIpUrl, reqVer].join(' ');
			logRotate();
			log(dt, '::', info);

			// relayPath
			if (reqUrl === envConfig.relayPath &&
				req.headers[envConfig.xRelayCommand] &&
				req.headers[envConfig.xRelayOptions]) {
				return await relay(req, res, log, dt);
			}
			if (reqUrl === envConfig.relayPath)
				log(dt, '%%', req.method, reqUrl, 'protocol error');

			// favicon
			if (req.method === 'GET' && reqUrl === '/favicon.ico') {
				res.writeHead(200, { 'Content-Type': 'image/png' });
				res.end(FAVICON);
				return;
			}

			res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
			for (let i = 0; i < req.rawHeaders.length; i += 2) {
				log(dt, '== ' + req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
				info += CRLF + req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1];
			}

			let writeFlag = false;
			const reqBody = await new Promise((resolve, reject) => {
				let reqBody = '';
				req.on('error', reject);
				req.on('data', data => {
					if (data) {
						const str = data.toString();
						reqBody += str;
						log(dt, '$$', str);
						writeFlag = true;
					}
				});
				req.on('end', () => {
					if (writeFlag) log(dt, '$$ $$$EOF$$$');
					resolve(reqBody);
				});
			});

			const deltaTime = Date.now() - dtStart.valueOf();
			log(dt, '**', deltaTime.toLocaleString(), 'msec.');

			const msg = `
<h1>Hello, ${clientNames}</h1>
<h2>${req.method} ${serverIpUrl} ${reqVer}</h2>
<hr>

<b>YOUR REQUEST INFO:</b>
<pre>
${info}
</pre>

<hr>

${reqBody ? '<b>REQUEST BODY:</b>\n<pre>' + reqBody + '</pre>\n<hr>' : ''}

<pre>
${dt} Access, ${deltaTime.toLocaleString()} msec.
${STARTED}
${RELEASE}
</pre>
`;

			res.write(msg);
			setTimeout(() => res.end('Did you wait for my response? :-)\n'), GENERIC_USER_TIMEOUT);
		} catch (err) {
			log(dt, err + os.EOL + err.stack);
			try {
				res.end('err');
			}
			catch (err) {
				log(dt, err + os.EOL + err.stack);
			}
		}
	}
}).listen(PORT, () => log(getNow(), COLOR_GREEN_BOLD +
	`        port ${PORT}, listening started` + COLOR_RESET));

// getNow
function getNow(dt = new Date()) {
	return DateTime.toDateTimeString(dt);
}

// log
function log(...args) {
	const msg = args.reduce((prev, curr) => {
		prev += ' ' + String(curr);
		return prev;
	}, '').substring(1) + os.EOL;
	stdout.write(msg);
	w && w.write(msg.replace(COLOR_REGEXP, ''));
}
