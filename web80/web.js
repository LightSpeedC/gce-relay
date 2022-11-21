// @ts-check

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const DateTime = require('date-time-string');

const PORT = 80;

const RELEASE = '2022-11-21 22:46 JST Release';
const STARTED = getNow() + ' Started';

const { stdout } = process;
const DATE_TIME = getNow().replace(/-/g, '').replace(/ /g, '-')
	.replace(/:/g, '').replace(/\./g, '-');
const YYYYMM = DATE_TIME.substring(0, 6);
const YYYYMMDD = DATE_TIME.substring(0, 8);

// mkdir logs
const LOGS_ROOT = path.resolve(__dirname, '../../gce-relay-logs');
mkdirSync(path.resolve(LOGS_ROOT, YYYYMM), '1');
mkdirSync(path.resolve(LOGS_ROOT, YYYYMM, YYYYMMDD), '2');
const LOGS_PATH = path.resolve(LOGS_ROOT, YYYYMM, YYYYMMDD);
const LOG_FILE = path.resolve(LOGS_PATH, DATE_TIME + '.log');
console.log(LOG_FILE);
const w = fs.createWriteStream(LOG_FILE);

// mkdirSync
function mkdirSync(dir, num) {
	try {
		fs.mkdirSync(dir);
	} catch (err) {
		if (err.code !== 'EEXIST') {
			console.error(err);
			fs.writeFileSync('../../' + DATE_TIME + '-' + num + '.log',
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

// http.server
http.createServer((req, res) => {
	const dt = getNow() + '-' + getSeq();
	try {
		const reqUrl = req.url || '';
		log(dt, req.socket.remoteAddress, req.method, reqUrl);
		// log(dt, '# Host:', req.headers.host);
		// log(dt, '# Accept:', getAccept(dt, req.headers.accept || ''));

		// favicon
		if (req.method === 'GET' && reqUrl.startsWith('/favicon.ico')) {
			res.writeHead(200, { 'content-type': 'image/png' });
			res.end(FAVICON);
			return;
		}

		res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
		// Object.keys(req.headers).forEach(x => {
		// 	log(dt, '- ' + x + ': ' + req.headers[x]);
		// });
		for (let i = 0; i < req.rawHeaders.length; i += 2) {
			log(dt, '= ' + req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
		}

		const msg = `<h1>Hello</h1>
hello
<hr>
<pre>
${dt} Access
${STARTED}
${RELEASE}
</pre>
`;

		// @ts-ignore
		if (req.method == 'GET' && reqUrl.startsWith('/time')) {
			res.write(msg + `
<hr>
...
`);
			return;
		}
		let writeFlag = false;
		req.on('data', data => (log(dt, '$', data.toString()), writeFlag = true));
		req.on('end', () => writeFlag && log(dt, '$$$EOF$$$'));
		res.end(msg);
	} catch (err) {
		log(dt, err + os.EOL + err.stack);
		res.end('err');
	}
}).listen(PORT, () => console.log('started'));

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
	w.write(msg);
}

// getAccept
function getAccept(dt, acc = '') {
	try {
		const obj = acc.split(',').reduce((prev, curr) => {
			const [key, rest] = curr.split('/');
			if (!prev[key]) prev[key] = [];
			prev[key].push(rest);
			return prev;
		}, {});
		return Object.keys(obj).map(key => {
			return key + '/' + '(' + obj[key].join(',') + ')';
		}).join('| ');
	} catch (err) {
		log(dt, err + os.EOL + err.stack);
		return 'getAccept() ' + err;
	}
}
