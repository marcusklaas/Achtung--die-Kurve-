/* debugging */
function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

/* game engine */
function GameEngine(containerId) {
	debugLog("creating game");

	// game variables
	this.players = [];
	this.idToPlayer = []; // maps playerId to index of this.players
	this.gameStartTimestamp = null;
	this.lastUpdateTimestamp = null;
	this.gameOver = true;
	this.width = -1;
	this.height = -1;

	// game properties
	this.velocity = null;
	this.turnSpeed = null;

	// connection state
	this.websocket = null;
	this.connected = false;
	this.bestSyncPing = 9999;
	this.worstSyncPing = 0;
	this.syncTries = 0;
	this.serverTimeDifference = 0;
	this.ping = 0;

	// canvas related
	this.containerId = containerId; // id of DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments	
}

/* a lot of values we do not clear, but we do not care for them as they 
 * will get overwritten as soon as new game starts */
GameEngine.prototype.reset = function() {
	var localPlayer = this.players[0];
	this.players = [];
	this.players.push(localPlayer);
	this.canvasStack = null;
	this.baseContext = null;

	var container = document.getElementById(this.containerId);
	while(container.hasChildNodes())
		container.removeChild(container.firstChild);
}

GameEngine.prototype.connect = function(url, name) {
	if(typeof MozWebSocket != "undefined")
		this.websocket = new MozWebSocket(url, name);
	else
		this.websocket = new WebSocket(url, name);
	
	this.websocket.parent = this;
	var game = this;
	
	try {
		this.websocket.onopen = function() {
			debugLog('Connected to websocket server');
			game.connected = true;
			game.syncWithServer();
		}
		this.websocket.onmessage = function(msg) {
			if(simulatedPing > 0)
				window.setTimeout(function(){got_packet(msg);}, simulatedPing);
			else
				got_packet(msg);
		}
		this.websocket.onclose = function() {
			debugLog('Websocket connection closed!');
			game.connected = false;
		}
	} catch(exception) {
		debugLog('websocket exception! name = ' + exception.name + ", message = "
		 + exception.message);
	}
}
function got_packet(msg) {
	if(ultraVerbose)
		debugLog('received data: ' + msg.data);

	try {
		var obj = JSON.parse(msg.data);
	}
	catch(ex) {
		debugLog('JSON parse exception!');
	}

	switch(obj.mode) {
		case 'acceptUser':
			game.players[0].playerId = obj.playerId;
			game.idToPlayer[obj.playerId] = 0;
			break;
		case 'joinedGame':
			debugLog('you joined a game.');
			break;
		case 'gameParameters':
			game.setParams(obj);
			debugLog('received game params.');
			break;				
		case 'newPlayer':
			var newPlayer = new Player(playerColors[game.players.length], false);
			newPlayer.playerId = obj.playerId;
			newPlayer.playerName = obj.playerName;
			game.addPlayer(newPlayer);
			debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
			break;
		case 'startGame':
			game.start(obj.startPositions, obj.startTime);
			break;
		case 'newInput':
			game.players[game.idToPlayer[obj.playerId]].steer(obj);
			break;
		case 'adjustGameTime':
			debugLog('adjusted game time by ' + obj.forward + ' msec');
			game.gameStartTimestamp += obj.forward;
			break;
		case 'playerLeft':
			var index = game.idToPlayer[obj.playerId];
			debugLog(game.players[index].playerName + " left game");

			if(game.gameOver) {
				for(var i = index + 1; i < game.players.length; i++)
					game.idToPlayer[game.players[i].playerId] = i - 1;

				game.players.splice(index, 1);
			}
			else
				game.players[index].alive = false;

			break;
		case 'playerDied':
			game.players[game.idToPlayer[obj.playerId]].alive = false;
			debugLog(game.players[game.idToPlayer[obj.playerId]].playerName +
			 " died");
			break;
		case 'endGame':
			var winner = (obj.winnerId != -1)
			 ? (game.players[game.idToPlayer[obj.winnerId]].playerName + ' won')
			 : 'draw!';
			game.gameOver = true;
			debugLog('game ended. ' + winner);
			break;
		case 'time':
			game.handleSyncResponse(obj.time);
			break;
		default:
			debugLog('unknown mode!');
	}
}

GameEngine.prototype.handleSyncResponse = function(serverTime){
	var ping = (Date.now() - this.syncSendTime) / 2;
	if(ping < this.bestSyncPing){
		this.bestSyncPing = ping;
		this.serverTimeDifference = serverTime - Date.now() + ping;
	}
	if(ping > this.worstSyncPing){
		this.ping += this.worstSyncPing / (syncTries - 1);
		this.worstSyncPing = ping;
	}else
		this.ping += ping / (syncTries - 1);
	if(++this.syncTries < syncTries) {
		var self = this;
		window.setTimeout(function(){self.syncWithServer();},
		 this.syncTries * syncDelays);
	}
	else
		debugLog('synced with server with a maximum error of ' + this.bestSyncPing + ' msec'
		+ ', and average ping of ' + this.ping + ' msec');
}

