module.exports = {
	sv: 'server-name',
	locSvc: [
		{
			port: 1080,
			svc: 'remote-service-name',
		},
		{
			port: 2080,
			svc: 'remote-service-name2',
		},
	],
	remSvc: {
		'remote-service-name': {
			host: 'localhost',
			port: 80,
		},
		'remote-service-name2': {
			host: 'localhost',
			port: 80,
		},
	},
	xRelayOptions: 'x-relay-options',
	xRelayCode: 0x00,
	maxThreads: 4,
};
