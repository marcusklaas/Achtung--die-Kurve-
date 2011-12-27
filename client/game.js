/* game engine */
function GameEngine(containerId, playerListId, chatBarId, audioController) {
	// game variables
	this.players = [];
	this.dict = []; // maps playerId.toString() to index of this.players
	this.gameStartTimestamp = null;
	this.tick = 0;
	this.tock = 0; // seperate tick for the other clients
	this.behind = behind;
	this.gameState = 'lobby'; // lobby, waiting, countdown, playing, watching
	this.width = -1;
	this.height = -1;
	
	// debug counters
	this.redraws = 0;
	this.redrawsPossible = 0;
	this.adjustGameTimeMessagesReceived = 0;
	this.modifiedInputs = 0;

	// game properties
	this.velocity = null;
	this.turnSpeed = null;
	this.holeSize = null; // default game values, may be overwritten during game
	this.holeFreq = null; // for certain players by powerups or whatever

	// connection state
	this.websocket = null;
	this.connected = false;
	this.syncTries = 0;

	// canvas related
	this.scale = null;		// canvas size/ game size
	this.containerId = containerId; // id of DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments

	// audio controller
	this.audioController = audioController;

	// player list related
	this.localPlayerId = null;
	this.playerList = document.getElementById(playerListId).lastChild;

	// chat
	this.chatBar = document.getElementById(chatBarId);
	
	// optional features
	if(pencilGame)
		this.pencil = new Pencil(this);
}

/* a lot of values we do not clear, but we do not care for them as they 
 * will get overwritten as soon as new game starts */
GameEngine.prototype.reset = function() {
	this.players = [];
	//this.dict = [];
	this.canvasStack = null;
	this.baseContext = null;
	this.tick = 0;
	this.tock = 0;
	
	this.redraws = 0;
	this.redrawsPossible = 0;
	this.adjustGameTimeMessagesReceived = 0;
	this.modifiedInputs = 0;

	var container = document.getElementById(this.containerId);
	while(container.hasChildNodes())
		container.removeChild(container.firstChild);

	this.clearPlayerList();
}

GameEngine.prototype.getIndex = function(playerId) {
	return this.dict[playerId.toString()];
}

GameEngine.prototype.setIndex = function(playerId, index) {
	return this.dict[playerId.toString()] = index;
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
			if(onConnect != null) {
				onConnect();
				onConnect = null;
			}
		}
		this.websocket.onmessage = function(msg) {
			if(simulatedPing > 0)
				window.setTimeout(function(){game.interpretMsg(msg);}, simulatedPing);
			else
				game.interpretMsg(msg);
		}
		this.websocket.onclose = function() {
			debugLog('Websocket connection closed!');
			game.connected = false;
			game.gameState = 'lobby';
			game.reset();
		}
	} catch(exception) {
		debugLog('websocket exception! name = ' + exception.name + ", message = "
		 + exception.message);
	}
}

