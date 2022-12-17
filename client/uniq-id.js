// @ts-check

'use strict';

module.exports = uniqId;

let uniqSeqNo = 0;

/**
 * uniqId
 * @param {string} id 
 * @returns string
 */
function uniqId(id) {
	return id + '.' + Date.now().toString(36) + '.' + inc();
}

/**
 * inc
 * @returns string
 */
function inc() {
	const no = uniqSeqNo;
	uniqSeqNo = (uniqSeqNo + 1) % 10000;
	return ('0000' + no).substr(-4);
}
