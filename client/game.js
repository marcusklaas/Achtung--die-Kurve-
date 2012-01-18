/* game engine */
function GameEngine(audioController) {
	// game variables
	this.players = [];
	this.dict = []; // maps playerId.toString() to index of this.players
	this.gameStartTimestamp = null;
	this.tick = 0;
	this.tock = 0; // seperate tick for the other clients
	this.behind = behind;
	this.gameState = 'new'; // new, lobby, editing, waiting, countdown, playing, watching, ended

	// game properties
	this.torus = false;
	this.width = -1;
	this.height = -1;
	this.pencilMode = null; // on, off or ondeath
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
	this.containerId = 'canvasContainer'; // id of DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments
	this.resizeNeeded = false;

	// children
	this.pencil = new Pencil(this);
	this.audioController = audioController;
	this.localPlayerId = null;
	this.playerList = document.getElementById('playerList').lastChild;
	this.chatBar = document.getElementById('chat');
	this.editor = new Editor(this);

	// game param timers
	this.paramTimeout = null;
	this.unlockTimeout = null;
}

/* this only resets things like canvas, but keeps the player info */
GameEngine.prototype.reset = function() {
	this.canvasStack = null;
	this.baseContext = null;
	this.tick = 0;
	this.tock = 0;
	
	// debug counters
	this.redraws = 0;
	this.redrawsPrevented = 0;
	this.adjustGameTimeMessagesReceived = 0;
	this.modifiedInputs = 0;

	if(this.pencilMode != 'off')
		this.pencil.reset();

	var container = document.getElementById(this.containerId);
	while(container.hasChildNodes())
		container.removeChild(container.firstChild);
}

GameEngine.prototype.resetPlayers = function() {
	this.players = [];
	this.clearPlayerList();
	this.host = null;
}

GameEngine.prototype.getIndex = function(playerId) {
	return this.dict[playerId.toString()];
}

GameEngine.prototype.setIndex = function(playerId, index) {
	return this.dict[playerId.toString()] = index;
}

GameEngine.prototype.disconnect = function() {
	this.gameMessage('Disconnecting..');

	this.setGameState('new');
	this.connected = false;
	this.websocket = null;
	this.resetPlayers();
	this.reset();
}		

GameEngine.prototype.connect = function(url, name, callback) {
	if('MozWebSocket' in window)
		this.websocket = new MozWebSocket(url, name);
	else if('WebSocket' in window)
		this.websocket = new WebSocket(url, name);
	
	this.websocket.parent = this; // umm waarom?
	var game = this;
	
	try {
		this.websocket.onopen = function() {
			game.gameMessage('Connected to server');
			game.connected = true;
			game.syncWithServer();
			callback();
		}
		this.websocket.onmessage = function(msg) {
			if(simulatedPing > 0)
				window.setTimeout(function() {game.interpretMsg(msg);}, simulatedPing);
			else
				game.interpretMsg(msg);
		}
		this.websocket.onclose = function() {
			game.disconnect();
		}
	} catch(exception) {
		game.gameMessage('Websocket exception! ' + exception.name + ': ' + exception.message);
	}
}

GameEngine.prototype.leaveGame = function() {
	this.sendMsg('leaveGame', {});
	window.clearTimeout(this.gameloopTimeout);
}

/* this function handles user interface changes for state transitions */
GameEngine.prototype.setGameState = function(newState) {
	if(newState == 'new' || this.gameState == 'new') {
		var display = newState == 'new' ? 'none' : 'block';
		document.getElementById('playerListContainer').style.display = display;
		document.getElementById('chat').style.display = display;
	}

	switch(newState) {
		case 'lobby':
			setOptionVisibility('disconnect');
			setContentVisibility('gameListContainer');
			break;
		case 'editing':
			setContentVisibility('editor');
			break;
		case 'countdown':
			setContentVisibility('gameContainer');
			break;
		case 'waiting':
			setOptionVisibility('stop');
			setContentVisibility('waitContainer');
			break;
		case 'new':
			setContentVisibility('connectionContainer');
			setOptionVisibility('nothing');
			break;
	}

	this.gameState = newState;
}

GameEngine.prototype.joinGame = function(gameId) {
	this.sendMsg('join', {'id': gameId});
}

GameEngine.prototype.joinLobby = function(player) {
	this.sendMsg('joinLobby', {'playerName': player.playerName});
}

