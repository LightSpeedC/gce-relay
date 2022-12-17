// @ts-check

'use strict';

const DateTime = require('date-time-string');

module.exports = getNow;

/**
 * getNow
 * @param {Date | undefined} dt 
 * @returns string date-time-string
 */
function getNow(dt = new Date()) {
	return DateTime.toDateTimeString(dt);
}
