// @ts-check

'use strict';

const os = require('os');

module.exports = getAccept;

// log(dt, '# Accept:', getAccept(dt, req.headers.accept || ''));

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
		console.log(dt, err + os.EOL + err.stack);
		return 'getAccept() ' + err;
	}
}
