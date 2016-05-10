var request = require('request');
var fs = require('fs');
var loki = require('lokijs');

var actionUrl = 'http://play.pokemonshowdown.com/action.php';

function loadSettings() {
	var data;
	try {
		data = require('./data/settings.json');
	} catch (e) {}

	if (!Object.isObject(data)) data = {};

	return data;
}

function writeSettings() {
	var toWrite = JSON.stringify(Data.settings);

	fs.writeFileSync('./data/settings.json', toWrite);
}

function loadData() {
	var data;
	try {
		data = require('./data/data.json');
	} catch (e) {}

	if (!Object.isObject(data)) data = {};

	return data;
}

function writeData() {
	var toWrite = JSON.stringify(Data.data);

	fs.writeFileSync('./data/data.json', toWrite);
}

Databases.addDatabase('settings', loadSettings, writeSettings);
global.Settings = Data.settings;
Databases.addDatabase('data', loadData, writeData);

// Load the analyzers and plugins.
var plugins = {};
var files = fs.readdirSync('./plugins');

for (var i = 0; i < files.length; i++) {
	plugins[files[i].split('.')[0]] = require('./plugins/' + files[i]);
}

var analyzers = {};
global.Commands = {};

for (var i in plugins) {
	if (plugins[i].analyzer) {
		analyzers[i] = plugins[i].analyzer;
	}
	if (plugins[i].commands) {
		for (var command in plugins[i].commands) {
			Commands[command] = plugins[i].commands[command];
		}
	}
}

// Load the markov generators used.
global.Markov = {};

module.exports = {
	analyzers: analyzers,

	setup: function() {
		Connection.send('|/avatar ' + Config.avatar);

		var toJoin;

		if (Config.rooms.length > 11) {
			statusMsg("Due to spam protection, 11 is the max amount of rooms that can be joined at once.");
			toJoin = Config.rooms.slice(0,11);
		} else {
			toJoin = Config.rooms;
		}
		Connection.send('|/autojoin ' + toJoin.join(','));
		statusMsg("Setup done.");
	},

	parseAction: function(user, room, action) {
		if (!action) return;
		if (action.pmreply) {
			this.sendPM(user, action.pmreply);
		}
		if (action.reply) {
			if (room) {
				Connection.send(room + "|" + action.reply.replace(/trigger/g, 't⁠igger'));
			} else {
				this.sendPM(user, action.reply);
			}
		}
	},

	parse: function(message) {
		if (!message) return;
		var split = message.split('|');
		if (!split[0]) split[0] = '>lobby'; // Zarel can't code

		switch (split[1]) {
			case 'challstr':
				statusMsg('Received challstr, logging in...');

				var challstr = split.slice(2).join('|');

				request.post(actionUrl, {headers : {'Content-Type': 'application/x-www-form-urlencoded'}, body: 'act=login&name=' + Config.username + '&pass=' + Config.password + '&challstr=' + challstr},
					(error, response, body) => {
						if (!error && response.statusCode == 200) {
							if (body[0] === ']') {
								try {
									body = JSON.parse(body.substr(1));
								} catch (e) {}
								if (body.assertion && body.assertion[0] !== ';') {
									this.setup();
									Connection.send('|/trn ' + Config.username + ',0,' + body.assertion);
								} else {
									forceQuit("Couldn't log in.");
								}
							} else {
								forceQuit("Incorrect request.");
							}
						}
					}
				);
				break;
			case 'updateuser':
				if (split[2] !== Config.username) return false;

				statusMsg("Logged in as " + split[2] + ".");
				break;
			case 'pm':
				if (toId(split[2]) === toId(Config.username)) return false;

				var user = split[2].substr(1);
				var symbol = split[2][0];

				if (split[4].startsWith(Config.commandSymbol)) {
					var words = split[4].split(' ');
					var cmd = words.splice(0, 1)[0];
					if (!(cmd.substr(1) in Commands)) return this.sendPM(user, "Invalid command.");

					if (symbol === ' ') symbol = '+';
					if (Config.admins.indexOf(user) > -1) symbol = '~';
					var message = words.join(' ');
					var action = Commands[cmd.substr(1)](symbol, null, message);
					if (!action) return;

					if (action.then) {
						action.then(val => this.parseAction(user, room, val));
					} else {
						this.parseAction(user, room, action);
					}
				} else {
					pmMsg("PM from " + (split[2][0] === ' ' ? split[2].substr(1) : split[2]) + ": " + split[4]);
					Connection.send("|/reply Hi, I am a bot that is currently spying on everything you say in order to get his owner some fancy statistics. I don't have any cool commands so don't even try.");
				}
				break;
			case 'c':
			case 'c:':
				var user = split[3].substr(1);
				if (user === Config.username) return;

				var words = split[4].split(' ');
				var cmd = words.splice(0, 1)[0];
				var symbol = (Config.admins.indexOf(user) > -1 ? '~' : split[3][0]);
				var room = split[0].substr(1).trim();
				if (cmd.startsWith(Config.commandSymbol) && (cmd.substr(1) in Commands)) {
					var message = words.join(' ');
					var action = Commands[cmd.substr(1)](symbol, room, message);
					if (!action) return;

					if (action.then) {
						action.then(val => this.parseAction(user, room, val));
					} else {
						this.parseAction(user, room, action);
					}
				}
				this.analyze(split[0].substr(1).trim(), split[4]);
				break;
		}
	},

	sendPM: function(user, message) {
		Connection.send("|/w " + user + ", " + message);
	},

	analyze: function(room, message) {
		for (var i in this.analyzers) {
			if (!this.analyzers[i].rooms || this.analyzers[i].rooms.indexOf(room) > -1) {
				this.analyzers[i].parser(room, message);
			}
		}
		Databases.writeDatabase('data');
	},
};