GameEngine.prototype.interpretMsg = function(msg) {
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
			this.localPlayerId = obj.playerId;
			this.setIndex(obj.playerId, 0);
			break;
		case 'joinedGame':
			debugLog('you joined a game.');
			break;
		case 'gameParameters':
			this.setParams(obj);
			break;				
		case 'newPlayer':
			var newPlayer = new Player(playerColors[this.players.length], false);
			newPlayer.playerId = obj.playerId;
			newPlayer.playerName = obj.playerName;
			this.addPlayer(newPlayer);
			this.audioController.playSound('newPlayer');
			debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
			break;
		case 'startGame':
			this.start(obj.startPositions, obj.startTime);
			break;
		case 'newInput':
			this.players[this.getIndex(obj.playerId)].steer(obj);
			break;
		case 'adjustGameTime':
			if(acceptGameTimeAdjustments){
				debugLog('adjusted game time by ' + obj.forward + ' msec');
				this.gameStartTimestamp -= obj.forward;
				this.adjustGameTimeMessagesReceived++;
				this.displayDebugStatus();
			}else
				debugLog('game time adjustment of ' + obj.forward + ' msec rejected');
			break;
		case 'playerLeft':
			var index = this.getIndex(obj.playerId);
			this.splicePlayerList(index);
			debugLog(this.players[index].playerName + " left the game");

			if(this.gameState == 'waiting') {
				for(var i = index + 1; i < this.players.length; i++)
					this.setIndex(this.players[i].playerId, i - 1);

				this.players.splice(index, 1);
			}
			else
				this.players[index].alive = false;

			break;
		case 'playerDied':
			var index = this.getIndex(obj.playerId);
			this.players[index].alive = false;
			this.updatePlayerList(index, 'dead');
			debugLog(this.players[index].playerName + " died");
			if(index == 0)
				this.audioController.playSound('localDeath');
			break;
		case 'endGame':
			var winner = (obj.winnerId != -1)
			 ? (this.players[getIndex(obj.winnerId)].playerName + ' won') : 'draw';
			this.gameState = 'lobby';
			debugLog('game over. ' + winner);

			if(obj.winnerId == this.localPlayerId)
				this.audioController.playSound('localWin');
			if(jsProfiling)
				console.profileEnd();
			break;
		case 'time':
			this.handleSyncResponse(obj.time);
			break;
		case 'chat':
			this.printChat(obj.playerId, obj.message);
			break;
		case 'segments':
			this.handleSegmentsMessage(obj.segments);
			break;
		case 'pencil':
			this.pencil.handleMessage(obj.data);
			break;
		default:
			debugLog('unknown mode!');
	}
}

GameEngine.prototype.printChat = function(playerId, message) {
	debugLog(this.players[getIndex(playerId)].playerName + ': ' + message);
}

GameEngine.prototype.handleSegmentsMessage = function(segments) {
	this.segctx.beginPath();
	for(var i = 0; i < segments.length; i++) {
		var s = segments[i];
		this.segctx.moveTo(s.x1, s.y1);
		this.segctx.lineTo(s.x2, s.y2);
	}
	this.segctx.stroke();
}

GameEngine.prototype.handleSyncResponse = function(serverTime) {
	if(this.syncTries == 0) {
		this.ping = 0;
		this.bestSyncPing = 9999;
		this.worstSyncPing = 0;
	}

	var ping = Math.round((Date.now() - this.syncSendTime) / 2);
	if(ping < this.bestSyncPing) {
		this.bestSyncPing = ping;
		this.serverTimeDifference = Date.now() - (serverTime + ping);
	}

	if(ping > this.worstSyncPing) {
		this.ping += Math.round(this.worstSyncPing / (syncTries - 1));
		this.worstSyncPing = ping;
	}else
		this.ping += Math.round(ping / (syncTries - 1));

	if(++this.syncTries < syncTries) {
		var self = this;
		window.setTimeout(function(){self.syncWithServer();},
		 this.syncTries * syncDelays);
	}
	else{
		debugLog('synced with a maximum error of ' + this.bestSyncPing
		 + ' msec' + ', and average ping of ' + this.ping + ' msec');
		this.syncTries = 0;
	}
}

/* initialises the game */ 
GameEngine.prototype.setParams = function(obj) {
	var container = document.getElementById(this.containerId);

	/* Create CanvasStack */
	container.style.padding = 0;
	this.width = obj.w;
	this.height = obj.h;

	/* Set game variables */
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;
	this.holeSize = obj.hsize;
	this.holeFreq = obj.hfreq;

	debugLog("this game is for " + obj.nmin + " to " + obj.nmax + " players");
}	

GameEngine.prototype.requestGame = function(player, minPlayers, maxPlayers) {
	// TODO: we should allow player to leave game anytime. you could say: just
	// remove the check, but that is not enough to get it to work (i think)
	if(this.gameState != 'lobby')
		return;

	player.inputQueue = [];
	player.baseQueue = [];
	this.reset();
	this.addPlayer(player);
	this.sendMsg('requestGame', {'playerName': player.playerName,
	 'minPlayers': minPlayers, 'maxPlayers': maxPlayers});
}

