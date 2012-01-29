/* game engine */
function GameEngine(localPlayer, audioController) {
	// game variables
	this.players = [];
	this.dict = []; // maps playerId.toString() to index of this.players
	this.tickTockDifference = tickTockDifference;
	this.gameState = 'new'; // new, lobby, editing, waiting, countdown, playing, watching, ended
	this.gameType = null;

	// connection state
	this.connected = false;

	// canvas related
	this.canvasContainer = document.getElementById('canvasContainer');
	this.baseCanvas = document.getElementById('baseCanvas');
	this.baseContext = this.baseCanvas.getContext('2d');
	this.setDefaultValues(this.baseContext);
	this.foregroundCanvas = document.getElementById('foregroundCanvas');
	this.foregroundContext = this.foregroundCanvas.getContext('2d');
	this.setDefaultValues(this.foregroundContext);

	// children
	this.localPlayer = localPlayer;
	this.pencil = new Pencil(this);
	this.audioController = audioController;
	this.playerList = document.getElementById('playerList').lastChild;
	this.chatBar = document.getElementById('chat');
	this.editor = new Editor(this);
}

/* this only resets things like canvas, but keeps the player info */
GameEngine.prototype.reset = function() {
	this.tick = -1;
	this.tock = 0;
	this.redraws = 0;
	this.redrawsPrevented = 0;
	this.adjustGameTimeMessagesReceived = 0;
	this.modifiedInputs = 0;

	if(this.pencilMode != 'off')
		this.pencil.reset();

	/* clear canvasses */
	this.foregroundContext.clearRect(0, 0, this.width, this.height);
	this.baseContext.clearRect(0, 0, this.width, this.height);
}

GameEngine.prototype.resetPlayers = function() {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].deleteCanvas();

	this.players = [];
	this.clearPlayerList();
	this.host = null;
}

GameEngine.prototype.getIndex = function(playerId) {
	return this.dict[playerId.toString()];
}

GameEngine.prototype.getPlayer = function(playerId) {
	return this.players[this.getIndex(playerId)];
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
}		

GameEngine.prototype.connect = function(url, name, callback) {
	if('MozWebSocket' in window)
		this.websocket = new MozWebSocket(url, name);
	else if('WebSocket' in window)
		this.websocket = new WebSocket(url, name);
	
	var self = this;
	
	try {
		this.websocket.onopen = function() {
			self.gameMessage('Connected to server');
			self.connected = true;
			self.syncWithServer();
			callback();
		}
		this.websocket.onmessage = function(msg) {
			if(simulatedPing > 0)
				window.setTimeout(function() {self.interpretMsg(msg);}, simulatedPing);
			else
				self.interpretMsg(msg);
		}
		this.websocket.onclose = function() {
			self.disconnect();
		}
	} catch(exception) {
		self.gameMessage('Websocket exception! ' + exception.name + ': ' + exception.message);
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
		document.getElementById('gameTitle').style.display = display;
		document.getElementById('chatForm').style.display = display;
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
		case 'playing':
			setOptionVisibility('stop');
			break;
		case 'ended':
			if(this.gameType == 'custom')
				setOptionVisibility('back');
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
	player.playerName = escapeString(player.playerName);
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
			/* cool, we are accepted. lets adopt the server constants */
			this.localPlayer.playerId = obj.playerId;
			this.tickLength = obj.tickLength;
			this.pencil.inkMinimumDistance = obj.inkMinimumDistance;
			this.maxNameLen = obj.maxNameLength;
			break;
		case 'joinedGame':
			this.localPlayer.status = 'ready';
			this.localPlayer.isHost = false;
			this.localPlayer.points = 0;
			this.gameType = obj.type;
			this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
			this.mapSegments = undefined;
			this.editor.segments = [];
			this.resetPlayers();
			this.addPlayer(this.localPlayer);

			if(obj.type == 'lobby') {
				this.updateTitle('Lobby');
				var index = window.location.href.indexOf('?game=', 0)

				if(!joinedLink && index != -1) {
					this.joinGame(parseInt(window.location.href.substr(index + 6)));
					joinedLink = true;
				}
			}
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
			newPlayer.playerName = escapeString(obj.playerName);
			this.addPlayer(newPlayer);
			this.audioController.playSound('newPlayer');
			break;
		case 'setMap':
			this.mapSegments = obj.segments;
			break;
		case 'startGame':
			/* keep displaying old game for a while so ppl can see what happened */
			var nextRoundDelay = obj.startTime - this.serverTimeDifference - this.ping
			 + extraGameStartTimeDifference - Date.now();
			 
			// first back to game lobby for some reset work
			if(this.gameState == 'ended')
				this.backToGameLobby();

			if(nextRoundDelay > this.countdown) {
				var self = this;

				this.gameloopTimeout = window.setTimeout(function() {
					self.start(obj.startPositions, obj.startTime);
				}, nextRoundDelay - this.countdown);
			}
			else
				this.start(obj.startPositions, obj.startTime);
			break;
		case 'input':
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
			var player = this.players[index];
			
			if(this.gameState != 'lobby')
				this.gameMessage(player.playerName + " left the game");

			if(this.gameState == 'waiting' || this.gameState == 'lobby' || this.gameState == 'editing')
				this.removePlayer(index);
			else {
				player.status = 'left';
				player.updateList();
			}
			break;
		case 'playerDied':
			var index = this.getIndex(obj.playerId);
			var player = this.players[index];
			player.finalSteer(obj);

			player.status = 'dead';
			player.updateList();
	
			if(player == this.localPlayer) {
				if(this.pencilMode == 'ondeath') {
					this.pencil.drawingAllowed = true;
					document.getElementById('inkIndicator').style.display = 'block';
				}
				else
					this.setGameState('watching');
				this.audioController.playSound('localDeath');
			}

			for(var i = 0; i < this.players.length; i++)
				if(this.players[i].status == 'alive') {
					this.players[i].points += obj.reward;
					this.players[i].updateList();
				}

			this.sortPlayerList();		
			break;
		case 'endRound':
			window.clearTimeout(this.gameloopTimeout);
			document.getElementById('inkIndicator').style.display = 'none';
			
			// simulate to finalTick
			while(this.tick <= obj.finalTick)
				this.doTick();
			while(this.tock <= obj.finalTick)
				this.doTock();
				
			var index = (obj.winnerId != -1) ? this.getIndex(obj.winnerId) : null;
			var winner = (index != null) ? (this.players[index].playerName + ' won') : 'draw!';
			this.setGameState('countdown');
			this.gameMessage('Round ended: ' + winner);
			break;			
		case 'endGame':
			this.setGameState('ended');
			window.clearTimeout(this.gameloopTimeout);
			var winner = this.getPlayer(obj.winnerId);
			this.gameMessage('Game over: ' + winner.playerName + ' won!');

			if(winner.isLocal)
				this.audioController.playSound('localWin');
			if(jsProfiling)
				console.profileEnd();
			break;
		case 'time':
			this.handleSyncResponse(obj.time);
			break;
		case 'chat':
			this.printChat(this.getPlayer(obj.playerId), obj.message);
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
			this.setHost(this.getIndex(obj.playerId));
			break;
		case 'joinFailed':
			var msg;
			switch(obj.reason) {
				case 'notFound':
					msg = 'game not found';
					break;
				case 'started':
					msg = 'game already started';
					break;
				case 'full':
					msg = 'too many players';
					break;
			}
			this.gameMessage('Could not join game: ' + msg);
			if(obj.reason == 'started')
				document.getElementById('game' + obj.id).getElementsByTagName('button')[0].disabled = true;
			break;
		default:
			this.gameMessage('Unknown mode ' + obj.mode + '!');
	}
}

