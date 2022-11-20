// @ts-check

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const DateTime = require('date-time-string');

const PORT = 80;

const RELEASE = '2022-11-20 18:25 Release';
const STARTED = getNow() + ' Started';

const { stdout, stderr } = process;

// mkdir logs
const LOGS_PATH = path.resolve(__dirname, 'logs');
try {
	fs.mkdirSync(LOGS_PATH);
} catch (err) {
	if (err.code !== 'EEXIST') {
		console.error(err);
		process.exit(1);
	}
}

// favicon
const IMAGES_PATH = path.resolve(__dirname, 'images');
const FAVICON = fs.readFileSync(path.resolve(IMAGES_PATH, 'icons8-rgb-circle2-color-96.png'));

const LOG_FILE = path.resolve(LOGS_PATH,
	getNow().replace(/-/g, '').replace(/ /g, '-')
		.replace(/:/g, '').replace(/\./g, '-') + '.log');
console.log(LOG_FILE);
const w = fs.createWriteStream(LOG_FILE);

let seq = 0;
function getSeq() {
	const s = String(seq);
	seq = (seq + 1) % 1000;
	return ('0000' + s).substr(-4); 
}

http.createServer((req, res) => {
	const dt = getNow() + '[' + getSeq() + ']';
	log(dt, req.socket.remoteAddress, req.method, req.url);
	log(dt, '# Host:', req.headers.host);
	log(dt, '# Accept:', getAccept(req.headers.accept));

	// favicon
	if (req.method == 'GET' && req.url?.startsWith('/favicon.ico')) {
		res.writeHead(200, { 'content-type': 'image/png' });
		res.end(FAVICON);
		return;
	}

	res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
	// Object.keys(req.headers).forEach(x => {
	// 	log(dt, '- ' + x + ': ' + req.headers[x]);
	// });
	// for (let i = 0; i < req.rawHeaders.length; i += 2) {
	// 	log(dt, '= ' + req.rawHeaders[i] + ': ' + req.rawHeaders[i + 1]);
	// }

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
	if (req.method == 'GET' && req.url.startsWith('/time')) {
		res.write(msg + `
<hr>
...
`);
		return;
	}
	res.end(msg);
}).listen(PORT, () => console.log('started'));

function getNow(dt = new Date()) {
	return DateTime.toDateTimeString(dt);
}

function log(...args) {
	const msg = args.reduce((prev, curr) => {
		prev += ' ' + String(curr);
		return prev;
	}, '').substring(1) + os.EOL;
	stdout.write(msg);
	w.write(msg);
}

function getAccept(acc) {
	const obj = acc.split(',').reduce((prev, curr) => {
		const [key, rest] = curr.split('/');
		// log('key/rest', key, '/', rest);
		if (!prev[key]) prev[key] = [];
		prev[key].push(rest);
		return prev;
	}, {});
	return Object.keys(obj).map(key => {
		// log('まとめ', key, '/', obj[key]);
		return key + '/' + '(' + obj[key].join(',') + ')';
	}).join('| ');
}