GameEngine.prototype.sendMsg = function(mode, data) {
	if(this.connected === false) {
		debugLog('tried to send msg, but no websocket connection');
		return;
	}

	data.mode = mode;
	var str = JSON.stringify(data);
	
	if(simulatedPing > 0) {
		var that = this;
		window.setTimeout(function() {
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

GameEngine.prototype.syncWithServer = function() {
	this.syncSendTime = Date.now();
	this.sendMsg('getTime', {});
}

GameEngine.prototype.doTick = function() {
	var player = this.players[0];
	player.simulate(this.tick, ++this.tick, player.context, null);
	
	if(pencilGame)
		this.pencil.doTick();
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
		if(!player.alive)
			continue;

		var len = player.inputQueue.length;
		if(len > 0 && player.inputQueue[len - 1].tick == this.tock)
			player.turn = player.inputQueue.pop().turn;
		player.simulate(this.tock, this.tock + 1, player.context, null);
	}
	this.tock++;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;
	var index = this.players.length;

	if(player.playerId != null)
		this.setIndex(player.playerId, index);
	else
		player.playerId = this.localPlayerId;

	this.players.push(player);
	this.appendPlayerList(index);
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime + this.serverTimeDifference - this.ping
	 + extraGameStartTimeDifference;
	this.gameState = 'countdown';
	var delay = this.gameStartTimestamp - Date.now();
	
	if(jsProfiling)
		console.profile('canvas performance');

	window.scroll(0, 0);
	this.audioController.playSound('countdown');
	this.playerListStart();
	debugLog("starting game in " + delay + " milliseconds");

	var container = document.getElementById(this.containerId);
	var widthMinusScroll = getPageWidth();
	this.scale = Math.min(widthMinusScroll/ this.width, window.innerHeight/ this.height);
	container.style.width = Math.floor(this.width * this.scale) + 'px';
	container.style.height = Math.floor(this.height * this.scale) + 'px';

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.containerId, canvasBgcolor);

	/* create background context */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseContext = canvas.getContext('2d');
	this.baseContext.scale(this.scale, this.scale); // XPERIMENTAL
	this.baseContext.fillStyle = '#000';
	this.baseContext.lineWidth = lineWidth;
	this.baseContext.lineCap = lineCapStyle;

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle,
		 startPositions[i].holeStart);
	}

	/* create segment canvas */
	canvas = document.getElementById(this.canvasStack.createLayer());
	this.segctx = canvas.getContext('2d');
	this.segctx.scale(this.scale, this.scale); // XPERIMENTAL
	this.segctx.lineWidth = 1;
	this.segctx.strokeStyle = 'black';
	this.segctx.lineCap = lineCapStyle;
	
	if(pencilGame)
		this.pencil.reset();
	
	var self = this;
	window.setTimeout(function() { self.realStart(); }, delay + simStep);
}

GameEngine.prototype.realStart = function() {
	// clearing angle indicators from base layer
	this.baseContext.clearRect(0, 0, this.width, this.height);
	this.audioController.playSound('gameStart');
	this.gameState = 'playing';

	var self = this;
	var gameloop = function() {
		var timeOut;

		do {
			if(self.gameState != 'playing' && self.gameState != 'watching')
				return;

			while(self.tick - self.tock >= self.behind)
				self.doTock();
			self.doTick();
		} while((timeOut = (self.tick + 1) * simStep - (Date.now() - self.gameStartTimestamp)
		 + (simulateCPUlag && self.tick % 100 == 0 ? 400 : 0)) <= 0);

		setTimeout(gameloop, timeOut);		
	}

	gameloop();
}

GameEngine.prototype.displayDebugStatus = function() {
	document.getElementById('status').innerHTML = 
	 'redraws: ' + this.redraws + ' / ' + this.redrawsPossible +
	 ', modified inputs: ' + this.modifiedInputs +
	 ', game time adjustments: ' + this.adjustGameTimeMessagesReceived;
}

GameEngine.prototype.playerListStart = function() {
	for(var i = 0; i < this.players.length; this.updatePlayerList(i++, 'alive'));
}

