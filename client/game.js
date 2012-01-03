/* game engine */
function GameEngine(containerId, playerListId, chatBarId, audioController) {
	// game variables
	this.players = [];
	this.dict = []; // maps playerId.toString() to index of this.players
	this.gameStartTimestamp = null;
	this.tick = 0;
	this.tock = 0; // seperate tick for the other clients
	this.behind = behind;
	this.gameState = 'new'; // new, lobby, waiting, countdown, playing, watching, ended
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
	this.countdown = null; // countdown time in msecs

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

/* this only resets things like canvas, but keeps the player info */
GameEngine.prototype.reset = function() {
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
}

GameEngine.prototype.resetPlayers = function() {
	this.players = [];
	this.clearPlayerList();
}

GameEngine.prototype.getIndex = function(playerId) {
	return this.dict[playerId.toString()];
}

GameEngine.prototype.setIndex = function(playerId, index) {
	return this.dict[playerId.toString()] = index;
}

GameEngine.prototype.disconnect = function() {
	if(this.gameState == 'new')
		return;

	debugLog('Disconnecting..');

	this.setGameState('new');
	this.connected = false;
	this.websocket.close();
	this.websocket = null;
	this.resetPlayers();
	this.reset();
}		

GameEngine.prototype.connect = function(url, name, callback) {
	if(typeof MozWebSocket != "undefined")
		this.websocket = new MozWebSocket(url, name);
	else
		this.websocket = new WebSocket(url, name);
	
	this.websocket.parent = this;
	var game = this;
	
	try {
		this.websocket.onopen = function() {
			debugLog('Connected to server');
			game.connected = true;
			game.syncWithServer();
			callback();
		}
		this.websocket.onmessage = function(msg) {
			if(simulatedPing > 0)
				window.setTimeout(function(){game.interpretMsg(msg);}, simulatedPing);
			else
				game.interpretMsg(msg);
		}
		this.websocket.onclose = function() {
			game.disconnect();
		}
	} catch(exception) {
		debugLog('websocket exception! name = ' + exception.name + ", message = "
		 + exception.message);
	}
}

GameEngine.prototype.leaveGame = function() {
	if(this.gameState != 'new' && this.gameState != 'lobby')
		this.sendMsg('leaveGame', {});
}

/* this function handles user interface changes for state transitions */
GameEngine.prototype.setGameState = function(newState) {
	if(newState == 'new' || this.gameState == 'new'){
		var display = newState == 'new' ? 'none' : 'block';
		document.getElementById('playerListContainer').style.display = display;
		document.getElementById('chat').style.display = display;
	}

	switch(newState) {
		case 'lobby':
			setOptionVisibility('gameOptions');
			setContentVisibility('gameListContainer');
			break;
		case 'countdown':
			setContentVisibility('gameContainer');
			break;
		case 'waiting':
			setOptionVisibility('leaveOptions');
			setContentVisibility('gameDetails');
			break;
		case 'new':
			setContentVisibility('nothing');
			setOptionVisibility('lobbyOptions');
			break;
	}

	this.gameState = newState;
}

GameEngine.prototype.joinGame = function(gameId) {
	this.sendMsg('join', {'id': gameId});
}

GameEngine.prototype.joinLobby = function(player) {
	if(this.gameState != 'new')
		return;

	this.addPlayer(player);
	this.sendMsg('joinLobby', {'playerName': player.playerName});
}

GameEngine.prototype.interpretMsg = function(msg) {
	try {
		var obj = JSON.parse(msg.data);
	}
	catch(ex) {
		debugLog('JSON parse exception!');
	}
	
	if(ultraVerbose && obj.mode != 'segments')
		debugLog('received data: ' + msg.data);

	switch(obj.mode) {
		case 'acceptUser':
			this.localPlayerId = obj.playerId;
			simStep = obj.tickLength;
			this.setIndex(obj.playerId, 0);
			break;
		case 'joinedGame':
			var localPlayer = this.players[0];
			this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
			this.resetPlayers();
			this.addPlayer(localPlayer);
			if(obj.type == 'lobby')
				this.title = 'Lobby';
			break;
		case 'gameParameters':
			this.setParams(obj);
			break;				
		case 'newPlayer':
			var newPlayer = new Player(playerColors[this.players.length], false, this.players.length);
			newPlayer.playerId = obj.playerId;
			newPlayer.playerName = obj.playerName;
			this.addPlayer(newPlayer);
			this.audioController.playSound('newPlayer');
			//debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
			break;
		case 'startGame':
			/* keep displaying old game for a while so ppl can see what happened */
			var nextRoundDelay = obj.startTime + this.serverTimeDifference - this.ping
			 + extraGameStartTimeDifference - Date.now();

			if(nextRoundDelay > this.countdown) {
				var self = this;

				this.gameloopTimeout = window.setTimeout(function() {
					self.reset();
					self.start(obj.startPositions, obj.startTime);
				}, nextRoundDelay - this.countdown);
			}
			else {
				this.reset();
				this.start(obj.startPositions, obj.startTime);
			}
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
			if(this.gameState != 'lobby')
				debugLog(this.players[index].playerName + " left the game");

			if(this.gameState == 'waiting' || this.gameState == 'lobby') {
				for(var i = index + 1; i < this.players.length; i++)
					this.setIndex(this.players[i].playerId, i - 1);

				this.players.splice(index, 1);
			}
			else{
				this.players[index].alive = false;
				this.updatePlayerList(index, 'left', null);
			}
			break;
		case 'playerDied':
			var index = this.getIndex(obj.playerId);
			var player = this.players[index];
			player.points = obj.points;
			player.finalSteer(obj);
			break;
		case 'endRound':
			window.clearTimeout(this.gameloopTimeout);
			var index = (obj.winnerId != -1) ? this.getIndex(obj.winnerId) : null;
			var winner = (index != null) ? (this.players[index].playerName + ' won') : 'draw';
			this.setGameState('countdown');
			this.updatePlayerList(index, null, obj.points);
			debugLog('round over. ' + winner);
			break;			
		case 'endGame':
			this.setGameState('ended');
			window.clearTimeout(this.gameloopTimeout);
			debugLog('game over. ' + this.players[this.getIndex(obj.winnerId)].playerName + ' won!');

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
		case 'gameList':
			this.buildGameList(obj.games);
			break;
		case 'segments':
			this.handleSegmentsMessage(obj.segments);
			break;
		case 'pencil':
			this.pencil.handleMessage(obj.data);
			break;
		case 'stopSpamming':
			debugLog('You are flooding the chat. Your latest message has been blocked');
			break;
		default:
			debugLog('unknown mode ' + obj.mode + '!');
	}
}

GameEngine.prototype.buildGameList = function(list) {
	var tbody = document.getElementById('gameList').lastChild;
	var row, node, button, self = this;

	while(tbody.hasChildNodes())
		tbody.removeChild(tbody.firstChild);

	/* beetje getructe oplossing, maar volgens mij moet 't zo */
	var clickHandler = function(id) {
		return function() { self.joinGame(id); };
	};

	for(var i = 0; i < list.length; i++) {
		row = document.createElement('tr');
		row.id = 'game' + list[i].id;

		node = document.createElement('td');
		node.innerHTML = list[i].id;
		row.appendChild(node);

		node = document.createElement('td');
		node.innerHTML = list[i].type;
		row.appendChild(node);

		node = document.createElement('td');
		node.innerHTML = list[i].state;
		row.appendChild(node);

		node = document.createElement('td');
		node.innerHTML = list[i].nmin;
		row.appendChild(node);

		node = document.createElement('td');
		node.innerHTML = list[i].nmax;
		row.appendChild(node);

		node = document.createElement('td');
		node.innerHTML = list[i].n;
		row.appendChild(node);

		button = document.createElement('button');
		button.innerHTML = 'Join';
		button.disabled = (list[i].state != 'lobby');
		button.addEventListener('click', clickHandler(list[i].id));

		node = document.createElement('td');
		node.appendChild(button);
		row.appendChild(node);

		tbody.appendChild(row);
	}
}

GameEngine.prototype.printChat = function(playerId, message) {
	var escaped = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	debugLog(this.players[this.getIndex(playerId)].playerName + ': ' + escaped);
}

GameEngine.prototype.handleSegmentsMessage = function(segments) {
	var ctx = this.foregroundContext;
	setLineColor(ctx, [0,0,0], 1);
	ctx.lineWidth = 1;
	ctx.beginPath();
	for(var i = 0; i < segments.length; i++) {
		var s = segments[i];
		ctx.moveTo(s.x1, s.y1);
		ctx.lineTo(s.x2, s.y2);
	}
	ctx.stroke();
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
		debugLog('Your current ping is ' + this.ping + ' msec');
		if(ultraVerbose)
			debugLog('synced with maximum error of ' + this.bestSyncPing + ' msec');
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
	this.countdown = obj.countdown;
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;
	this.holeSize = obj.hsize;
	this.holeFreq = obj.hfreq;
	
	if(obj.type != 'lobby') {
		document.getElementById('nmin').value = obj.nmin;
		document.getElementById('nmax').value = obj.nmax;
		document.getElementById('velocity').value = this.velocity;
		document.getElementById('turnSpeed').value = this.turnSpeed;
		document.getElementById('holeSize').value = this.holeSize;
		document.getElementById('holeFreq').value = this.holeFreq;

		this.title = 'Game ' + obj.id;
		document.getElementById('gameTitle').innerHTML = this.title;
	}
}

GameEngine.prototype.requestGame = function(player, minPlayers, maxPlayers) {
	if(this.gameState != 'lobby')
		return;

	this.setGameState('waiting');
	//TODO: waarom hier inputs clearen?
	player.inputs = [];
	player.nextInput = 0;
	this.resetPlayers();
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

	this.tick++;

	if(!player.alive)
		return;

	player.simulate(this.tick, player.context);
	
	if(pencilGame)
		this.pencil.doTick();
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
		if(!player.alive)
			continue;
			
		player.simulate(this.tock + 1, player.context);
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

/* i wanted to do this in css but it isn't possible to do full height minus
 * fixed number of pixels */
GameEngine.prototype.calcScale = function() {
	var sidebar = document.getElementById('sidebar');
	var targetWidth = Math.max(document.body.clientWidth - sidebar.offsetWidth - 1,
	 canvasMinimumWidth);
	var targetHeight = document.body.clientHeight - 1;

	if(touchDevice) {
		targetWidth = window.innerWidth;
		//if(pencilGame)
		//	targetHeight = window.innerHeight - 20;
	}
	
	var scaleX = targetWidth/ this.width;
	var scaleY = targetHeight/ this.height;
	this.scale = Math.min(scaleX, scaleY);
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime + this.serverTimeDifference - this.ping
	 + extraGameStartTimeDifference;
	this.setGameState('countdown');
	var delay = this.gameStartTimestamp - Date.now();
	
	if(jsProfiling)
		console.profile('canvas performance');

	window.scroll(0, 0);
	this.audioController.playSound('countdown');
	this.playerListStart();
	// debugLog("starting game in " + delay + " milliseconds");

	this.calcScale();
	var container = document.getElementById(this.containerId);
	container.style.width = Math.round(this.scale * this.width) + 'px';
	container.style.height = Math.round(this.scale * this.height) + 'px';
	this.resizeNeeded = false;

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.containerId, canvasBgcolor);

	/* create background context */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseCanvas = canvas;
	this.baseContext = canvas.getContext('2d');
	this.setDefaultValues(this.baseContext);

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle,
		 startPositions[i].holeStart);
	}

	/* create foreground canvas */
	canvas = document.getElementById(this.canvasStack.createLayer());
	this.foregroundCanvas = canvas;
	this.foregroundContext = canvas.getContext('2d');
	this.setDefaultValues(this.foregroundContext);
	
	if(pencilGame)
		this.pencil.reset();
	
	var self = this;
	this.gameloopTimeout = window.setTimeout(function() { self.realStart(); }, delay + simStep);
	game.focusChat();
}