GameEngine.prototype.removePlayer = function(index) {
	this.splicePlayerList(index);
	this.players[index].deleteCanvas();
				
	for(var i = index + 1; i < this.players.length; i++) {
		this.players[i].index--;
		this.players[i].color = playerColors[i - 1];
		this.setIndex(this.players[i].playerId, i - 1);
		this.players[i].updateList();
	}

	this.players.splice(index, 1);
}

GameEngine.prototype.setHost = function(id) {
	if(this.host != null) {
		this.host.isHost = false;
		if(this.gameState == 'waiting' || this.gameState == 'editing') {
			this.host.status = 'ready';
			this.host.updateList();
		}
	}
	if(id != null) {
		this.host = this.players[id];
		this.host.isHost = true;
		if(this.gameState == 'waiting' || this.gameState == 'editing') {
			this.host.status = 'host';
			this.host.updateList();
		}
	} else
		this.host = null;
	
	var localHost = this.host == this.localPlayer;
	
	var hostBlock = localHost  ? 'block' : 'none';
	var nonhostBlock = localHost ? 'none' : 'block';
	this.hostContainer.style.display = hostBlock;
	this.nonhostContainer.style.display = nonhostBlock;

	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++)
		inputElts[i].disabled = !localHost;
}

GameEngine.prototype.buildGameList = function(list) {
	var tbody = document.getElementById('gameList').lastChild;
	var row, node, button, self = this;

	while(tbody.hasChildNodes())
		tbody.removeChild(tbody.firstChild);

	document.getElementById('noGames').style.display = list.length == 0 ? 'block' : 'none';

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

GameEngine.prototype.printChat = function(player, message) {
	var escaped = escapeString(message);
	var container = document.getElementById('messages');
	var elt = document.createElement('li');
	var nameContainer = document.createElement('span');
	var displayName = player.isLocal ? 'me' : player.playerName;

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
	setLineColor(ctx, [0, 0, 0], 1);
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
	if(this.syncTry == undefined) {
		this.ping = 0;
		this.bestSyncPing = 9999;
		this.worstSyncPing = 0;
		this.syncTry = 0;
	}

	var ping = (Date.now() - this.syncSendTime) / 2;
	if(ping < this.bestSyncPing) {
		this.bestSyncPing = ping;
		this.serverTimeDifference = (serverTime + ping) - Date.now();
	}

	if(ping > this.worstSyncPing) {
		this.ping += this.worstSyncPing;
		this.worstSyncPing = ping / (syncTries - 1);
	} else
		this.ping += ping / (syncTries - 1);

	if(++this.syncTry < syncTries) {
		var self = this;
		window.setTimeout(function() {self.syncWithServer();}, this.syncTry * syncDelays);
	} else {
		this.gameMessage('Your current ping is ' + this.ping + ' msec');
		if(ultraVerbose)
			this.gameMessage('Synced with maximum error of ' + this.bestSyncPing + ' msec');
		this.syncTry = undefined;
	}
}

/* initialises the game */ 
GameEngine.prototype.setParams = function(obj) {
	this.width = obj.w;
	this.height = obj.h;
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
		this.pencil.startInk = obj.inkstart;
		this.pencil.mousedownInk = obj.inkmousedown;
	}
	
	if(this.gameState == 'editing')
		this.editor.resize();
	
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

		var url = new String(window.location);
		var hashPos = url.indexOf('?', 0);

		if(hashPos != -1)
			url = url.substr(0, hashPos);
		url += '?game=' + obj.id;

		document.getElementById('friendInviter').innerHTML = 'Invite your friends by' +
		 ' sending them this link: ' + url;
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
	var player = this.localPlayer;

	if(this.pencilMode != 'off')
		this.pencil.doTick();

	player.simulate(this.tick, player.context);
		
	this.tick++;
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
		player.simulate(this.tock, player.context);
	}
	this.tock++;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;
	var index = this.players.length;
	this.setIndex(player.playerId, index);
	this.players.push(player);
	this.appendPlayerList(index);
	
	player.canvas = document.createElement('canvas');
	player.context = player.canvas.getContext('2d');
	this.setDefaultValues(player.context);
	player.canvas.id = 'playerCanvas' + player.playerId;
	this.canvasContainer.appendChild(player.canvas);
}