GameEngine.prototype.appendPlayerList = function(index) {
	var player = this.players[index];
	var row = document.createElement('tr');
	var nameNode = document.createElement('td');
	var statusNode = document.createElement('td');

	// alleen naam in spelerkleur of ook status?
	row.style.color = 'rgb(' + player.color[0] + ', ' + player.color[1] + ', '
	 + player.color[2] + ')';
	row.id = 'player' + index;
	nameNode.innerHTML = player.playerName;

	this.playerList.appendChild(row);
	row.appendChild(nameNode);
	row.appendChild(statusNode);
	this.updatePlayerList(index, 'ready');
}

GameEngine.prototype.updatePlayerList = function(index, status) {
	var statusNode = document.getElementById('player' + index).lastChild;
	statusNode.innerHTML = status;
}

GameEngine.prototype.splicePlayerList = function(index) {
	var row = document.getElementById('player' + index);
	this.playerList.removeChild(row);
}

GameEngine.prototype.clearPlayerList = function() {
	while(this.playerList.hasChildNodes())
		this.playerList.removeChild(this.playerList.firstChild);
}

/* for sending chat messages. TODO: we want lobby chat as well! */
GameEngine.prototype.sendChat = function() {
	var msg = this.chatBar.value;

	if(this.gameState == 'lobby' || msg.length < 1)
		return;

	this.sendMsg('chat', {'message': msg});
	this.chatBar.value = '';
	this.printChat(this.localPlayerId, msg);
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
	this.lctick = 0; // game tick of last confirmed location
	this.lcturn = 0;
	this.color = color;
	this.turn = 0; // -1 is turn left, 0 is straight, 1 is turn right
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.alive = true;
	this.inputQueue = [];
	this.baseQueue = [];
	this.holeStart = 0;
	this.holeSize = 0;
	this.holeFreq = 0;
}

Player.prototype.steer = function(obj) {
	var localTick = this.isLocal ? this.game.tick : this.game.tock;
	
	if(obj.tick > localTick && this.isLocal && obj.modified != undefined){
		while(obj.tick > this.game.tick)
			this.game.doTick();
		debugLog('your game is running behind! ' + (this.game.tick - localTick) + 
		 ' ticks forwarded');
		localTick = this.game.tick;
	}else if(obj.tick >= localTick || (this.isLocal && obj.modified == undefined)) {
		if(this.baseQueue.length > 0 && this.baseQueue[0].tick == obj.tick)
			this.baseQueue[0] = obj;
		else
			this.baseQueue.unshift(obj);
		if(!this.isLocal) { 
			if(this.inputQueue.length > 0 && this.inputQueue[0].tick == obj.tick)
				this.inputQueue[0] = obj;
			else
				this.inputQueue.unshift(obj);
			
			this.game.redrawsPossible++;
			this.game.displayDebugStatus();
		}
		return;
	}
	
	if(this.isLocal && obj.modified != undefined) {
		this.game.modifiedInputs ++;
		this.game.displayDebugStatus();
	}
	
	var currentTurn = this.turn;
		
	/* run simulation from lcx, lcy on the conclusive canvas from tick 
	 * lctick to obj.tick */
	this.x = this.lcx;
	this.y = this.lcy;
	this.angle = this.lca;
	this.turn = this.lcturn;
	this.simulate(this.lctick, obj.tick, this.game.baseContext, this.baseQueue);
	this.turn = obj.turn;
	this.baseQueue = [];
	this.lcx = this.x;
	this.lcy = this.y;
	this.lca = this.angle;
	this.lcturn = this.turn;	
	this.lctick = obj.tick;

	/* clear this players canvas and run extrapolation on this player's
	 * context from timestamp in object to NOW */
	this.context.clearRect(0, 0, this.game.width, this.game.height);
	if(!this.isLocal) {
		this.game.redraws++;
		this.game.redrawsPossible++;
		this.game.displayDebugStatus();
	}
	
	// remove all inputs in the inputQueue with a tick smaller than obj.tick
	if(this.isLocal && this.inputQueue.length > 0){
		for(var i = this.inputQueue.length - 1; i >= 0 && this.inputQueue[i].tick < obj.tick; 
		 i--);
		this.inputQueue.length = i + 1;
	}
	
	this.simulate(obj.tick, localTick, this.context, this.isLocal ? this.inputQueue : null);
	
	if(this.isLocal)
		this.turn = currentTurn;
}

