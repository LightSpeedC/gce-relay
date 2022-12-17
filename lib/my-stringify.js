// @ts-check

'use strict';

module.exports = myStringify;

function myStringify(obj) {
	return JSON.stringify(obj)
		.replace(/\"/g, '')
		.replace(/,/g, ', ')
		.replace(/port/g, 'p')
		.replace(/remSeq/g, 'r#')
		.replace(/locSeq/g, 'l#');
}