GameEngine.prototype.updateTitle = function(title) {
	if(this.title != title) {
		this.title = title;
		document.getElementById('gameTitle').innerHTML = this.title;
	}
}	

GameEngine.prototype.interpretMsg = function(msg) {
	var self = this;
	
	try {
		var obj = JSON.parse(msg.data);
	}
	catch(ex) {
		self.gameMessage('JSON parse exception!');
	}
	
	if(ultraVerbose && obj.mode != 'segments')
		this.gameMessage('Received data: ' + msg.data);

	switch(obj.mode) {
		case 'acceptUser':
			this.localPlayerId = obj.playerId;
			simStep = obj.tickLength;
			this.setIndex(obj.playerId, 0);
			break;
		case 'joinedGame':
			this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
			this.mapSegments = undefined;
			this.resetPlayers();
			this.addPlayer(localPlayer);
			if(obj.type == 'lobby') 
				this.updateTitle('Lobby');
			else
				this.nonhostContainer.innerHTML = obj.type == 'custom' ? customGameWaitMessage :
				 autoMatchWaitMessage;
			if(obj.type == 'auto')
				this.setHost(null);
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
			break;
		case 'setMap':
			this.mapSegments = obj.segments;
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
			if(acceptGameTimeAdjustments) {
				this.gameMessage('Adjusted game time by ' + obj.forward + ' msec');
				this.gameStartTimestamp -= obj.forward;
				this.ping += obj.forward;
				this.adjustGameTimeMessagesReceived++;
				this.displayDebugStatus();
			} else
				this.gameMessage('Game time adjustment of ' + obj.forward + ' msec rejected');
			break;
		case 'playerLeft':
			var index = this.getIndex(obj.playerId);
			if(this.gameState != 'lobby')
				this.gameMessage(this.players[index].playerName + " left the game");

			if(this.gameState == 'waiting' || this.gameState == 'lobby') {
				this.splicePlayerList(index);
				
				for(var i = index + 1; i < this.players.length; i++) {
					this.players[i].index--;
					this.players[i].color = playerColors[i - 1];
					this.setIndex(this.players[i].playerId, i - 1);
				}

				this.players.splice(index, 1);
			}
			else{
				this.players[index].state = 'left';
				this.updatePlayerList(index, 'left', null);
			}
			break;
		case 'playerDied':
			var index = this.getIndex(obj.playerId);
			var player = this.players[index];
			player.points = obj.points;
			player.finalSteer(obj);

			if(index == 0 && this.pencilMode == 'ondeath')
				this.pencil.drawingAllowed = true;
			break;
		case 'endRound':
			window.clearTimeout(this.gameloopTimeout);
			var index = (obj.winnerId != -1) ? this.getIndex(obj.winnerId) : null;
			var winner = (index != null) ? (this.players[index].playerName + ' won') : 'draw!';
			this.setGameState('countdown');
			this.updatePlayerList(index, null, obj.points);
			this.gameMessage('Round ended: ' + winner);
			break;			
		case 'endGame':
			this.setGameState('ended');
			window.clearTimeout(this.gameloopTimeout);
			this.gameMessage('Game over: ' + this.players[this.getIndex(obj.winnerId)].playerName + ' won!');

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
			this.gameMessage('You are flooding the chat. Your latest message has been blocked');
			break;
		case 'setHost':
			if(this.gameState == 'waiting')
				this.setHost(this.getIndex(obj.playerId));
			break;
		default:
			this.gameMessage('Unknown mode ' + obj.mode + '!');
	}
}

GameEngine.prototype.setHost = function(id) {
	if(this.host != null)
		this.updatePlayerList(this.host.index, 'ready', null);
	if(id != null) {
		this.updatePlayerList(id, 'host', null);
		this.host = this.players[id];
	} else
		this.host = null;
		
	var hostBlock = this.host == localPlayer ? 'block' : 'none';
	var nonhostBlock = this.host == localPlayer ? 'none' : 'block';
	this.hostContainer.style.display = hostBlock;
	this.nonhostContainer.style.display = nonhostBlock;

	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++)
		inputElts[i].disabled = (this.host != localPlayer);
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
	var container = document.getElementById('messages');
	var elt = document.createElement('li');
	var nameContainer = document.createElement('span');
	var displayName = playerId == this.localPlayerId ? 'me' : this.players[this.getIndex(playerId)].playerName;

	nameContainer.innerHTML = displayName;
	nameContainer.className = 'player';
	elt.innerHTML = escaped;
	elt.className = 'chatMessage';
	
	elt.insertBefore(nameContainer, elt.firstChild);
    container.insertBefore(elt, container.firstChild);
}

