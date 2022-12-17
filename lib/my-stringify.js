// @ts-check

'use strict';

module.exports = myStringify;

function myStringify(obj) {
	return JSON.stringify(obj)
		.replace(/\"/g, '')
		.replace(/,/g, ', ')
		.replace(/serverId/g, 'svID')
		.replace(/serverName/g, 'svN')
		.replace(/serverList/g, 'svL')
		.replace(/serviceName/g, 'svcN')
		.replace(/remoteServiceList/g, 'rSvcL')
		.replace(/connectionId/g, 'cID')
		.replace(/port/g, 'p')
		.replace(/remoteSeqNo/g, 'r#')
		.replace(/localSeqNo/g, 'l#');
}