Player.prototype.simulate = function(startTick, endTick, ctx, queue) {
	if(startTick == endTick)
		return;

	var i, input = null, sin = Math.sin(this.angle),
	 cos = Math.cos(this.angle), step = simStep/ 1000;
	var inHole = (startTick > this.holeStart && (startTick + this.holeStart)
	 % (this.holeSize + this.holeFreq) < this.holeSize);

	ctx.beginPath();
	setLineColor(ctx, this.color, inHole ? gapAlpha : 1);
	ctx.lineCap = inHole ? 'butt' : lineCapStyle;
	ctx.moveTo(this.x, this.y);
	
	if(debugBaseContext && ctx == this.game.baseContext)
		setLineColor(ctx, [0,0,0], inHole ? gapAlpha : 1);

	if(queue != null) {
		// set input and i
		for(i = queue.length - 1; i >= 0 && queue[i].tick < startTick; i--);
		if(i >= 0)
			input = queue[i];
	}
	
	for(var tick = startTick; tick < endTick; tick++) {
		if(inHole !== (tick > this.holeStart && (tick + this.holeStart)
		 % (this.holeSize + this.holeFreq) < this.holeSize)) {
			ctx.stroke();
			return this.simulate(tick, endTick, ctx, queue);
		}

		if(input != null && input.tick == tick) {
			this.turn = input.turn;
			input = (--i >= 0) ? queue[i] : null;
		}

		if(this.turn != 0) {
			this.angle += this.turn * this.turnSpeed * step;
			cos = Math.cos(this.angle);
			sin = Math.sin(this.angle);
		}
			
		this.x += this.velocity * step * cos;
		this.y += this.velocity * step * sin;
		ctx.lineTo(this.x, this.y);
	}

	ctx.stroke();
}

Player.prototype.initialise = function(x, y, angle, holeStart) {
	this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.holeStart = holeStart;
	this.holeSize = this.game.holeSize;
	this.holeFreq = this.game.holeFreq;
	this.alive = true;
	this.lcx = this.x = x;
	this.lcy = this.y = y;
	this.lctick = 0;
	this.lcturn = 0;
	this.lca = this.angle = angle;
	this.turn = this.lcturn = 0;
	this.turn = 0;
	this.inputQueue = [];
	this.baseQueue = [];

	/* create canvas */
	var canvas = document.getElementById(this.game.canvasStack.createLayer());
	this.context = canvas.getContext('2d');
	this.context.scale(this.game.scale, this.game.scale); // XPERIMENTAL
	this.context.lineWidth = lineWidth;
	//this.context.strokeStyle = this.color;
	this.context.lineCap = lineCapStyle;
	this.context.moveTo(x, y);

	/* draw angle indicator on base layer */
	var ctx = this.game.baseContext;
	setLineColor(ctx, this.color, 1);
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x + Math.cos(angle) * indicatorLength, y + Math.sin(angle) * indicatorLength);
	ctx.stroke();
	ctx.beginPath();
	ctx.arc(x, y, indicatorDotSize, 0, 2 * Math.PI, false);
	ctx.fill();
}

/* input control */
function InputController(player, left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = player;
	this.lastSteerTick = -1;
}

InputController.prototype.keyDown = function(keyCode) {
	if(this.player.game == null || this.player.game.gameState != 'playing')
		return;

	if(keyCode == this.rightKeyCode && this.player.turn != -1) 
		this.steerLocal(-1);
	
	else if(keyCode == this.leftKeyCode && this.player.turn != 1)
		this.steerLocal(1);
}

InputController.prototype.keyUp = function(keyCode) {
	if(this.player.game == null || this.player.game.gameState != 'playing')
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) 
		this.steerLocal(0);
}

