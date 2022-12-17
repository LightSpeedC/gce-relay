// @ts-check

'use strict';

const dns = require('dns');

module.exports = dnsResolve;

/**
 * dnsReverse
 * @param {string} hostname 
 * @returns string[]
 */
function dnsResolve(hostname) {
	return new Promise(resolve => {
		if (hostname.startsWith('::'))
			return resolve([hostname]);
		dns.resolve(hostname, (err, ips) =>
			resolve(!err ? ips :
				err.code === 'ENOTFOUND' ? [hostname] :
					[hostname, 'dns.resolve(' + hostname + '): ' + err + '']));
	});
}