GameEngine.prototype.realStart = function() {
	// clearing angle indicators from base layer
	this.baseContext.clearRect(0, 0, this.width, this.height);
	this.audioController.playSound('gameStart');
	this.setGameState('playing');
	this.sendMsg('enableInput', {});

	var self = this;
	var gameloop = function() {
		var timeOut;
		var tellert = 0;

		do {
			if(self.gameState != 'playing' && self.gameState != 'watching')
				return;
				
			if(self.resizeNeeded)
				self.resize();

			if(tellert++ > 100) {
		 		debugLog("ERROR. stopping gameloop. debug information: next tick time = " +
		 		 ((self.tick + 1) * simStep) + ", current game time = " + 
		 		 (Date.now() - self.gameStartTimestamp));
		 		return;
		 	}

			while(self.tick - self.tock >= self.behind)
				self.doTock();
			self.doTick();
		} while((timeOut = (self.tick + 1) * simStep - (Date.now() - self.gameStartTimestamp)
		 + (simulateCPUlag && self.tick % 100 == 0 ? 400 : 0)) <= 0);

		self.gameloopTimeout = setTimeout(gameloop, timeOut);		
	}

	gameloop();
}

GameEngine.prototype.resize = function() {
	this.resizeNeeded = false;
	this.calcScale();
	var container = document.getElementById(this.containerId);
	var scaledWidth = Math.round(this.scale * this.width);
	var scaledHeight = Math.round(this.scale * this.height)
	container.style.width = scaledWidth + 'px';
	container.style.height = scaledHeight + 'px';
	
	var ctx = this.baseContext;
	var canvas = this.baseCanvas;
	canvas.width = scaledWidth;
	canvas.height = scaledHeight;
	this.setDefaultValues(ctx);
	
	ctx = this.foregroundContext;
	canvas = this.foregroundCanvas;
	canvas.width = scaledWidth;
	canvas.height = scaledHeight;
	this.setDefaultValues(ctx);
	
	for(var i = 0; i < this.players.length; i++) {
		var player = this.players[i];
		player.canvas.width = scaledWidth;
		player.canvas.height = scaledHeight;
		this.setDefaultValues(player.context);
		
		player.x = player.startX;
		player.y = player.startY;
		player.angle = player.startAngle
		player.velocity = player.startVelocity;
		player.tick = 0;
		player.turn = 0;
		player.nextInput = 0;
		if(player.isLocal) {
			player.simulate(this.tick, this.baseContext);
			player.saveLocation();
		}else{
			var tick = this.tick - safeTickDifference;
			if(player.finalTick < this.tock)
				tick = player.finalTick + 1;
			else if(player.inputs.length > 0)
				tick = Math.min(tick, player.inputs[player.inputs.length - 1].tick);
			player.simulate(tick, this.baseContext);
			player.saveLocation();
			player.simulate(this.tock, player.context);
		}
	}
}