GameEngine.prototype.gameMessage = function(msg) {
	var container = document.getElementById('messages');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
	elt.className = 'gameMessage';
    container.insertBefore(elt, container.firstChild);
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
	} else
		this.ping += Math.round(ping / (syncTries - 1));

	if(++this.syncTries < syncTries) {
		var self = this;
		window.setTimeout(function() {self.syncWithServer();},
		 this.syncTries * syncDelays);
	} 
	else {
		this.gameMessage('Your current ping is ' + this.ping + ' msec');
		if(ultraVerbose)
			this.gameMessage('synced with maximum error of ' + this.bestSyncPing + ' msec');
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
	this.pencilMode = obj.pencilmode;
	this.torus = (obj.torus != 0);

	if(this.pencilMode != 'off') {
		this.pencil.inkPerSec = obj.inkregen;
		this.pencil.maxInk = obj.inkcap;
		// TODO: set the rest of the pencils vars
	}
	
	if(obj.type != 'lobby') {
		document.getElementById('nmin').value = obj.nmin;
		document.getElementById('nmax').value = obj.nmax;
		document.getElementById('width').value = this.width;
		document.getElementById('height').value = this.height;
		document.getElementById('velocity').value = this.velocity;
		document.getElementById('turnSpeed').value = this.turnSpeed;
		document.getElementById('holeSize').value = this.holeSize;
		document.getElementById('holeFreq').value = this.holeFreq;
		document.getElementById('goal').value = obj.goal;
		document.getElementById('torus').checked = this.torus;
		document.getElementById('inkCapacity').value = obj.inkcap;
		document.getElementById('inkRegen').value = obj.inkregen;
		document.getElementById('inkDelay').value = obj.inkdelay;

		setPencilMode(obj.pencilmode);
		this.updateTitle('Game ' + obj.id);
	}
}

GameEngine.prototype.requestGame = function(player, minPlayers, maxPlayers) {
	this.sendMsg('requestGame', {'playerName': player.playerName,
	 'minPlayers': minPlayers, 'maxPlayers': maxPlayers});
	// TODO: zet de knop disabled tot bericht van de server? dan ziet de user
	// dat er echt op de knop is gedrukt bij veel lag
	// ook bij andere knoppen als createGame, leaveGame, joinLobby, joinGame
}

GameEngine.prototype.createGame = function() {
	this.sendMsg('createGame', {});
}

GameEngine.prototype.sendMsg = function(mode, data) {
	if(this.connected === false) {
		this.gameMessage('Tried to send msg, but no websocket connection');
		return;
	}

	data.mode = mode;
	var str = JSON.stringify(data);
	
	if(simulatedPing > 0) {
		var that = this;
		window.setTimeout(function() {
			that.websocket.send(str);
			if(ultraVerbose)
				this.gameMessage('Sending data: ' + str);
		}, simulatedPing);	
	}
	else{
		this.websocket.send(str);
		if(ultraVerbose)
			this.gameMessage('Sending data: ' + str);
	}
}

GameEngine.prototype.syncWithServer = function() {
	this.syncSendTime = Date.now();
	this.sendMsg('getTime', {});
}

GameEngine.prototype.doTick = function() {
	var player = this.players[0];
	this.tick++;

	if(this.pencilMode != 'off')
		this.pencil.doTick();

	if(player.state == 'alive')
		player.simulate(this.tick, player.context);
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
		if(player.state != 'alive')
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
		//if(pencilGame != 'off')
		//	targetHeight = window.innerHeight - 20;
	}
	
	var scaleX = targetWidth/ this.width;
	var scaleY = targetHeight/ this.height;
	this.scale = Math.min(scaleX, scaleY);
}

GameEngine.prototype.unlockStart = function() {
	document.getElementById('startGame').disabled = false;
	this.unlockTimeout = null;
}

