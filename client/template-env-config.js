module.exports = {
	serverName: 'server-name',
	localServices: [
		{
			port: 1080,
			serviceName: 'remote-service-name',
		},
		{
			port: 2080,
			serviceName: 'remote-service-name2',
		},
	],
	remoteServices: {
		'remote-service-name': {
			host: 'localhost',
			port: 80,
		},
		'remote-service-name2': {
			host: 'localhost',
			port: 80,
		},
	},
	xRelayCommand: 'x-relay-command',
	xRelayOptions: 'x-relay-options',
	xRelayStatus: 'x-relay-status',
	xRelayCode: 0x00,
};