GameEngine.prototype.getServerTime = function(){
	return this.serverTimeDifference + Date.now();
}

/* initialises the game */ 
GameEngine.prototype.setParams = function(obj) {
	var container = document.getElementById(this.containerId);

	/* Create CanvasStack */
	container.style.margin = 0;
	container.style.padding = 0;
	container.style.width = (this.width = obj.w) + 'px';
	container.style.height = (this.height = obj.h) + 'px';

	/* Set game variables */
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;

	debugLog("this game is for " + obj.nmin + " to " + obj.nmax + " players");
}	

GameEngine.prototype.requestGame = function(playerName, minPlayers, maxPlayers) {
	if(!this.gameOver)
		return;

	this.reset();
	this.players[0].playerName = playerName;
	this.sendMsg('requestGame', {'playerName': playerName, 'minPlayers': minPlayers, 'maxPlayers': maxPlayers});
}

GameEngine.prototype.sendMsg = function(mode, data) {
	// re-enabled!
	if(this.connected === false) {
		debugLog('tried to send msg, but no websocket connection');
		return;
	}

	data.mode = mode;

	var str = JSON.stringify(data);
	
	if(simulatedPing > 0){
		var that = this;
		window.setTimeout(function(){
			that.websocket.send(str);
			if(ultraVerbose)
				debugLog('sending data: ' + str);
		}, simulatedPing);	
	}
	else{
		this.websocket.send(str);
		if(ultraVerbose)
			debugLog('sending data: ' + str);
	}
}

GameEngine.prototype.syncWithServer = function(){
	this.syncSendTime = Date.now();
	this.sendMsg('getTime', {});
}

GameEngine.prototype.update = function(deltaTime) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].update(deltaTime);
}

GameEngine.prototype.loop = function() {
	var now = Date.now();
	var deltaTime = now - this.lastUpdateTimestamp;

	this.update(deltaTime);
	this.lastUpdateTimestamp = now;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;

	/* internet player */
	if(player.playerId != null)
		this.idToPlayer[player.playerId] = this.players.length;

	this.players.push(player);
	debugLog("adding player to game");
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime - this.getServerTime() - this.ping + Date.now();
	this.lastUpdateTimestamp = this.gameStartTimestamp;
	this.gameOver = false;
	var delay = this.gameStartTimestamp - Date.now();
	
	debugLog("starting game in " + delay);

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.containerId, canvasBgcolor);

	/* draw on background context, since we never need to redraw anything 
	 * on this layer (only clear for new game) */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseContext = canvas.getContext('2d');
	this.baseContext.lineWidth = lineWidth;

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.idToPlayer[startPositions[i].playerId];
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle);
	}

	var that = this;

	var gameloop = function() {
		that.loop();

		if(!that.gameOver)
			window.setTimeout(gameloop, 1000 / 60);
	}

	window.setTimeout(gameloop, delay);
}

/* players */
function Player(color, local) {
	this.isLocal = local;
	this.playerId = null;
	this.playerName = null;
	this.velocity = null; //pixels per sec
	this.turnSpeed = null;
	this.angle = 0; // radians
	this.x = 0;
	this.y = 0;
	this.lcx = 0; // last confirmed x
	this.lcy = 0;
	this.lca = 0; // last confirmed angle
	this.lct = 0; // game time of last confirmed location (in millisec)
	this.color = color;
	this.turn = 0; // -1 is turn left, 0 is straight, 1 is turn right
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.alive = false;

	//only for local player
	this.lcturn = 0;
	this.inputQueue = [];

	debugLog("creating player");
}

Player.prototype.steer = function(obj) {
	/* run simulation from lcx, lcy on the conclusive canvas from time 
	 * lct to timestamp in object */
	this.simulate(this.lcx, this.lcy, this.lca, this.lcturn,
	 obj.gameTime - this.lct, this.game.baseContext, obj.x, obj.y);

	/* here we sync with server */
	this.lcx = this.x = obj.x;
	this.lcy = this.y = obj.y;
	this.lca = this.angle = obj.angle;
	this.lct = obj.gameTime;
	this.lcturn = obj.turn;	

	if(!this.isLocal)
		this.turn = obj.turn;

	/* clear this players canvas and run extrapolation on this player's
	 * context from timestamp in object to NOW */
	this.context.clearRect(0, 0, this.game.width, this.game.height);
	var starttime = Date.now() - this.game.gameStartTimestamp;
	var simduration = starttime - this.lct;
	this.extrapolate(obj.turn, starttime, simduration);
}

