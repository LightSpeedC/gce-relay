// @ts-check

'use strict';

module.exports = stream2buffer;

const { Stream } = require('stream');

/**
 * stream2buffer
 * @param {Stream} stream 
 * @returns Buffer
 */
 async function stream2buffer(stream) {
	return await new Promise((resolve, reject) => {
		const dataList = [];
		let dataLength = 0;
		stream.on('data', data => {
			dataList.push(data);
			dataLength += data.length;
		});
		stream.on('error', reject);
		stream.on('end', () => resolve(Buffer.concat(dataList, dataLength)));
	});
}