GameEngine.prototype.sendParams = function() {
	var obj = {};
	obj.goal = parseInt(document.getElementById('goal').value);
	obj.v = parseInt(document.getElementById('velocity').value);
	obj.w = parseInt(document.getElementById('width').value);
	obj.h = parseInt(document.getElementById('height').value);
	obj.ts = parseFloat(document.getElementById('turnSpeed').value);
	obj.hsize = parseInt(document.getElementById('holeSize').value);
	obj.hfreq = parseInt(document.getElementById('holeFreq').value);
	obj.pencilmode = getPencilMode();
	obj.nmax = parseInt(document.getElementById('nmax').value);
	obj.torus = document.getElementById('torus').checked ? 1 : 0;
	obj.inkcap = parseInt(document.getElementById('inkCapacity').value);
	obj.inkregen = parseInt(document.getElementById('inkRegen').value);
	obj.inkdelay = parseInt(document.getElementById('inkDelay').value);

	this.paramTimeout = null;
	this.sendMsg('setParams', obj);
}

GameEngine.prototype.sendStartGame = function() {
	var obj = {};

	if(this.editor.segments.length > 0) {
		obj.segments = this.editor.segments;
		this.editor.segments = [];
	}

	this.sendMsg('startGame', obj);
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime + this.serverTimeDifference - this.ping
	 + extraGameStartTimeDifference;
	this.setGameState('countdown');
	var delay = this.gameStartTimestamp - Date.now();
	
	if(jsProfiling)
		console.profile('canvas performance');

	this.audioController.playSound('countdown');
	this.calcScale();
	var container = document.getElementById(this.containerId);
	container.style.width = Math.round(this.scale * this.width) + 'px';
	container.style.height = Math.round(this.scale * this.height) + 'px';
	this.resizeNeeded = false;

	/* Scroll to right for touch devices */
	window.scroll(document.body.offsetWidth, 0);

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.containerId, canvasBgcolor);

	/* create background context */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseCanvas = canvas;
	this.baseContext = canvas.getContext('2d');
	this.setDefaultValues(this.baseContext);
	this.drawMapSegments();

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);

		if(this.players[index].state != 'left')
			this.players[index].initialise(startPositions[i].startX,
			 startPositions[i].startY, startPositions[i].startAngle,
			 startPositions[i].holeStart);
	}

	/* create foreground canvas */
	canvas = document.getElementById(this.canvasStack.createLayer());
	this.foregroundCanvas = canvas;
	this.foregroundContext = canvas.getContext('2d');
	this.setDefaultValues(this.foregroundContext);
	
	var self = this;
	this.gameloopTimeout = window.setTimeout(function() { self.realStart(); }, delay + simStep);
	game.focusChat();
}

