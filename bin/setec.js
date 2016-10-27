#!/usr/bin/env node

const fs  = require('fs');

const Setec = require('../index');

const configFile = ['.setec.json', process.env.HOME + '/.setec.json']
	.filter(f => fs.existsSync(f))[0];

const commandName = process.argv[2];
if (!commandName) {
	console.error('no command specified');
	process.exit(1);
}

if ((!configFile) && (commandName !== 'config')) {
	console.error('no config file found, please run \'setec config\'');
	process.exit(1);
}
const config = configFile ? JSON.parse(fs.readFileSync(configFile)) : null;
const setec  = config     ? new Setec(config)                       : null;

const commands = {
	config: () => {
		console.error('configuring');
	},
	list: () => {
		return setec.list().then(secrets => {
			secrets.forEach(key => console.log(key));
		});
	},
	get: () => {
		const key = process.argv[3];

		return setec.get(key).then(console.log);
	},
	set: () => {
		const key = process.argv[3];
		const val = process.argv[4];

		return setec.set(key, val).then(() => console.log('ok'));
	},
};

const command = commands[process.argv[2]];
if (!command) {
	console.error('invalid command: ' + commandName);
	process.exit(1);
}
else {
	Promise.resolve()
	.then(() => command())
	.then(() => process.exit(0))
	.catch((err) => {
		console.error('error running command ' + commandName + ': ' + (err.message || err));
		if (err.stack) console.error(err.stack);
	});		
}

