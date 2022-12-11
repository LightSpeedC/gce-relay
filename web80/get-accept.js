// @ts-check

'use strict';

const os = require('os');

module.exports = getAccept;

// log(dt, '# Accept:', getAccept(dt, req.headers.accept || ''));

/**
 * getAccept
 * @param {string} dt Date and Time string
 * @param {string} accept Accept: string
 * @returns 
 */
function getAccept(dt, accept = '') {
	try {
		const accepts = accept.split(',').reduce((prev, curr) => {
			const [key, rest] = curr.split('/');
			if (!prev[key]) prev[key] = [];
			prev[key].push(rest);
			return prev;
		}, {});
		return Object.keys(accepts).map(key => {
			return key + '/' + '(' + accepts[key].join(',') + ')';
		}).join('| ');
	} catch (err) {
		console.log(dt, err + os.EOL + err.stack);
		return 'getAccept() ' + err;
	}
}