Player.prototype.extrapolate = function(turn, start, dur) {
	var input;
	var step;

	this.context.beginPath();
	this.context.moveTo(this.x, this.y);

	for(var time = 0; time < dur; time += step) {
		while(input = this.inputQueue.pop()) {
			if(input.time > start + time) {
				this.inputQueue.push(input);
				break;
			}

			turn = input.turn;
		}

		step = Math.min(simStep, dur - time);
		this.angle += turn * this.turnSpeed * step/ 1000;
		this.x += this.velocity * step/ 1000 * Math.cos(this.angle);
		this.y += this.velocity * step/ 1000 * Math.sin(this.angle);
		this.context.lineTo(this.x, this.y);
	}

	this.context.stroke();
}

Player.prototype.simulate = function(x, y, angle, turn, time, ctx, destX, destY) {
	ctx.strokeStyle = this.color;
	ctx.beginPath();
	ctx.moveTo(x, y);
	time -= simStep;

	while(time > 0) {
		var step = Math.min(simStep, time);
		angle += turn * this.turnSpeed * step/ 1000;
		x += this.velocity * step/ 1000 * Math.cos(angle);
		y += this.velocity * step/ 1000 * Math.sin(angle);
		ctx.lineTo(x, y);
		time -= step;
	}

	ctx.lineTo(destX, destY);
	ctx.stroke();
	return [x, y, angle];
}

Player.prototype.initialise = function(x, y, angle) {
	this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.alive = true;
	this.lcx = this.x = x;
	this.lcy = this.y = y;
	this.lct = 0;
	this.lca = this.angle = angle;
	this.turn = 0;

	/* create canvas */
	var canvas = document.getElementById(this.game.canvasStack.createLayer());
	this.context = canvas.getContext('2d');
	this.context.lineWidth = lineWidth;
	this.context.strokeStyle = this.color;
	this.context.moveTo(x, y);

	debugLog("initialising player at (" + this.x + ", " + this.y + "), angle = " + this.angle);
}

Player.prototype.update = function(deltaTime) {
	if(!this.alive)
		return false;

	this.context.beginPath();
	this.context.moveTo(this.x, this.y);
	this.angle += this.turn * this.turnSpeed * deltaTime/ 1000;
	this.x += this.velocity * deltaTime/ 1000 * Math.cos(this.angle);
	this.y += this.velocity * deltaTime/ 1000 * Math.sin(this.angle);
	this.context.lineTo(this.x, this.y);
	this.context.closePath();
	this.context.stroke();
}

/* input control */
function InputController(left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = null;
	this.game = null;

	debugLog("creating keylogger")
}

InputController.prototype.setPlayer = function(player) {
	this.player = player;
}

InputController.prototype.setGame = function(game) {
	this.game = game;
}

InputController.prototype.keyDown = function(keyCode) {
	if(!this.player.alive)
		return;

	if(keyCode == this.rightKeyCode && this.player.turn != -1) {
		this.player.turn = -1;
		var obj = {'turn': -1, 'gameTime': Date.now() - this.game.gameStartTimestamp}
		this.player.inputQueue.unshift(obj);
		this.game.sendMsg('newInput', obj);
	}
	else if(keyCode == this.leftKeyCode && this.player.turn != 1){
		this.player.turn = 1;
		var obj = {'turn': 1, 'gameTime': Date.now() - this.game.gameStartTimestamp}
		this.player.inputQueue.unshift(obj);
		this.game.sendMsg('newInput', obj);
	}
}

InputController.prototype.keyUp = function(keyCode) {
	if(!this.player.alive)
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) {
		this.player.turn = 0;
		var obj = {'turn': 0, 'gameTime': Date.now() - this.game.gameStartTimestamp};
		this.player.inputQueue.unshift(obj);
		this.game.sendMsg('newInput', obj);
	}
}

/* create game */
window.onload = function() {

	/* some constants */
	game = new GameEngine('canvasContainer');
	var player = new Player(playerColors[0], true);
	var inputControl = new InputController(keyCodeLeft, keyCodeRight);
	
	inputControl.setGame(game);
	game.addPlayer(player);
	inputControl.setPlayer(player);

	/* register key presses and releases */
	document.onkeydown = function(event) {
		var keyCode;

	 	if(event == null)
			keyCode = window.event.keyCode;
		else
			keyCode = event.keyCode;

		inputControl.keyDown(keyCode);
	}

	document.onkeyup = function(event) {
		var keyCode;

	 	if(event == null)
			keyCode = window.event.keyCode;
		else
			keyCode = event.keyCode;

		inputControl.keyUp(keyCode);
	}

	var startButton = document.getElementById('start');
	startButton.addEventListener('click', function() {
		var maxPlayers = parseInt(document.getElementById('maxplayers').value);
		var minPlayers = parseInt(document.getElementById('minplayers').value);
		var playerName = document.getElementById('playername').value;
		
		if(typeof playerName != "string" || playerName.length < 1)
			debugLog('enter a cool playername please');

		if(maxPlayers > 8 || maxPlayers < 1 || minPlayers > 8 || minPlayers < 1
		 || minPlayers > maxPlayers)
			debugLog('min/ maxplayers unacceptable!');

		game.requestGame(playerName, minPlayers, maxPlayers);
	}, false);

	game.connect(serverURL, "game-protocol");
}