GameEngine.prototype.setDefaultValues = function(ctx) {
	ctx.scale(this.scale, this.scale);
	ctx.lineWidth = lineWidth;
	ctx.lineCap = lineCapStyle;
}

GameEngine.prototype.displayDebugStatus = function() {
	document.getElementById('status').innerHTML = 
	 'redraws: ' + this.redraws + ' / ' + this.redrawsPossible +
	 ', modified inputs: ' + this.modifiedInputs +
	 ', game time adjustments: ' + this.adjustGameTimeMessagesReceived;
}

GameEngine.prototype.playerListStart = function() {
	for(var i = 0; i < this.players.length; this.updatePlayerList(i++, 'alive', null));
}

GameEngine.prototype.appendPlayerList = function(index) {
	var player = this.players[index];
	var row = document.createElement('tr');
	var nameNode = document.createElement('td');
	var statusNode = document.createElement('td');
	var pointsNode = document.createElement('td');

	// alleen naam in spelerkleur of ook status?
	if(this.gameState != 'lobby' && this.gameState != 'new')
		row.style.color = 'rgb(' + player.color[0] + ', ' + player.color[1] + ', '
		 + player.color[2] + ')';

	row.id = 'player' + index;
	nameNode.innerHTML = player.playerName;

	this.playerList.appendChild(row);
	row.appendChild(nameNode);
	row.appendChild(statusNode);
	row.appendChild(pointsNode);
	this.updatePlayerList(index, 'ready', 0);
}

