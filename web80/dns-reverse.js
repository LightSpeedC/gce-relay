// @ts-check

'use strict';

const dns = require('dns');

module.exports = dnsReverse;

/**
 * dnsReverse
 * @param {string} ip 
 * @returns string[]
 */
function dnsReverse(ip) {
	return new Promise(resolve =>
		dns.reverse(ip, (err, hostnames) =>
			resolve(!err ? [...hostnames, ip] :
				err.code === 'ENOTFOUND' ? [ip] :
					[ip, err + ''])));
}