InputController.prototype.steerLocal = function(turn) {
	var game = this.player.game;
	var obj = {'turn': turn, 'tick': game.tick};
	this.player.turn = turn;

	if(this.lastSteerTick == game.tick)
		this.player.inputQueue[0] = obj;
	else{
		this.player.inputQueue.unshift(obj);
		this.lastSteerTick = game.tick;
	}

	game.sendMsg('newInput', obj);
}

/* Audio manager */
function AudioController() {
	this.sounds = new Array();
}

AudioController.prototype.addSound = function(name, file, formats) {	
	if(typeof this.sounds[name] != 'object')
		this.sounds[name] = [];
	this.sounds[name].push(new buzz.sound(file, {'formats': formats}));
}

AudioController.prototype.playSound = function(name) {
	if(!enableSound || typeof this.sounds[name] != 'object')
		return;

	this.sounds[name][Math.floor(Math.random() * this.sounds[name].length)].play();
}

/* Pencil */
function Pencil(game) {
	this.game = game;
	this.reset();
	
	var canvas = document.getElementById(game.containerId);
	var self = this;
	canvas.addEventListener('mousedown', function(ev) {
		if(!self.down && self.ink > mousedownInk){
			self.ink -= mousedownInk;
			self.last = self.cur = ev;
			var pos = self.getRelativeMousePos(ev);
			self.buffer.push(pos[0]);
			self.buffer.push(pos[1]);
			self.buffer.push(-self.game.tick - 1);
			self.down = true;
		}
	}, false);
	canvas.addEventListener('mousemove', function(ev) {
		if(self.down)
			self.cur = ev;
	}, false);
	canvas.addEventListener('mouseup', function(ev) {
		if(self.down){
			self.cur = ev;
			self.down = false;
			self.upped = true;
		}
	}, false);
}

Pencil.prototype.reset = function() {
	this.buffer = [];
	this.down = false;
	this.upped = false;
	this.inbuffer = [];
	this.inbufferSolid = [];
	this.ink = startInk;
	this.players = this.game.players.length;
	for(var i = 0; i < this.players; i++){
		this.inbuffer[i] = [];
		this.inbufferSolid[i] = [];		
	}
	this.inbufferSolid.length = this.inbuffer.length = this.players;
	var pos = findPos(document.getElementById(this.game.containerId));
	this.canvasLeft = pos[0];
	this.canvasTop = pos[1];
}

Pencil.prototype.doTick = function() {
	this.ink += inkPerSec / 1000 * simStep;
	if(this.ink > maxInk)
		this.ink = maxInk;
	if(this.down || this.upped){
		this.upped = false;
		var pos = this.getRelativeMousePos(this.last);
		var x1 = pos[0];
		var y1 = pos[1];
		pos = this.getRelativeMousePos(this.cur);
		var x2 = pos[0];
		var y2 = pos[1];
		var d = getLength(x2 - x1, y2 - y1);
		if((d >= inkMinimumDistance || d >= this.ink) && this.ink > 0){
			if(this.ink < d){
				var a = x2 - x1;
				var b = y2 - y1;
				a *= this.ink / d;
				b *= this.ink / d;
				x2 = x1 + a;
				y2 = y1 + b;
				this.ink = 0;
			}else
				this.ink -= d;
			this.buffer.push(x2);
			this.buffer.push(y2);
			this.buffer.push(this.game.tick);
			this.drawSegment(x1, y1, x2, y2, 0, pencilAlpha);
			this.last = this.cur;
			if(this.ink == 0)
				this.down = false;
		}
	}
	if(this.game.tick % inkBufferTicks == 0 && this.buffer.length > 0){
		this.game.sendMsg('pencil', {'data' : this.buffer});
		this.buffer = [];
	}
	for(var i = 0; i < this.players; i++){
		var buffer = this.inbuffer[i];
		while(buffer.length > 0 && buffer[0].tickVisible <= this.game.tick){
			var a = buffer.shift();
			if(i > 0)
				this.drawSegment(a.x1, a.y1, a.x2, a.y2, i, pencilAlpha);
			this.inbufferSolid[i].push(a);
		}
		buffer =  this.inbufferSolid[i];
		while(buffer.length > 0 && buffer[0].tickSolid <= this.game.tick){
			var a = buffer.shift();
			this.drawSegment(a.x1, a.y1, a.x2, a.y2, i, 1);
		}
	}
}