GameEngine.prototype.updatePlayerList = function(index, status, points) {
	var row = document.getElementById('player' + index);

	if(status != null)
		row.childNodes[1].innerHTML = status;

	if(points != null)
		row.childNodes[2].innerHTML = points;
}

GameEngine.prototype.splicePlayerList = function(index) {
	var row = document.getElementById('player' + index);
	this.playerList.removeChild(row);
}

GameEngine.prototype.clearPlayerList = function() {
	while(this.playerList.hasChildNodes())
		this.playerList.removeChild(this.playerList.firstChild);
}

GameEngine.prototype.sendChat = function() {
	var msg = this.chatBar.value;

	if(this.gameState == 'new' || msg.length < 1)
		return;

	this.sendMsg('chat', {'message': msg});
	this.chatBar.value = '';
	this.printChat(this.localPlayerId, msg);
}

GameEngine.prototype.focusChat = function() {
	if(!touchDevice)
		this.chatBar.focus();
}

/* players */
function Player(color, local, index) {
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
	this.lcvelocity = 0;
	this.lcnextInput = 0;
	this.color = color;
	this.turn = 0; // -1 is turn left, 0 is straight, 1 is turn right
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.alive = true;
	this.inputs = [];
	this.nextInput = 0;
	this.inputsReceived = 0; // only for local player
	this.holeStart = 0;
	this.holeSize = 0;
	this.holeFreq = 0;
	this.tick = 0;
	this.index = index;
}