GameEngine.prototype.calcScale = function(extraVerticalSpace) {
	var sidebar = document.getElementById('sidebar');
	var targetWidth = Math.max(document.body.clientWidth - sidebar.offsetWidth - 1,
	 canvasMinimumWidth);
	var targetHeight = document.body.clientHeight - 1;
	if(extraVerticalSpace != undefined)
		targetHeight -= extraVerticalSpace;

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
	var startButton = document.getElementById('startGame');
	startButton.disabled = false;
	startButton.innerHTML = 'Start Game';
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

	this.sendMsg('setParams', obj);
}

GameEngine.prototype.sendStartGame = function() {
	var obj = {};

	if(this.editor.segments.length > 0) {
		obj.segments = this.editor.segments;
	}

	this.sendMsg('startGame', obj);
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime - this.serverTimeDifference - this.ping
	 + extraGameStartTimeDifference;
	this.setGameState('countdown');
	var delay = this.gameStartTimestamp - Date.now();

	this.reset();
	
	if(jsProfiling)
		console.profile('canvas performance');

	this.audioController.playSound('countdown');

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);

		if(this.players[index].status != 'left')
			this.players[index].initialise(startPositions[i].startX,
			 startPositions[i].startY, startPositions[i].startAngle,
			 startPositions[i].holeStart);
	}

	this.resize();

	/* Scroll to right for touch devices */
	window.scroll(document.body.offsetWidth, 0);

	/* draw angle indicators */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);

		if(this.players[index].status != 'left')
			this.players[index].drawIndicator();
	}

	var self = this;
	this.gameloopTimeout = window.setTimeout(function() { self.realStart(); }, delay + this.tickLength);
	this.focusChat();
}