Pencil.prototype.drawSegment = function(x1, y1, x2, y2, playerId, alpha) {
	var ctx = this.game.baseContext;
	ctx.beginPath();
	setLineColor(ctx, this.game.players[playerId].color, alpha);
	var tmp = ctx.lineCap;
	ctx.lineCap = alpha == 1 ? lineCapStyle : 'butt';
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.lineCap = tmp;
}

Pencil.prototype.handleMessage = function(ar) {
	for(var i = 0; i < ar.length; i++){
		var a = ar[i];
		this.inbuffer[this.game.getIndex(a.playerId)].push(a);
	}
}

Pencil.prototype.getRelativeMousePos = function(ev) {
	var pos = getMousePos(ev);
	pos[0] -= this.canvasLeft;
	pos[1] -= this.canvasTop;
	pos[0] /= this.game.scale;
	pos[1] /= this.game.scale;
	return pos;
}

/* create game */
window.onload = function() {

	/* some objects */
	var touchDevice = 'createTouch' in document;
	var audioController = new AudioController();
	var game = new GameEngine('canvasContainer', 'playerList',
	 'chat', audioController);
	var player = new Player(playerColors[0], true);
	var inputControl = new InputController(player,
	 keyCodeLeft, keyCodeRight);

	/* add sounds to controller */
	audioController.addSound('localDeath', 'sounds/wilhelm', ['ogg']);
	audioController.addSound('countdown', 'sounds/countdown', ['wav']);
	audioController.addSound('newPlayer', 'sounds/playerjoint', ['wav']);
	audioController.addSound('gameStart', 'sounds/whip', ['wav']);
	audioController.addSound('localWin', 'sounds/winning', ['mp3']);
	
	/* delegate key presses and releases */
	// stond document.body maar dan werken je keys niet meer na muisklik
	window.addEventListener('keydown',
	 function(e) { inputControl.keyDown(e.keyCode); }, false);
	window.addEventListener('keyup',
	 function(e) { inputControl.keyUp(e.keyCode); }, false);

	/* add listener for enter press for sending chat */
	document.getElementById('chat').addEventListener('keydown', function(e) {
		if(e.keyCode == chatSendKeyCode)
			game.sendChat();
	}, false);

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		var canvas = document.getElementById('canvasContainer');
		
		function touch(event, start) {
			var touch = event.changedTouches[0];
			var width = window.innerWidth;
			var left = (touch.pageX < width / 3);

			if(inputControl.player.game.gameState != 'playing' ||
			 (touch.pageX < width * 2 / 3 && !left))
				return;

			if(start)
				inputControl.keyDown(left ? keyCodeLeft : keyCodeRight);
			else
				inputControl.keyUp(left ? keyCodeLeft : keyCodeRight);
			event.preventDefault();
		}

		canvas.addEventListener('touchstart', function(e) { touch(e, true); });
		canvas.addEventListener('touchend', function(e) { touch(e, false); });
	}

	/* listen to sound checkbox */
	var checkBox = document.getElementById('sound');
	checkBox.addEventListener('change', function(e) {
		if(checkBox.checked) {
			setCookie('sound', 'true', 30);
			enableSound = true;
		}
		else {
			setCookie('sound', 'false', 30);
			enableSound = false;
		}
	});

	var soundCookie = getCookie('sound');
	if(soundCookie != null & soundCookie == 'false')
		checkBox.checked = enableSound = false;

	function reqGame() {
		var maxPlayers = parseInt(document.getElementById('maxplayers').value);
		var minPlayers = parseInt(document.getElementById('minplayers').value);
		var playerName = document.getElementById('playername').value;
		
		setCookie('maxPlayers', maxPlayers, 30);
		setCookie('minPlayers', minPlayers, 30);
		setCookie('playerName', playerName, 30);
		
		if(typeof playerName != "string" || playerName.length < 1) {
			debugLog('enter a cool playername please');
			return;
		}

		if(maxPlayers > 8 || maxPlayers < 1 || minPlayers > 8 || minPlayers < 1
		 || minPlayers > maxPlayers) {
			debugLog('min/ maxplayers unacceptable!');
			return;
		}

		player.playerName = playerName;
		
		if(game.connected === false) {
			game.connect(serverURL, "game-protocol");
			onConnect = function() {
				game.requestGame(player, minPlayers, maxPlayers);
			};
		}
		else
			game.requestGame(player, minPlayers, maxPlayers);
	}

	var startButton = document.getElementById('start');
	startButton.addEventListener('click', reqGame, false);
	
	var playerName = getCookie('playerName');
	if(playerName != null && playerName != "")
		document.getElementById('playername').value = playerName;
	var minPlayers = getCookie('minPlayers');
	if(minPlayers != null)
		document.getElementById('minplayers').value = minPlayers;
	var maxPlayers = getCookie('maxPlayers');
	if(maxPlayers != null)
		document.getElementById('maxplayers').value = maxPlayers;

	game.connect(serverURL, "game-protocol");
}