Player.prototype.saveLocation = function() {
	this.lcx = this.x;
	this.lcy = this.y;
	this.lca = this.angle;
	this.lcturn = this.turn;
	this.lcvelocity = this.velocity;
	this.lctick = this.tick;
	this.lcnextInput = this.nextInput;
}

Player.prototype.loadLocation = function() {
	this.x = this.lcx;
	this.y = this.lcy;
	this.angle = this.lca;
	this.turn = this.lcturn;
	this.velocity = this.lcvelocity;
	this.tick = this.lctick;
	this.nextInput = this.lcnextInput;
}

Player.prototype.steer = function(obj) {
	var localTick = this.isLocal ? this.game.tick : this.game.tock;
	if(!this.isLocal)
		this.inputs.push(obj);
	if(obj.tick > localTick && this.isLocal && obj.modified != undefined) {
		while(obj.tick > this.game.tick)
			this.game.doTick();
		debugLog('your game is running behind! ' + (this.game.tick - localTick) + 
		 ' ticks forwarded');
		localTick = this.game.tick;
	}else if(obj.tick >= localTick || (this.isLocal && obj.modified == undefined)) {
		if(!this.isLocal){
			this.game.redrawsPossible++;
			this.game.displayDebugStatus();
		}else
			this.inputsReceived++;
		return;
	}
	
	if(this.isLocal && obj.modified != undefined) {
		this.inputs[this.inputsReceived++].tick = obj.tick;
		// FIXME: inputs mogelijk niet meer op volgorde
		this.game.modifiedInputs++;
		this.game.displayDebugStatus();
	}
	
	this.loadLocation();
	var endTick = Math.min(obj.tick, localTick - safeTickDifference);
	this.simulate(endTick, this.game.baseContext);
	this.saveLocation();

	this.context.clearRect(0, 0, this.game.width, this.game.height);
	if(!this.isLocal) {
		this.game.redraws++;
		this.game.redrawsPossible++;
		this.game.displayDebugStatus();
	}
	this.simulate(localTick, this.context);
}

Player.prototype.finalSteer = function(obj) {
	var tick = obj.tick
	var localTick = this.isLocal ? this.game.tick : this.game.tock;
	
	for(var i = this.inputs.length - 1; i >= 0 && this.inputs[i].tick >= tick; i--);
	this.inputs.length = i + 2;
	this.inputs[i + 1] = {'tick': tick, 'finalTurn': true, 'x': obj.x, 'y': obj.y};
	this.finalTick = tick;

	if(tick >= localTick)
		return;
	
	this.loadLocation();
	this.simulate(tick + 1, this.game.baseContext);

	this.context.clearRect(0, 0, this.game.width, this.game.height);
}

