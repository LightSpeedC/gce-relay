// @ts-check

'use strict';

const frequentErrors = require('./frequent-errors');

module.exports = redError;

const COLOR_RESET = '\x1b[m';
const COLOR_RED_BOLD = '\x1b[31;1m';

function redError(err) {
	return typeof err === 'string' || frequentErrors(err) ?
		[COLOR_RED_BOLD + err + COLOR_RESET] :
		[COLOR_RED_BOLD, err, COLOR_RESET];
}
