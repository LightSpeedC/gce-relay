// @ts-check

'use strict';

module.exports = frequentErrors;

/**
 * frequentErrors
 * @param {Error | any} err 
 * @returns 
 */
function frequentErrors(err) {
	return !err ? String(err) :
		err.code === 'ECONNREFUSED' ||
		err.code === 'ECONNRESET' ||
		err.code === 'EPIPE' ||
		err.code === 'ERR_STREAM_WRITE_AFTER_END' ||
		err.code === 'ERR_STREAM_DESTROYED' ||
		err.code === 'ERR_STREAM_ALREADY_FINISHED';
}