Player.prototype.simulate = function(endTick, ctx) {
	if(this.tick >= endTick || this.tick == this.finalTick)
		return;
	var input = null, sin = Math.sin(this.angle),
	 cos = Math.cos(this.angle), step = simStep/ 1000;
	var inHole = (this.tick > this.holeStart && (this.tick + this.holeStart)
	 % (this.holeSize + this.holeFreq) < this.holeSize);

	ctx.beginPath();
	setLineColor(ctx, this.color, inHole ? gapAlpha : 1);
	ctx.lineCap = inHole ? 'butt' : lineCapStyle;
	if(debugBaseContext && ctx == this.game.baseContext)
		setLineColor(ctx, [0,0,0], inHole ? gapAlpha : 1);
	ctx.moveTo(this.x, this.y);
	

	if(this.nextInput < this.inputs.length)
		input = this.inputs[this.nextInput];
	
	for(; this.tick < endTick; this.tick++) {
		if(inHole !== (this.tick > this.holeStart && (this.tick + this.holeStart)
		 % (this.holeSize + this.holeFreq) < this.holeSize)) {
		 	inHole = !inHole;
			ctx.stroke();
			ctx.beginPath();
			setLineColor(ctx, this.color, inHole ? gapAlpha : 1);
			ctx.lineCap = inHole ? 'butt' : lineCapStyle;
			if(debugBaseContext && ctx == this.game.baseContext)
				setLineColor(ctx, [0,0,0], inHole ? gapAlpha : 1);
		}

		if(input != null && input.tick == this.tick) {
			if(input.finalTurn){
				this.x = input.x;
				this.y = input.y;
				ctx.lineTo(this.x, this.y);
				ctx.stroke();
				if(this.alive)
					this.simulateDead();
				return;
			}else{
				this.turn = input.turn;
				input = (++this.nextInput < this.inputs.length) ? this.inputs[this.nextInput] : null;
			}
		}

		if(this.turn != 0) {
			this.angle += this.turn * this.turnSpeed * step;
			cos = Math.cos(this.angle);
			sin = Math.sin(this.angle);
		}
			
		this.x += this.velocity * step * cos;
		this.y += this.velocity * step * sin;
		
		/* zo weer weg
		var a = 70/2;
		this.velocity += Math.cos(this.angle) * a / 1000 * simStep;
		if(this.velocity < 70)
			this.velocity = 70;
		else if(this.velocity > 105)
			this.velocity = 105; */
		
		ctx.lineTo(this.x, this.y);
	}
	ctx.stroke();
}

Player.prototype.simulateDead = function() {
	this.alive = false;
	this.game.updatePlayerList(this.index, 'dead', this.points);
	if(this.index == 0){
		this.game.setGameState('watching');
		this.game.audioController.playSound('localDeath');
	}
	var ctx = this.game.foregroundContext;
	setLineColor(ctx, [0,0,0], 1);
	ctx.lineWidth = crossLineWidth;
	ctx.beginPath();
	ctx.moveTo(this.x - crossRadius, this.y - crossRadius);
	ctx.lineTo(this.x + crossRadius, this.y + crossRadius);
	ctx.moveTo(this.x + crossRadius, this.y - crossRadius);
	ctx.lineTo(this.x - crossRadius, this.y + crossRadius);
	ctx.stroke();
	ctx.lineWidth = lineWidth;
}