GameEngine.prototype.realStart = function() {
	// clearing angle indicators from base layer
	this.baseContext.clearRect(0, 0, this.width, this.height);
	this.drawMapSegments();
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
		 		this.gameMessage("ERROR. stopping gameloop. debug information: next tick time = " +
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

GameEngine.prototype.drawMapSegments = function() {
	if(this.mapSegments == undefined)
		return;
	var ctx = this.baseContext;
	ctx.beginPath();
	setLineColor(ctx, mapSegmentColor, 1);
	for(var i = 0; i < this.mapSegments.length; i++) {
		var seg = this.mapSegments[i];
		ctx.moveTo(seg.x1, seg.y1);
		ctx.lineTo(seg.x2, seg.y2);
	}
	ctx.stroke();
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
	
	this.drawMapSegments();
	
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
		var knownTick;
		if(player.isLocal)
			knownTick = player.inputsReceived > 0 ? player.inputs[player.inputsReceived - 1].tick : 0;
		else if(player.finalTick < this.tock)
			knownTick = player.finalTick + 1;
		else {
			knownTick = this.tock - safeTickDifference;
			if(player.inputs.length > 0)
				knownTick = Math.min(knownTick, player.inputs[player.inputs.length - 1].tick);
		}
		player.simulate(knownTick, this.baseContext);
		player.saveLocation();
		player.simulate(player.isLocal ? this.tick : this.tock, player.context);
	}

	if(this.pencilMode != 'off')
		this.pencil.drawPlayerSegs(true);
}

GameEngine.prototype.setDefaultValues = function(ctx) {
	ctx.scale(this.scale, this.scale);
	ctx.lineWidth = lineWidth;
	ctx.lineCap = lineCapStyle;
}

GameEngine.prototype.displayDebugStatus = function() {
	if(displayDebugStatus)
		document.getElementById('status').innerHTML = 
		 'redraws: ' + this.redraws + ' (' + this.redrawsPrevented +
		 ' prevented), modified inputs: ' + this.modifiedInputs +
		 ', game time adjustments: ' + this.adjustGameTimeMessagesReceived;
}

GameEngine.prototype.appendPlayerList = function(index) {
	var player = this.players[index];
	var row = document.createElement('tr');
	var nameNode = document.createElement('td');
	var statusNode = document.createElement('td');
	var pointsNode = document.createElement('td');

	if(this.gameState != 'lobby')
		nameNode.style.color = 'rgb(' + player.color[0] + ', ' + player.color[1] + ', '
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
	this.state = 'alive'; // alive, dead or left
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
	
	if(!this.isLocal) {
		// inputs of non-local user can just be added
		this.inputs.push(obj);
		
		// if we have not yet simulated the tick of this message, return;
		if(obj.tick >= localTick) {
			if(obj.tick < this.game.tick) {
				this.game.redrawsPrevented++;
				this.game.displayDebugStatus();
			}
			return;
		}
	} else if(!obj.modified) {
		// nothing to be done for unmodified local steer message
		this.inputsReceived++;
		return;	
	} else {
		// modify corresponding local input entry
		this.inputs[this.inputsReceived++].tick = obj.tick;
		
		this.game.modifiedInputs++;
		this.game.displayDebugStatus();
	}
	
	this.loadLocation();
	var endTick = Math.min(obj.tick + 1, localTick - safeTickDifference);
	this.simulate(endTick, this.game.baseContext);
	this.saveLocation();

	this.context.clearRect(0, 0, this.game.width, this.game.height);
	if(!this.isLocal) {
		this.game.redraws++;
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
			ctx.moveTo(this.x, this.y);
			setLineColor(ctx, this.color, inHole ? gapAlpha : 1);
			ctx.lineCap = inHole ? 'butt' : lineCapStyle;
			if(debugBaseContext && ctx == this.game.baseContext)
				setLineColor(ctx, [0,0,0], inHole ? gapAlpha : 1);
		}

		if(input != null && input.tick == this.tick) {
			if(input.finalTurn) {
				this.x = input.x;
				this.y = input.y;
				ctx.lineTo(this.x, this.y);
				ctx.stroke();
				if(this.state == 'alive')
					this.simulateDead();
				return;
			} else {
				this.turn = input.turn;
				input = (++this.nextInput < this.inputs.length) ? this.inputs[this.nextInput] : null;
			}
		}

		if(this.turn != 0) {
			this.angle += this.turn * this.turnSpeed * step;
			cos = Math.cos(this.angle);
			sin = Math.sin(this.angle);
		}

		var oldx = this.x, oldy = this.y;
		ctx.lineTo(this.x += this.velocity * step * cos, this.y += this.velocity * step * sin);

		/* wrap around */
		if(this.game.torus && (this.x < 0 || this.x > this.game.width ||
		 this.y < 0 || this.y > this.game.height)) {
			if(this.x > this.game.width)
				this.x = oldx - this.game.width;
			else if(this.x < 0)
				this.x = oldx + this.game.width;

			if(this.y > this.game.height)
				this.y = oldy - this.game.height;
			else if(this.y < 0)
				this.y = oldy + this.game.height;

			ctx.moveTo(this.x, this.y);
			ctx.lineTo(this.x += this.velocity * step * cos, this.y += this.velocity * step * sin);
		}
	}
	ctx.stroke();
}