/* canvas context color setter */
function setLineColor(ctx, color, alpha) {
	ctx.strokeStyle = "rgba(" + color[0] + ", " + color[1] + ", "
	 + color[2] + ", " + alpha + ")";
}

/* cookies */
function setCookie(c_name, value, exdays) {
	var exdate = new Date();
	exdate.setDate(exdate.getDate() + exdays);
	var c_value = escape(value) + ((exdays==null) ? "" : "; expires="+exdate.toUTCString());
	document.cookie = c_name + "=" + c_value;
}

function getCookie(c_name) {
	var i, x, y, ARRcookies=document.cookie.split(";");
	for (i = 0; i<ARRcookies.length; i++) {
		x = ARRcookies[i].substr(0,ARRcookies[i].indexOf("="));
		y = ARRcookies[i].substr(ARRcookies[i].indexOf("=")+1);
		x = x.replace(/^\s+|\s+$/g,"");
		if (x == c_name)
			return unescape(y);
	}
}

/* returns the width of page without scollbar 
 * FIXME: dit is belachelijk gecompliceerde functie. moet gemakkelijker
 * kunnen */
function getPageWidth() {
	var inner = document.createElement('p');
	inner.style.width = "100%";
	inner.style.height = "200px";

	var outer = document.createElement('div');
	outer.style.position = "absolute";
	outer.style.top = "0px";
	outer.style.left = "0px";
	outer.style.visibility = "hidden";
	outer.style.width = "200px";
	outer.style.height = "150px";
	outer.style.overflow = "hidden";
	outer.appendChild (inner);

	document.body.appendChild (outer);
	var w1 = inner.offsetWidth;
	outer.style.overflow = 'scroll';
	var w2 = inner.offsetWidth;
	if (w1 == w2) w2 = outer.clientWidth;

	document.body.removeChild (outer);

	return window.innerWidth - (w1 - w2);
}

function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

function getLength(x, y) {
	return Math.sqrt(x * x + y * y);
}

function findPos(obj) {
	var curleft = curtop = 0;
	if (obj.offsetParent) {
		do {
			curleft += obj.offsetLeft;
			curtop += obj.offsetTop;
		} while (obj = obj.offsetParent);
	}
	return [curleft,curtop];
}

function getMousePos(e) {
	var posx = 0;
	var posy = 0;
	if (!e) var e = window.event;
	if (e.pageX || e.pageY) {
		posx = e.pageX;
		posy = e.pageY;
	}
	else if (e.clientX || e.clientY) {
		posx = e.clientX + document.body.scrollLeft
			+ document.documentElement.scrollLeft;
		posy = e.clientY + document.body.scrollTop
			+ document.documentElement.scrollTop;
	}
	// posx and posy contain the mouse position relative to the document
	return [posx, posy];
}