Player.prototype.initialise = function(x, y, angle, holeStart) {
	this.startVelocity = this.lcvelocity = this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.holeStart = holeStart;
	this.holeSize = this.game.holeSize;
	this.holeFreq = this.game.holeFreq;
	this.alive = true;
	this.startX = this.lcx = this.x = x;
	this.startY = this.lcy = this.y = y;
	this.lctick = this.nextInput = 0;
	this.lcnextInput = 0;
	this.startAngle = this.lca = this.angle = angle;
	this.turn = this.lcturn = 0;
	this.inputs = [];
	this.tick = 0;
	this.inputsReceived = 0;
	this.lastSteerTick = -1;
	this.finalTick = -1;

	/* create canvas */
	var canvas = document.getElementById(this.game.canvasStack.createLayer());
	this.canvas = canvas;
	this.context = canvas.getContext('2d');
	this.game.setDefaultValues(this.context);

	/* draw angle indicator on base layer */
	var ctx = this.game.baseContext;
	setLineColor(ctx, this.color, 1);
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x += Math.cos(angle) * indicatorLength, y += Math.sin(angle) * indicatorLength);
	ctx.stroke();
	
	ctx.beginPath();
	var a = indicatorArrowOffset;
	var b = indicatorArrowLength;
	var c = ctx.lineWidth;
	var d = Math.PI/ 4;
	ctx.fillStyle = 'rgb('+this.color[0]+','+this.color[1]+','+this.color[2]+')';
	x += Math.cos(angle) * a;
	y += Math.sin(angle) * a;
	for(var i = 0; i < 2; i++){
		ctx.moveTo(x + Math.cos(angle - d) * c, y + Math.sin(angle - d) * c);
		ctx.arc(x, y, c, angle - d, angle + d, false);
		x += Math.cos(angle) * b;
		y += Math.sin(angle) * b;
		ctx.lineTo(x, y);
		ctx.closePath();
	}
	ctx.fill();
}

/* input control */
function InputController(player, left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = player;
}

InputController.prototype.keyDown = function(keyCode, e) {
	if(this.player.game == null || this.player.game.gameState != 'playing')
		return;
		
	if(e != undefined && (keyCode == this.rightKeyCode || keyCode == this.leftKeyCode))
		e.preventDefault();

	if(keyCode == this.rightKeyCode && this.player.turn != -1) 
		this.steerLocal(-1);
	
	else if(keyCode == this.leftKeyCode && this.player.turn != 1)
		this.steerLocal(1);
}

InputController.prototype.keyUp = function(keyCode, e) {
	if(this.player.game == null || this.player.game.gameState != 'playing')
		return;
		
	if(e != undefined && (keyCode == this.rightKeyCode || keyCode == this.leftKeyCode))
		e.preventDefault();

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) 
		this.steerLocal(0);
}

InputController.prototype.steerLocal = function(turn) {
	var game = this.player.game;
	var obj = {'turn': turn, 'tick': game.tick};

	if(this.player.lastSteerTick == obj.tick)
		obj.tick = ++this.player.lastSteerTick;
	else
		this.player.lastSteerTick = obj.tick;
	
	this.player.inputs.push(obj);

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
			game.focusChat();
		}
	}, false);
	canvas.addEventListener('mouseout', function(ev) {
		if(self.down){
			self.cur = ev;
			self.down = false;
			self.out = true;
			game.focusChat();
		}
	}, false);
}