Player.prototype.simulateDead = function() {
	this.state = 'dead';
	this.game.updatePlayerList(this.index, 'dead', this.points);
	if(this.index == 0) {
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
	this.state = 'alive';
	this.startX = this.lcx = this.x = x;
	this.startY = this.lcy = this.y = y;
	this.lctick = this.nextInput = 0;
	this.lcnextInput = 0;
	this.startAngle = this.lca = this.angle = angle;
	this.turn = this.lcturn = 0;
	this.inputs = [];
	this.tick = 0;
	this.lcnextInput = this.nextInput = 0;
	this.inputsReceived = 0;
	this.lastSteerTick = -1;
	this.finalTick = Infinity;

	this.game.updatePlayerList(this.index, 'alive', null)

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
	for(var i = 0; i < 2; i++) {
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
	this.maxInk = 0;
	this.inkPerSec = 0;
	this.game = game;
	this.reset();
	
	var canvas = document.getElementById(game.containerId);
	var self = this;

	canvas.addEventListener('mousedown', function(ev) {
		if(self.drawingAllowed && !self.down && self.ink > mousedownInk) {
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
		if(self.drawingAllowed && self.down)
			self.cur = ev;
	}, false);

	canvas.addEventListener('mouseup', function(ev) {
		if(self.drawingAllowed && self.down) {
			self.cur = ev;
			self.down = false;
			self.upped = true;
			game.focusChat();
		}
	}, false);

	canvas.addEventListener('mouseout', function(ev) {
		if(self.drawingAllowed && self.down) {
			self.cur = ev;
			self.down = false;
			self.out = true;
			game.focusChat();
		}
	}, false);
}

Pencil.prototype.reset = function() {
	this.drawingAllowed = (this.game.pencilMode == 'on');
	this.buffer = [];
	this.down = false;
	this.upped = false;
	this.out = false;
	this.inbuffer = [];
	this.inbufferIndex = [];
	this.inbufferSolid = [];
	this.inbufferSolidIndex = [];
	this.ink = startInk;
	this.players = this.game.players.length;

	for(var i = 0; i < this.players; i++) {
		this.inbuffer[i] = [];
		this.inbufferIndex[i] = 0;
		this.inbufferSolid[i] = [];
		this.inbufferSolidIndex[i] = 0;
	}

	this.inbufferSolid.length = this.inbuffer.length = this.players;
	this.inbufferIndex.length = this.inbufferSolidIndex.length = this.players;
	var pos = findPos(document.getElementById(this.game.containerId));
	this.canvasLeft = pos[0];
	this.canvasTop = pos[1];
}

Pencil.prototype.doTick = function() {
	this.ink += this.inkPerSec / 1000 * simStep;

	if(this.ink > this.maxInk)
		this.ink = this.maxInk;

	if(this.drawingAllowed && (this.down || this.upped || this.out)) {
		var pos = this.getRelativeMousePos(this.last);
		var x1 = pos[0];
		var y1 = pos[1];
		pos = this.getRelativeMousePos(this.cur);
		var x2 = pos[0];
		var y2 = pos[1];
		var d = getLength(x2 - x1, y2 - y1);

		// zodat de muur niet net voor de rand stopt
		if(this.out && d < inkMinimumDistance) {
			var a = x2 - x1;
			var b = y2 - y1;
			a *= inkMinimumDistance / d;
			b *= inkMinimumDistance / d;
			x2 = x1 + a;
			y2 = y1 + b;
		}

		if((d >= inkMinimumDistance || d >= this.ink) && this.ink > 0) {
			if(this.ink < d) {
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
			if(this.ink == 0) {
				this.down = false;
				game.focusChat();
			}
		}

		this.upped = this.out = false;
	}

	if(this.game.tick % inkBufferTicks == 0 && this.buffer.length > 0) {
		this.game.sendMsg('pencil', {'data' : this.buffer});
		this.buffer = [];
	}

	this.drawPlayerSegs(false);
}

Pencil.prototype.drawPlayerSegs = function(redraw) {
	for(var i = 0; i < this.players; i++) {
		var buffer = this.inbuffer[i];
		var index = (redraw) ? 0 : this.inbufferIndex[i];
		var seg;

		while(index < buffer.length && buffer[index].tickVisible <= this.game.tick) {
			seg = buffer[index++];
			
			if((i > 0 || redraw) && seg.tickSolid > this.game.tick)
				this.drawSegment(seg.x1, seg.y1, seg.x2, seg.y2, i, pencilAlpha);

			if(!redraw)
				this.inbufferSolid[i].push(seg);
		}

		this.inbufferIndex[i] = index;
		buffer =  this.inbufferSolid[i];
		index = (redraw) ? 0 : this.inbufferSolidIndex[i];

		while(index < buffer.length && buffer[index].tickSolid <= this.game.tick) {
			var seg = buffer[index++];
			this.drawSegment(seg.x1, seg.y1, seg.x2, seg.y2, i, 1);

			if(!redraw) {
				this.inbuffer[i].shift();
				this.inbufferIndex[i]--;
			}
		}

		this.inbufferSolidIndex[i] = index;
	}
}

Pencil.prototype.drawSegment = function(x1, y1, x2, y2, playerIndex, alpha) {
	var ctx = this.game.baseContext;
	ctx.beginPath();
	setLineColor(ctx, this.game.players[playerIndex].color, alpha);
	var tmp = ctx.lineCap;
	ctx.lineCap = alpha == 1 ? lineCapStyle : 'butt';
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.lineCap = tmp;
}

Pencil.prototype.handleMessage = function(ar) {
	for(var i = 0; i < ar.length; i++) {
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

/* Map editor */
Editor = function(game) {
	this.game = game;
	this.down = false;
	this.canvas = document.getElementById('editorCanvas');
	this.context = this.canvas.getContext('2d');
	this.container = document.getElementById('editor');
	this.textField = document.getElementById('editorTextField');
	this.pos = [0, 0];
	this.segments = [];
	var self = this;

	this.canvas.style.backgroundColor = canvasBgcolor;
	this.canvas.addEventListener('mousedown', function(ev) { self.onmouse('down', ev); }, false);
	this.canvas.addEventListener('mousemove', function(ev) { self.onmouse('move', ev); }, false);
	document.body.addEventListener('mouseup', function(ev) { self.onmouse('up', ev); }, false);
	this.canvas.addEventListener('mouseout', function(ev) { self.onmouse('out', ev); }, false);
	this.canvas.addEventListener('mouseover', function(ev) { self.onmouse('over', ev); }, false);

	var reset = document.getElementById('editorReset');
	reset.addEventListener('click', function() { self.reset(); }, false);

	var copy = document.getElementById('editorCopy');
	copy.addEventListener('click', function() { self.copy(); }, false);

	var load = document.getElementById('editorLoad');
	load.addEventListener('click', function() { self.load(); }, false);

	var start = document.getElementById('editorStart');
	start.addEventListener('click', function() {
		self.game.setGameState('editing');

		if(self.segments.length == 0)
			self.reset();
	}, false);

	var stop = document.getElementById('editorStop');
	stop.addEventListener('click', function() { self.game.setGameState('waiting'); }, false);
}

Editor.prototype.onmouse = function(type, ev) {
	var pos = getMousePos(ev);
	pos[0] -= this.pos[0];
	pos[1] -= this.pos[1];
	if(type == 'down' || (this.out && type == 'over' && this.down)) {
		this.lastPos = pos;
		this.lastTime = Date.now();
		this.out = false;
		this.down = true;
	}
	else if(this.down && (type == 'out' || type == 'up' || 
	 (type == 'move' && Date.now() - this.lastTime > editorStepTime))) {
	 	if(!this.out) {
			var seg = new BasicSegment(this.lastPos[0], this.lastPos[1], pos[0], pos[1]);
			this.segments.push(seg);
			this.drawSegment(seg);
			this.lastPos = pos;
			this.lastTime = Date.now();
		}
		if(type == 'out')
			this.out = true;
		else if(type == 'up')
			this.down = false;
	}
}

Editor.prototype.drawSegment = function(seg) {
	this.context.beginPath();
	this.context.moveTo(seg.x1, seg.y1);
	this.context.lineTo(seg.x2, seg.y2);
	this.context.stroke();
}

Editor.prototype.reset = function() {
	// TODO: dit moet ook zo'n soort schaling krijgen
	// editor full size (maar nog wel ruimte voor buttons ofc)
	this.canvas.width = this.game.width;
	this.canvas.height = this.game.height;
	this.context.lineWidth = 3;
	setLineColor(this.context, mapSegmentColor, 1);
	this.context.lineCap = 'round';
	this.pos = findPos(this.canvas);
	this.segments = [];
	this.out = false;
}

Editor.prototype.copy = function() {
	this.textField.value = JSON.stringify(this.segments);
}

Editor.prototype.load = function() {
	var game = this.game;

	try {
		var segs = JSON.parse(this.textField.value);
	}
	catch(ex) {
		game.gameMessage('JSON parse exception!');
	}

	for(var i = 0; i < segs.length; i++)
		this.drawSegment(segs[i]);

	this.segments = this.segments.concat(segs);
}

BasicSegment = function(x1, y1, x2, y2) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
}

/* create game */
window.onload = function() {
	/* some objects */
	touchDevice = 'createTouch' in document;
	var audioController = new AudioController();
	game = new GameEngine(audioController);
	localPlayer = new Player(playerColors[0], true, 0);
	var inputControl = new InputController(localPlayer, keyCodeLeft, keyCodeRight);

	/* add sounds to controller */
	audioController.addSound('localDeath', 'sounds/wilhelm', ['ogg']);
	audioController.addSound('countdown', 'sounds/countdown', ['wav']);
	audioController.addSound('newPlayer', 'sounds/playerjoint', ['wav']);
	audioController.addSound('gameStart', 'sounds/whip', ['wav']);
	audioController.addSound('localWin', 'sounds/winning', ['mp3']);
	
	/* delegate key presses and releases */
	window.addEventListener('keydown',
	 function(e) { inputControl.keyDown(e.keyCode, e); }, false);
	window.addEventListener('keyup',
	 function(e) { inputControl.keyUp(e.keyCode, e); }, false);

	/* add listener for chat submit */
	document.getElementById('chatForm').addEventListener('submit', function(e) {
		game.sendChat();
		e.preventDefault();
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

	/* hide alert box for browsers with websockets */
	if('WebSocket' in window || 'MozWebSocket' in window)
		document.getElementById('noWebsocket').style.display = 'none';

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
			game.gameMessage('Enter a cool nickname please');
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
			game.gameMessage('Min/ maxplayers unacceptable!');
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
	
	var createButton = document.getElementById('createGame');
	createButton.addEventListener('click', function() { game.createGame(); }, false);

	var leaveButton = document.getElementById('stop');
	leaveButton.addEventListener('click', function() {
		game.leaveGame();
	}, false);

	var disconnectButton = document.getElementById('disconnect');
	disconnectButton.addEventListener('click', function() {
		game.websocket.close();
	}, false);
	
	var startGameButton = document.getElementById('startGame');
	startGameButton.addEventListener('click', function() { game.sendStartGame(); }, false);
	
	game.hostContainer = document.getElementById('hostContainer');
	game.nonhostContainer = document.getElementById('nonhostContainer');

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

	function updateParams() {
		/* if paramTimeout != null, then a paramupdate is already scheduled
		 * and it will pick this change as well so we dont need 2 do nething */
		if(game.paramTimeout === null) {
			game.paramTimeout = window.setTimeout(function() {
				game.sendParams();
			}, paramUpdateInterval);

			document.getElementById('startGame').disabled = true;

			if(game.unlockTimeout !== null)
				window.clearTimeout(game.unlockTimeout);

			game.unlockTimeout = window.setTimeout(function() {
				game.unlockStart();
			}, unlockInterval + paramUpdateInterval);
		}
	}

	/* add event handlers to schedule paramupdate message when game options are changed */
	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++)
		inputElts[i].addEventListener(inputElts[i].type == 'text' ? 'input' : 'change', updateParams, false);
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

function setOptionVisibility(target) {
	var sections = ['disconnect', 'stop'];

	for(var i = 0; i < sections.length; i++) {
		var elt = document.getElementById(sections[i]);
		elt.style.display = (target == sections[i]) ? 'block' : 'none';
	}
}

function setContentVisibility(target) {
	var sections = ['connectionContainer', 'gameListContainer', 'editor',
	 'waitContainer', 'gameContainer'];

	for(var i = 0; i < sections.length; i++) {
		var elt = document.getElementById(sections[i]);
		elt.style.display = (target == sections[i]) ? 'block' : 'none';
	}
}

function getPencilMode() {
	if(document.getElementById('pencilOn').lastChild.checked)
		return 'on';

	if(document.getElementById('pencilOff').lastChild.checked)
		return 'off';

	if(document.getElementById('pencilOnDeath').lastChild.checked)
		return 'ondeath';

	return null;
}

function setPencilMode(mode) {
	var sections = ['pencilOn', 'pencilOff', 'pencilOnDeath'];
	var selected = 0;

	if(mode == 'off')
		selected = 1;
	if(mode == 'ondeath')
		selected = 2;

	for(var i = 0; i < sections.length; i++)
		document.getElementById(sections[i]).lastChild.checked = (i == selected);
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
	return [curleft, curtop];
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
