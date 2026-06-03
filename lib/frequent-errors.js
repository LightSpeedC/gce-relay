// @ts-check

'use strict';

module.exports = frequentErrors;

/**
 * frequentErrors
 * @param {Error | any} err 
 * @returns boolean
 */
function frequentErrors(err) {
	return !err ? String(err) :
		err.code === 'ECONNREFUSED' ||
		err.code === 'ECONNRESET' ||
		err.code === 'ECONNABORTED' ||
		err.code === 'EPIPE' ||
		err.code === 'ENOTFOUND' ||
		err.code === 'ERR_SOCKET_CLOSED_BEFORE_CONNECTION' ||
		err.code === 'ERR_STREAM_WRITE_AFTER_END' ||
		err.code === 'ERR_STREAM_DESTROYED' ||
		err.code === 'ERR_STREAM_ALREADY_FINISHED';
}