Pencil.prototype.reset = function() {
	this.buffer = [];
	this.down = false;
	this.upped = false;
	this.out = false;
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
	if(this.down || this.upped || this.out){
		this.upped = false;
		var pos = this.getRelativeMousePos(this.last);
		var x1 = pos[0];
		var y1 = pos[1];
		pos = this.getRelativeMousePos(this.cur);
		var x2 = pos[0];
		var y2 = pos[1];
		var d = getLength(x2 - x1, y2 - y1);
		// zodat de muur niet net voor de rand stopt
		if(this.out && d < inkMinimumDistance){
			var a = x2 - x1;
			var b = y2 - y1;
			a *= inkMinimumDistance / d;
			b *= inkMinimumDistance / d;
			x2 = x1 + a;
			y2 = y1 + b;
		}
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
			if(this.ink == 0){
				this.down = false;
				game.focusChat();
			}
		}
		this.out = false;
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
	touchDevice = 'createTouch' in document;
	var audioController = new AudioController();
	game = new GameEngine('canvasContainer', 'playerList', 'chat', audioController);
	localPlayer = new Player(playerColors[0], true, 0);
	var inputControl = new InputController(localPlayer, keyCodeLeft, keyCodeRight);

	/* add sounds to controller */
	audioController.addSound('localDeath', 'sounds/wilhelm', ['ogg']);
	audioController.addSound('countdown', 'sounds/countdown', ['wav']);
	audioController.addSound('newPlayer', 'sounds/playerjoint', ['wav']);
	audioController.addSound('gameStart', 'sounds/whip', ['wav']);
	audioController.addSound('localWin', 'sounds/winning', ['mp3']);
	
	/* delegate key presses and releases */
	// stond document.body maar dan werken je keys niet meer na muisklik
	window.addEventListener('keydown',
	 function(e) { inputControl.keyDown(e.keyCode, e); }, false);
	window.addEventListener('keyup',
	 function(e) { inputControl.keyUp(e.keyCode, e); }, false);

	/* add listener for enter press for sending chat */
	document.getElementById('chat').addEventListener('keydown', function(e) {
		if(e.keyCode == chatSendKeyCode)
			game.sendChat();
	}, false);

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		var canvas = document.getElementById('canvasContainer');
		var sidebar = document.getElementById('sidebar');
		
		function touch(event, start) {
			var touch = event.changedTouches[0];
			var x = touch.pageX - sidebar.offsetWidth;
			var width = canvas.clientWidth;
			
			if(x < 0 || inputControl.player.game.gameState != 'playing')
				return;
			
			var left = (x < width / 3);
			if(x < width * 2 / 3 && !left)
				return;
				
			event.preventDefault();
			if(start)
				inputControl.keyDown(left ? keyCodeLeft : keyCodeRight);
			else
				inputControl.keyUp(left ? keyCodeLeft : keyCodeRight);
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

	function joinLobby() {
		var playerName = document.getElementById('playername').value;

		if(typeof playerName != "string" || playerName.length < 1) {
			debugLog('enter a cool playername please');
			return;
		}

		setCookie('playerName', localPlayer.playerName = playerName, 30);

		if(game.connected === false)
			game.connect(serverURL, "game-protocol", function() {
				game.joinLobby(localPlayer);
			});
		else
			game.joinLobby(localPlayer);
	}

	function reqGame() {
		var maxPlayers = parseInt(document.getElementById('maxplayers').value);
		var minPlayers = parseInt(document.getElementById('minplayers').value);
	
		if(maxPlayers > 8 || maxPlayers < 1 || minPlayers > 8 || minPlayers < 1
		 || minPlayers > maxPlayers) {
			debugLog('min/ maxplayers unacceptable!');
			return;
		}

		setCookie('maxPlayers', maxPlayers, 30);
		setCookie('minPlayers', minPlayers, 30);
		
		if(game.connected === false)
			game.connect(serverURL, "game-protocol", function() {
				game.requestGame(localPlayer, minPlayers, maxPlayers);
			});
		else
			game.requestGame(localPlayer, minPlayers, maxPlayers);
	}

	var lobbyButton = document.getElementById('lobby');
	lobbyButton.addEventListener('click', joinLobby, false);

	var startButton = document.getElementById('start');
	startButton.addEventListener('click', reqGame, false);

	var leaveButton = document.getElementById('stop');
	leaveButton.addEventListener('click', function() {
		game.leaveGame();
	}, false);

	var disconnectButton = document.getElementById('disconnect');
	disconnectButton.addEventListener('click', function() {
		game.disconnect();
	}, false);

	var minPlayers = getCookie('minPlayers');
	if(minPlayers != null)
		document.getElementById('minplayers').value = minPlayers;
	var maxPlayers = getCookie('maxPlayers');
	if(maxPlayers != null)
		document.getElementById('maxplayers').value = maxPlayers;
	var playerName = getCookie('playerName');

	/* auto join lobby if name is known */
	if(playerName != null && playerName != "") {
		document.getElementById('playername').value = playerName;
		joinLobby();
	}
	
	window.onresize = function() {
		this.clearTimeout(this.resizeTimeout);
		this.resizeTimeout = this.setTimeout(function() { game.resizeNeeded = true; }, 
		 resizeDelay);
	}
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

function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

function setOptionVisibility(target) {
	var sections = ['lobbyOptions', 'gameOptions', 'leaveOptions'];

	for(var i = 0; i < sections.length; i++) {
		var elt = document.getElementById(sections[i]);
		elt.style.display = (target == sections[i]) ? 'block' : 'none';
	}
}

function setContentVisibility(target) {
	var sections = ['gameListContainer', 'gameDetails', 'gameContainer'];

	for(var i = 0; i < sections.length; i++) {
		var elt = document.getElementById(sections[i]);
		elt.style.display = (target == sections[i]) ? 'block' : 'none';
	}
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