GameEngine.prototype.realStart = function() {
	// clearing angle indicators from base layer
	this.baseContext.clearRect(0, 0, this.width, this.height);
	this.drawMapSegments();
	this.audioController.playSound('gameStart');
	this.setGameState('playing');
	this.sendMsg('enableInput', {});
	this.tick = 0;

	var self = this;
	var gameloop = function() {
		var timeOut;
		var tellert = 0;

		do {
			if(self.gameState != 'playing' && self.gameState != 'watching')
				return;

			if(tellert++ > 100) {
		 		this.gameMessage("ERROR. stopping gameloop. debug information: next tick time = " +
		 		 ((self.tick + 1) * self.tickLength) + ", current game time = " + 
		 		 (Date.now() - self.gameStartTimestamp));
		 		return;
		 	}

			while(self.tick - self.tock >= self.tickTockDifference)
				self.doTock();
			self.doTick();
		} while((timeOut = (self.tick + 1) * self.tickLength - (Date.now() - self.gameStartTimestamp)
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
	this.calcScale();
	var scaledWidth = Math.round(this.scale * this.width);
	var scaledHeight = Math.round(this.scale * this.height)
	this.canvasContainer.style.width = scaledWidth + 'px';
	this.canvasContainer.style.height = scaledHeight + 'px';
	
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
			knownTick = player.inputsReceived > 0 ? player.inputs[player.inputsReceived - 1].tick : -1;
		else if(player.finalTick < this.tock)
			knownTick = player.finalTick;
		else {
			knownTick = this.tock - safeTickDifference;
			if(player.inputs.length > 0)
				knownTick = Math.min(knownTick, player.inputs[player.inputs.length - 1].tick);
		}
		player.simulate(knownTick, this.baseContext);
		player.saveLocation();
		player.simulate(player.isLocal ? this.tick - 1 : this.tock - 1, player.context);
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
	var nameSpan = document.createElement('span');
	var statusNode = document.createElement('td');
	var pointsNode = document.createElement('td');

	row.id = 'player' + player.playerId;
	nameSpan.innerHTML = player.playerName;
	nameSpan.className = 'noverflow';

	this.playerList.appendChild(row);
	nameNode.appendChild(nameSpan);
	row.appendChild(nameNode);
	row.appendChild(statusNode);
	row.appendChild(pointsNode);
	player.updateList();
	resizeChat();
}

GameEngine.prototype.updatePlayerList = function(player) {
	var row = document.getElementById('player' + player.playerId);

	if(player.status == 'left')
		row.className = 'left';
		
	if(this.gameType != 'lobby')
		row.childNodes[0].style.color = 'rgb(' + player.color[0] + ', ' + player.color[1] + ', '
		 + player.color[2] + ')';

	row.childNodes[1].innerHTML = player.status;
	row.childNodes[2].innerHTML = player.points;
}

GameEngine.prototype.splicePlayerList = function(index) {
	var row = document.getElementById('player' + this.players[index].playerId);
	this.playerList.removeChild(row);
	resizeChat();
}

GameEngine.prototype.clearPlayerList = function() {
	while(this.playerList.hasChildNodes())
		this.playerList.removeChild(this.playerList.firstChild);
	resizeChat();
}

/* sorts the player list by points in decreasing order */
GameEngine.prototype.sortPlayerList = function() {
	var rows = this.playerList.getElementsByTagName('tr'); // this is nodelist, we want array
	var arr = [];

	for (var i = 0, ref = arr.length = rows.length; i < ref; i++)
		arr[i] = rows[i];

	arr.sort(function(row1, row2) {
		var score1 = parseInt(row1.lastChild.innerHTML);
		var score2 = parseInt(row2.lastChild.innerHTML);
		return score1 == score2 ? 0 : (score1 > score2 ? -1 : 1);
	});

	for(var i = 0; i < arr.length; i++) {
		this.playerList.removeChild(arr[i]);
		this.playerList.appendChild(arr[i]);
	}
}

GameEngine.prototype.sendChat = function() {
	var msg = this.chatBar.value;

	if(this.gameState == 'new' || msg.length < 1)
		return;

	this.sendMsg('chat', {'message': msg});
	this.chatBar.value = '';
	this.printChat(this.localPlayer, msg);
}

GameEngine.prototype.focusChat = function() {
	if(!touchDevice)
		this.chatBar.focus();
}

GameEngine.prototype.backToGameLobby = function() {
	this.setGameState('waiting');
	
	// remove players who left game & set status for other players
	var copy = this.players.slice(0);
	for(var i = 0; i < copy.length; i++) {
		if(copy[i].status == 'left')
			this.removePlayer(copy[i].index);
		else {
			copy[i].status = copy[i].isHost ? 'host' : 'ready';
			copy[i].points = 0;
			copy[i].updateList();
		}
	}
}

/* players */
function Player(color, local, index) {
	this.isLocal = local;
	this.isHost = false;
	this.color = color;
	this.status = 'ready'; // ready, alive, dead or left
	this.index = index;
	this.points = 0;
}

Player.prototype.deleteCanvas = function() {
	this.context.canvas.parentNode.removeChild(this.context.canvas);
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
	var endTick = Math.min(obj.tick, localTick - safeTickDifference);
	this.simulate(endTick, this.game.baseContext);
	this.saveLocation();

	this.context.clearRect(0, 0, this.game.width, this.game.height);
	if(!this.isLocal) {
		this.game.redraws++;
		this.game.displayDebugStatus();
	}
	this.simulate(localTick - 1, this.context);
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
	this.simulate(tick, this.game.baseContext);
	this.context.clearRect(0, 0, this.game.width, this.game.height);
}

Player.prototype.simulate = function(endTick, ctx) {
	if(this.tick > endTick || this.tick > this.finalTick)
		return;
	var input = null, sin = Math.sin(this.angle),
	 cos = Math.cos(this.angle), step = this.game.tickLength/ 1000;
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
	
	for(; this.tick <= endTick; this.tick++) {
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
				this.simulateDead();
				this.tick++;
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
	// draw cross
	var ctx = this.game.foregroundContext;
	setLineColor(ctx, crossColor, 1);
	ctx.lineWidth = crossLineWidth;
	ctx.beginPath();
	ctx.moveTo(this.x - crossSize / 2, this.y - crossSize / 2);
	ctx.lineTo(this.x + crossSize / 2, this.y + crossSize / 2);
	ctx.moveTo(this.x + crossSize / 2, this.y - crossSize / 2);
	ctx.lineTo(this.x - crossSize / 2, this.y + crossSize / 2);
	ctx.stroke();
	ctx.lineWidth = lineWidth;
}

Player.prototype.updateList = function() {
	this.game.updatePlayerList(this);
}

Player.prototype.initialise = function(x, y, angle, holeStart) {
	this.startVelocity = this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.holeStart = holeStart;
	this.holeSize = this.game.holeSize;
	this.holeFreq = this.game.holeFreq;
	this.status = 'alive';
	this.startX = this.x = x;
	this.startY = this.y = y;
	this.nextInput = 0;
	this.startAngle = this.angle = angle;
	this.turn = 0;
	this.inputs = [];
	this.tick = 0;
	this.nextInput = 0;
	this.inputsReceived = 0;
	this.lastSteerTick = -1;
	this.finalTick = Infinity;
	this.updateList();
	this.context.clearRect(0, 0, this.game.width, this.game.height);	
	this.saveLocation();

	if(this.inputController != undefined)
		this.inputController.reset();
}

Player.prototype.drawIndicator = function() {
	var ctx = this.game.baseContext, x = this.x, y = this.y, angle = this.angle;

	setLineColor(ctx, this.color, 1);
	ctx.beginPath();
	ctx.moveTo(this.x, this.y);
	ctx.lineTo(x += Math.cos(angle) * indicatorLength, y += Math.sin(angle) * indicatorLength);
	ctx.stroke();

	ctx.fillStyle = 'rgb('+this.color[0]+','+this.color[1]+','+this.color[2]+')';
	ctx.beginPath();
	var a = indicatorArrowOffset;
	var b = indicatorArrowLength;
	var c = ctx.lineWidth;
	var d = Math.PI/ 4;
	
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

/* this is object for storing touch info */
function touchEvent(x, y, identifier) {
	this.startX = x;
	this.startY = y;
	this.identifier = identifier;
}

/* input control for steering and drawing. now UNIFIED for both mouse/ keyboard
 * n touch */
function InputController(player, left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = player;

	var self = this;
	var game = player.game;
	var pencil = player.game.pencil;
	var canvas = player.game.canvasContainer;

	this.reset();

	/* listen for keyboard events */
	window.addEventListener('keydown', function(e) {
		if(self.player.status != 'alive' || game.gameState != 'playing')
			return;

		if(e.keyCode == self.leftKeyCode) {
			self.pressLeft();
			e.preventDefault();
		}
		else if(e.keyCode == self.rightKeyCode) {
			self.pressRight();
			e.preventDefault();
		}
	}, false);

	window.addEventListener('keyup', function(e) {
		if(self.player.status != 'alive' || game.gameState != 'playing')
			return;

		if(e.keyCode == self.leftKeyCode) {
			self.releaseLeft();
			e.preventDefault();
		}
		else if(e.keyCode == self.rightKeyCode) {
			self.releaseRight();
			e.preventDefault();
		}
	}, false);

	function convertMouseToTouch(e) {
		e.identifier = 1;
		return {changedTouches: [e]};
	}

	function mouseMove(e) {
		if(pencil.drawingAllowed && pencil.down) {
			var pos = pencil.getRelativePos(e);
			pencil.curX = pos[0];
			pencil.curY = pos[1];
		}
	}

	function mouseDown(e) {
		if(pencil.drawingAllowed && !pencil.down && pencil.ink > pencil.mousedownInk)
			pencil.startDraw(pencil.getRelativePos(e));
	}

	function mouseEnd(e) {
		if(emulateTouch)
			touchEnd(convertMouseToTouch(e));
		else
			stopDraw(e);
	}
	
	function stopDraw(e) {
		if(pencil.drawingAllowed && pencil.down) {
			var pos = pencil.getRelativePos(e);
			pencil.curX = pos[0];
			pencil.curY = pos[1];

			pencil.down = false;
			pencil.upped = true;

			pencil.game.focusChat();
		}
	};

	function touchStart(e) {
		if(game.gameState != 'playing') {
			if(game.gameState == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = pencil.getRelativePos(touch);
			var totalWidth = game.width;
			var right = (pos[0] <= totalWidth * steerBoxSize);  // TODO: dit is precies andersom als hoe t zou moeten -- hoe kan dit?
			var left = (pos[0] >= (1 - steerBoxSize) * totalWidth);

			if(self.player.status == 'alive' && left && self.leftTouch === null) {
				self.leftTouch = new touchEvent(pos[0], pos[1], touch.identifier);
				self.pressLeft();
			}

			else if(self.player.status == 'alive' && right && self.rightTouch === null) {
				self.rightTouch = new touchEvent(pos[0], pos[1], touch.identifier);
				self.pressRight();
			}

			else if(self.pencilTouch == null && !pencil.down &&
			 pencil.ink > pencil.mousedownInk && pencil.drawingAllowed) {
				self.pencilTouch = new touchEvent(pos[0], pos[1], touch.identifier);
				pencil.startDraw(pos);
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	function touchEnd(e) {
		if(game.gameState != 'playing') {
			if(game.gameState == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];

			if(self.player.status == 'alive' && self.leftTouch != null &&
			 touch.identifier == self.leftTouch.identifier) {
				self.releaseLeft();
				self.leftTouch = null;
			}

			else if(self.player.status == 'alive' && self.rightTouch != null &&
			 touch.identifier == self.rightTouch.identifier) {
				self.releaseRight();
				self.rightTouch = null;
			}

			else if(self.pencilTouch != null &&
			 touch.identifier == self.pencilTouch.identifier) {
				stopDraw(touch);
				self.pencilTouch = null;
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	function touchMove(e) {
		if(game.gameState != 'playing') {
			if(game.gameState == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = pencil.getRelativePos(touch);
			var totalWidth = game.width;
			var right = (pos[0] <= totalWidth * steerBoxSize);
			var left = (pos[0] >= (1 - steerBoxSize) * totalWidth);

			if(self.leftTouch != null && touch.identifier == self.leftTouch.identifier) {
				var convert = (getLength(pos[0] - self.leftTouch.startX, pos[1] - self.leftTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && !pencil.down && pencil.ink > pencil.mousedownInk);

				/* convert this touch to pencil touch */
				if(convert) {
					self.pencilTouch = new touchEvent(pos[0], pos[1], touch.identifier);
					pencil.startDraw([self.leftTouch.startX, self.leftTouch.startY]);
				}

				if(convert || !left) {
					self.releaseLeft();
					self.leftTouch = null;
				}
			}

			else if(self.rightTouch != null && touch.identifier == self.rightTouch.identifier) {
				var convert = (getLength(pos[0] - self.rightTouch.startX, pos[1] - self.rightTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && !pencil.down && pencil.ink > pencil.mousedownInk);

				if(convert) {
					self.pencilTouch = new touchEvent(pos[0], pos[1], touch.identifier);
					pencil.startDraw([self.rightTouch.startX, self.rightTouch.startY]);
				}

				if(convert || !right) {
					self.releaseRight();
					self.rightTouch = null;
				}
			}

			else if(self.pencilTouch != null && touch.identifier == self.pencilTouch.identifier)
				if(pencil.drawingAllowed && pencil.down) {
					var pos = pencil.getRelativePos(touch);
					pencil.curX = pos[0];
					pencil.curY = pos[1];
				}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		canvas.addEventListener('touchstart', touchStart, true);
		canvas.addEventListener('touchend', touchEnd, true);
		canvas.addEventListener('touchcancel', touchEnd, true);
		canvas.addEventListener('touchmove', touchMove, true);
	}

	/* catch mouse events (not editor!) */
	canvas.addEventListener('mousedown', function(e) {
		if(emulateTouch)
			touchStart(convertMouseToTouch(e));
		else
			mouseDown(e);
	}, false);

	canvas.addEventListener('mousemove', function(e) {
		if(emulateTouch)
			touchMove(convertMouseToTouch(e));
		else
			mouseMove(e);
	}, false);

	canvas.addEventListener('mouseup', mouseEnd, false);
	canvas.addEventListener('mouseout', mouseEnd, false);
}

InputController.prototype.reset = function() {
	this.leftDown = false;
	this.rightDown = false;
	this.leftTouch = null;
	this.rightTouch = null;
	this.pencilTouch = null;
}

InputController.prototype.pressLeft = function() {
	if(!this.leftDown)
		this.steerLocal(1);

	this.leftDown = true;
}

InputController.prototype.releaseLeft = function() {
	this.steerLocal(this.rightDown ? -1 : 0);
	this.leftDown = false;
}

InputController.prototype.pressRight = function() {
	if(!this.rightDown)
		this.steerLocal(-1);

	this.rightDown = true;
}

InputController.prototype.releaseRight = function() {
	this.steerLocal(this.leftDown ? 1 : 0);
	this.rightDown = false;
}

InputController.prototype.steerLocal = function(turn) {
	var game = this.player.game;
	var obj = {'turn': turn, 'tick': game.tick};

	if(this.player.lastSteerTick == obj.tick)
		obj.tick = ++this.player.lastSteerTick;
	else
		this.player.lastSteerTick = obj.tick;
	
	this.player.inputs.push(obj);

	game.sendMsg('input', obj);
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
	this.indicator = document.getElementById('ink');
}

/* pos is scaled location */
Pencil.prototype.startDraw = function(pos) {
	this.ink -= this.mousedownInk;
	this.curX = this.x = pos[0];
	this.curY = this.y = pos[1];
	this.outbuffer.push(1);
	this.outbuffer.push(this.x);
	this.outbuffer.push(this.y);
	this.outbuffer.push(this.game.tick);
	this.down = true;
}

Pencil.prototype.reset = function() {
	this.drawingAllowed = (this.game.pencilMode == 'on');
	document.getElementById('inkIndicator').style.display = this.drawingAllowed ? 'block' : 'none';
	this.outbuffer = [];
	this.down = false;
	this.upped = false;
	this.inbuffer = [];
	this.inbufferIndex = [];
	this.setInk(this.startInk);
	this.players = this.game.players.length;

	for(var i = 0; i < this.players; i++) {
		this.inbuffer[i] = [];
		this.inbufferIndex[i] = 0;
	}

	this.inbuffer.length = this.inbufferIndex.length = this.players;
	var pos = findPos(this.game.canvasContainer);
	this.canvasLeft = pos[0];
	this.canvasTop = pos[1];
}

Pencil.prototype.setInk = function(ink) {
	this.ink = Math.min(this.maxInk, ink);
	this.indicator.style.height = ( 100 * this.ink/ this.maxInk ) + '%'; // kan ook width zijn
}

Pencil.prototype.doTick = function() {
	this.setInk(this.ink + this.inkPerSec / 1000 * this.game.tickLength);

	if(this.drawingAllowed && (this.down || this.upped)) {
		var x = this.curX;
		var y = this.curY;
		var d = getLength(x - this.x, y - this.y);

		if(this.upped || d >= this.inkMinimumDistance) {
			if(this.ink < d) {
				// shorten move
				var a = x - this.x;
				var b = y - this.y;
				a *= this.ink / d;
				b *= this.ink / d;
				x = this.x + a;
				y = this.y + b;
				d = this.ink;
				
				this.down = false;
				this.upped = true;

				this.game.focusChat();
			}
			this.setInk(this.ink - d);
			this.outbuffer.push(this.upped ? -1 : 0);
			this.outbuffer.push(x);
			this.outbuffer.push(y);
			this.outbuffer.push(this.game.tick);
			this.drawSegment(this.x, this.y, x, y, 0, pencilAlpha);
			this.x = x;
			this.y = y;
			this.upped = false;
		}
	}

	if(this.game.tick % inkBufferTicks == 0 && this.outbuffer.length > 0) {
		this.game.sendMsg('pencil', {'data' : this.outbuffer});
		this.outbuffer = [];
	}

	this.drawPlayerSegs(false);
}

Pencil.prototype.drawPlayerSegs = function(redraw) {
	for(var i = 0; i < this.players; i++) {
		var buffer = this.inbuffer[i];
		var index = redraw ? 0 : this.inbufferIndex[i];
		
		while(index < buffer.length) {
			var seg = buffer[index];
			var solid = seg.tickSolid <= this.game.tick;
			if(!solid && !redraw)
				break;
			this.drawSegment(seg.x1, seg.y1, seg.x2, seg.y2, i, solid ? 1 : pencilAlpha);
			index++;
		}
		
		if(!redraw)
			this.inbufferIndex[i] = index;
	}
}

Pencil.prototype.drawSegment = function(x1, y1, x2, y2, playerIndex, alpha) {
	if(x1 == x2 && y1 == y2)
		return;
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
		var index = this.game.getIndex(a.playerId);
		this.drawSegment(a.x1, a.y1, a.x2, a.y2, index, pencilAlpha);
		this.inbuffer[index].push(a);
	}
}

Pencil.prototype.relativatePos = function(pos) {
	vec = pos.slice(0); // make copy since pos is passed by reference!

	vec[0] -= this.canvasLeft;
	vec[1] -= this.canvasTop;
	vec[0] /= this.game.scale;
	vec[1] /= this.game.scale;
	vec[0] = Math.round(Math.max(Math.min(this.game.width, vec[0]), 0));
	vec[1] = Math.round(Math.max(Math.min(this.game.height, vec[1]), 0));
	return vec;
}

Pencil.prototype.getRelativePos = function(e) {
	return this.relativatePos(getPos(e));
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
	this.canvas.width = this.canvas.height = 0;
	var self = this;
	
	this.canvas.addEventListener('mousedown', function(ev) { self.onmouse('down', ev); }, false);
	this.canvas.addEventListener('mousemove', function(ev) { self.onmouse('move', ev); }, false);
	document.body.addEventListener('mouseup', function(ev) { self.onmouse('up', ev); }, false);
	this.canvas.addEventListener('mouseout', function(ev) { self.onmouse('out', ev); }, false);
	this.canvas.addEventListener('mouseover', function(ev) { self.onmouse('over', ev); }, false);

	this.resetButton = document.getElementById('editorReset');
	this.resetButton.addEventListener('click', function() { 
		self.segments = [];
		self.resize();	
	}, false);

	var copy = document.getElementById('editorCopy');
	copy.addEventListener('click', function() { self.copy(); }, false);

	var load = document.getElementById('editorLoad');
	load.addEventListener('click', function() { self.load(); }, false);

	var start = document.getElementById('editorStart');
	start.addEventListener('click', function() {
		self.game.setGameState('editing');
		self.pos = findPos(self.canvas);
		self.resize();
		self.interval = window.setInterval(function() { self.onmouse('move'); }, editorStepTime);
		window.scroll(document.body.offsetWidth, 0);
	}, false);

	var stop = document.getElementById('editorStop');
	stop.addEventListener('click', function() { 
		self.game.setGameState('waiting'); 
		window.clearInterval(self.interval);
		// freeing memory - is this the right way?
		self.canvas.height = self.canvas.width = 0;
	}, false);
	
	function touchStart(e) {
		for(var i = 0; i < e.changedTouches.length; i++) {
			var t = e.changedTouches[i];
			t.time = Date.now();
			t.pos = self.getPos(t);
		}
		if(e.cancelable)
			e.preventDefault();
	}
	
	function touchMove(e) {
		for(var i = 0; i < e.changedTouches.length; i++) {
			var t = e.changedTouches[i];
			if(Date.now() - t.time > editorStepTime) {
				var pos = self.getPos(t);
				var seg = new BasicSegment(t.pos[0], t.pos[1], pos[0], pos[1]);
				self.segments.push(seg);
				self.drawSegment(seg);
				t.pos = pos;
				t.time = Date.now();
			}
		}
		if(e.cancelable)
			e.preventDefault();
	}
	
	function touchEnd(e) {
		for(var i = 0; i < e.changedTouches.length; i++) {
			var t = e.changedTouches[i];
			var pos = self.getPos(t);
			var seg = new BasicSegment(t.pos[0], t.pos[1], pos[0], pos[1]);
			self.segments.push(seg);
			self.drawSegment(seg);
		}
		if(e.cancelable)
			e.preventDefault();
	}
	
	this.canvas.addEventListener('touchstart', touchStart, false);
	this.canvas.addEventListener('touchmove', touchMove, false);
	this.canvas.addEventListener('touchend', touchEnd, false);
	this.canvas.addEventListener('touchcancel', touchEnd, false);
}

Editor.prototype.onmouse = function(type, ev) {
	var pos;
	
	if(ev == undefined)
		pos = this.curPos;
	else	
		pos = this.curPos = this.getPos(ev);

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

Editor.prototype.getPos = function(ev) {
	var pos = getPos(ev);
	pos[0] -= this.pos[0];
	pos[1] -= this.pos[1];
	pos[0] /= this.game.scale;
	pos[1] /= this.game.scale;
	pos[0] = Math.round(pos[0]);
	pos[1] = Math.round(pos[1]);
	return pos;
}

Editor.prototype.drawSegment = function(seg) {
	if(seg.x1 == seg.x2 && seg.y1 == seg.y2)
		return;
	this.context.beginPath();
	this.context.moveTo(seg.x1, seg.y1);
	this.context.lineTo(seg.x2, seg.y2);
	this.context.stroke();
}

Editor.prototype.copy = function() {
	this.textField.value = JSON.stringify(this.segments);
}

Editor.prototype.load = function() {
	try {
		var segs = JSON.parse(this.textField.value);
	}
	catch(ex) {
		this.game.gameMessage('JSON parse exception!');
	}

	for(var i = 0; i < segs.length; i++)
		this.drawSegment(segs[i]);

	this.segments = this.segments.concat(segs);
}

Editor.prototype.resize = function() {
	var game = this.game;
	game.calcScale(this.resetButton.offsetHeight + 6);
	var w = Math.round(game.scale * game.width);
	var h = Math.round(game.scale * game.height);
	this.canvas.width = w;
	this.canvas.height = h;
	this.context.scale(game.scale, game.scale);
	this.context.lineWidth = 3;
	setLineColor(this.context, mapSegmentColor, 1);
	this.context.lineCap = 'round';
	
	for(var i = 0; i < this.segments.length; i++)
		this.drawSegment(this.segments[i]);
		
	// stop drawing
	this.down = false;
	this.out = false;
}

BasicSegment = function(x1, y1, x2, y2) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
}

/* create game */
window.onload = function() {
	var audioController = new AudioController();
	var localPlayer = new Player(playerColors[0], true, 0);
	var game = new GameEngine(localPlayer, audioController);
	localPlayer.game = game;
	localPlayer.inputController = new InputController(localPlayer, keyCodeLeft, keyCodeRight);

	/* add sounds to controller */
	audioController.addSound('localDeath', 'sounds/wilhelm', ['ogg']);
	audioController.addSound('countdown', 'sounds/countdown', ['wav']);
	audioController.addSound('newPlayer', 'sounds/playerjoint', ['wav']);
	audioController.addSound('gameStart', 'sounds/whip', ['wav']);
	audioController.addSound('localWin', 'sounds/winning', ['mp3']);

	/* add listener for chat submit */
	document.getElementById('chatForm').addEventListener('submit', function(e) {
		game.sendChat();
		e.preventDefault();
	}, false);

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

		if(typeof playerName != "string" || playerName.length < 1 || playerName.length > game.maxNameLen) {
			game.gameMessage('Enter a cool nickname please (no longer than ' + game.maxNameLen + ' chars)');
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
		game.websocket.close(1000);
	}, false);
	
	var backButton = document.getElementById('back');
	backButton.addEventListener('click', function() {
		game.backToGameLobby();
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

	// temporary ! cookies do not work without website
	if(window.location.href.indexOf('C:/Dropbox') != -1) {
		playerName = 'rik';
		document.getElementById('minplayers').value = '1';
		enableSound = false;
	}
	
	/* auto join lobby if name is known */
	if(playerName != null && playerName != "") {
		document.getElementById('playername').value = playerName;
		joinLobby();
	}
	
	window.onresize = function() {
		this.clearTimeout(this.resizeTimeout);
		this.resizeTimeout = this.setTimeout(function() { 
			if(game.gameState == 'editing')
				game.editor.resize();
			else if (game.gameState == 'playing' || game.gameState == 'watching' || 
			 game.gameState == 'ended')
				game.resize();
		}, resizeDelay);

		resizeChat();
	}

	/* moving sidebar for horizontal scroll */
	window.onscroll = function() {
		document.getElementById('sidebar').style.left = -window.scrollX + 'px';
	}

	function sendParams(timeout, onlyAllowReplacement) {
		return function() {
			if(game.host != game.localPlayer || game.gameState != 'waiting')
				return;
			
			/* onlyAllowReplacement allows us not to send the params when it is not
			 * needed. ie, when we already sent the params after an onInput event.
			 * onChange would then still fire, which is annoying if you just pressed
			 * start game */
			if(onlyAllowReplacement && game.paramTimeout == undefined)
				return;
				
			window.clearTimeout(game.paramTimeout);
		
			game.paramTimeout = window.setTimeout(function() {
				game.sendParams();
				game.paramTimeout = undefined;
			}, timeout);

			var startButton = document.getElementById('startGame');
			startButton.disabled = true;
			startButton.innerHTML = 'Please wait';

			if(game.unlockTimeout !== null)
				window.clearTimeout(game.unlockTimeout);

			game.unlockTimeout = window.setTimeout(function() {
				game.unlockStart();
			}, unlockInterval + timeout);
		}
	}
	
	echo = function(msg) { game.gameMessage(msg); }; // for debug purposes (please do not remove)

	/* add event handlers to schedule paramupdate message when game options are changed */
	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++) {
		if(inputElts[i].type == 'text' || inputElts[i].type == 'number') {
			inputElts[i].addEventListener('input', sendParams(paramInputInterval, false), false);
			inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, true), false);
		} else 
			inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, false), false);
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

function setOptionVisibility(target) {
	var sections = ['disconnect', 'stop', 'back'];

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

function resizeChat() {
	var chat = document.getElementById('chatContainer');
	var options = document.getElementById('options');
	var playerList = document.getElementById('playerListContainer');
	var chatForm = document.getElementById('chatForm');
	var gameTitle = document.getElementById('gameTitle');
	var margins = 30;

	var maxHeight = document.body.clientHeight - options.offsetHeight
	 - chatForm.offsetHeight - playerList.offsetHeight - gameTitle.offsetHeight - margins;

	chat.style.maxHeight = maxHeight + 'px';
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

function escapeString(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getPos(e) {
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

	return [posx, posy];
}
