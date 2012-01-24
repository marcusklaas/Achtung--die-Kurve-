/* game engine */
function GameEngine(localPlayer, audioController) {
	// game variables
	this.players = [];
	this.dict = []; // maps playerId.toString() to index of this.players
	this.gameStartTimestamp = null;
	this.tick = 0;
	this.tock = 0; // seperate tick for the other clients
	this.behind = behind;
	this.gameState = 'new'; // new, lobby, editing, waiting, countdown, playing, watching, ended
	this.gameType = null;
	this.tickLength = null;

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
	this.resizeNeeded = false;
	this.scale = null; // canvas size/ game size
	this.canvasContainer = document.getElementById('canvasContainer');
	this.baseCanvas = document.getElementById('baseCanvas');
	this.baseContext = this.baseCanvas.getContext('2d');
	this.setDefaultValues(this.baseContext);
	this.foregroundCanvas = document.getElementById('foregroundCanvas');
	this.foregroundContext = this.foregroundCanvas.getContext('2d');
	this.setDefaultValues(this.foregroundContext);

	// children
	this.localPlayerId = null;
	this.localPlayer = localPlayer;
	this.pencil = new Pencil(this);
	this.audioController = audioController;
	this.playerList = document.getElementById('playerList').lastChild;
	this.chatBar = document.getElementById('chat');
	this.editor = new Editor(this);

	// game param timers
	this.paramTimeout = null;
	this.unlockTimeout = null;
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
			this.localPlayerId = obj.playerId;
			this.tickLength = obj.tickLength;
			this.pencil.inkMinimumDistance = obj.inkMinimumDistance;
			this.setIndex(obj.playerId, 0);
			break;
		case 'joinedGame':
			this.localPlayer.status = 'ready';
			this.localPlayer.isHost = false;
			this.gameType = obj.type;
			this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
			this.mapSegments = undefined;
			this.resetPlayers();
			this.addPlayer(this.localPlayer);

			if(obj.type == 'lobby') {
				this.updateTitle('Lobby');
				if(window.location.hash.indexOf('#game=', 0) == 0) {
					this.joinGame(parseInt(window.location.hash.substr(6)));
					window.location.hash = '';
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
			var nextRoundDelay = obj.startTime + this.serverTimeDifference - this.ping
			 + extraGameStartTimeDifference - Date.now();
			 
			setOptionVisibility('stop'); // in the case that it is 'back'

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
			obj.playerLeft = true;
			player.finalSteer(obj);
			if(this.gameState != 'lobby')
				this.gameMessage(player.playerName + " left the game");

			if(this.gameState == 'waiting' || this.gameState == 'lobby')
				this.removePlayer(index);
			else{
				player.status = 'left';
				player.updateList();
			}
			break;
		case 'playerDied':
			var index = this.getIndex(obj.playerId);
			var player = this.players[index];
			player.points = obj.points;
			player.finalSteer(obj);

			if(index == 0 && this.pencilMode == 'ondeath') {
				this.pencil.drawingAllowed = true;
				document.getElementById('inkIndicator').style.display = 'block';
			}
			break;
		case 'endRound':
			window.clearTimeout(this.gameloopTimeout);
			document.getElementById('inkIndicator').style.display = 'none'; // of liever niet?
			
			// simulate to finalTick
			while(this.tick <= obj.finalTick)
				this.doTick();
			while(this.tock <= obj.finalTick)
				this.doTock();
			
			var index = (obj.winnerId != -1) ? this.getIndex(obj.winnerId) : null;
			var winner = (index != null) ? (this.players[index].playerName + ' won') : 'draw!';
			this.setGameState('countdown');
			if(index != null) {
				var player = this.players[index];
				player.points = obj.points;
				player.updateList();
			}
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
		document.getElementById('player' + i).id = 'player' + (i - 1);
		this.players[i].index--;
		this.players[i].color = playerColors[i - 1];
		this.setIndex(this.players[i].playerId, i - 1);
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

GameEngine.prototype.printChat = function(playerId, message) {
	var escaped = escapeString(message);
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
			this.gameMessage('Synced with maximum error of ' + this.bestSyncPing + ' msec');
		this.syncTries = 0;
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
		var hashPos = url.indexOf('#', 0);

		if(hashPos != -1)
			url = url.substr(0, hashPos);
		url += '#game=' + obj.id;

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

	if(player.status == 'alive')
		player.simulate(this.tick, player.context);
		
	this.tick++;
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
		if(player.status != 'alive')
			continue;
			
		player.simulate(this.tock, player.context);
	}
	this.tock++;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;
	var index = this.players.length;
	player.canvas = document.createElement('canvas');
	player.context = player.canvas.getContext('2d');

	if(player.playerId != null)
		this.setIndex(player.playerId, index);
	else
		player.playerId = this.localPlayerId;

	player.canvas.id = 'playerCanvas' + player.playerId;
	this.canvasContainer.appendChild(player.canvas);

	this.players.push(player);
	this.appendPlayerList(index);
	this.setDefaultValues(player.context);
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

	this.reset();
	
	if(jsProfiling)
		console.profile('canvas performance');

	this.audioController.playSound('countdown');

	/* Scroll to right for touch devices */
	window.scroll(document.body.offsetWidth, 0);

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.getIndex(startPositions[i].playerId);

		if(this.players[index].status != 'left')
			this.players[index].initialise(startPositions[i].startX,
			 startPositions[i].startY, startPositions[i].startAngle,
			 startPositions[i].holeStart);
	}

	this.resize();

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

			while(self.tick - self.tock >= self.behind)
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
	player.updateList();
}

GameEngine.prototype.updatePlayerList = function(player) {
	var row = document.getElementById('player' + player.index);

	if(player.status == 'left')
		row.className = 'left';

	row.childNodes[1].innerHTML = player.status;
	row.childNodes[2].innerHTML = player.points;
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
	this.turn = 0; // -1 is turn right, 0 is straight, 1 is turn left
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.status = 'ready'; // ready, alive, dead or left
	this.inputs = [];
	this.nextInput = 0;
	this.inputsReceived = 0; // only for local player
	this.holeStart = 0;
	this.holeSize = 0;
	this.holeFreq = 0;
	this.tick = 0;
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
	
	var input = {'tick': tick, 'finalTurn': true};
	if(obj.playerLeft)
		input.playerLeft = true;
	else {
		input.x = obj.x;
		input.y = obj.y;
	}
	this.inputs[i + 1] = input;
	
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
				if(!input.playerLeft) {
					this.x = input.x;
					this.y = input.y;
					ctx.lineTo(this.x, this.y);
					ctx.stroke();
					this.simulateDead();
				} else
					ctx.stroke();
				this.tick++; // so that this.tick > this.finalTick
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
	if(this.status == 'alive') {
		this.status = 'dead';
		this.updateList();
		
		if(this.index == 0) {
			this.game.setGameState('watching');
			this.game.audioController.playSound('localDeath');
		}
	}
	
	// draw cross
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

/* input control for steering and drawing. now UNIFIED for both mouse/ keyboard
 * n touch */
function InputController(player, left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = player;
	this.leftDown = false;
	this.rightDown = false;

	var self = this;
	var pencil = player.game.pencil;
	var canvas = player.game.canvasContainer;

	/* listen for keyboard events */
	window.addEventListener('keydown', function(e) {
		if(self.player.status != 'alive' || player.game.tick == -1)
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
		if(self.player.status != 'alive' || player.game.tick == -1) {
			self.leftDown = self.rightDown = false;
			return;
		}

		if(e.keyCode == self.leftKeyCode) {
			self.releaseLeft();
			e.preventDefault();
		}
		else if(e.keyCode == self.rightKeyCode) {
			self.releaseRight();
			e.preventDefault();
		}
	}, false);

	/* listen for mouse events on canvas (not editor) */
	canvas.addEventListener('mousedown', function(ev) {
		if(pencil.drawingAllowed && !pencil.down && pencil.ink > pencil.mousedownInk) {
			pencil.ink -= pencil.mousedownInk;
			var pos = pencil.getRelativeMousePos(ev);
			pencil.x = pos[0];
			pencil.y = pos[1];
			pencil.buffer.push(1);
			pencil.buffer.push(pencil.x);
			pencil.buffer.push(pencil.y);
			pencil.buffer.push(pencil.game.tick);
			pencil.down = true;
			pencil.cur = ev; // since we handle movements in gameloop and not in mousemove
		}
	}, false);

	canvas.addEventListener('mousemove', function(ev) {
		if(pencil.drawingAllowed && pencil.down)
			pencil.cur = ev;
	}, false);
	
	var f = function(ev) {
		if(pencil.drawingAllowed && pencil.down) {
			pencil.cur = ev;
			pencil.down = false;
			pencil.upped = true;
			pencil.game.focusChat();
		}
	};
	canvas.addEventListener('mouseup', f, false);
	canvas.addEventListener('mouseout', f, false);

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		var sidebar = document.getElementById('sidebar');
		
		function touch(event, start) {
			var touch = event.changedTouches[0];
			var x = touch.pageX - sidebar.offsetWidth;
			var width = canvas.clientWidth;
			
			if(x < 0 || player.status != 'alive' || player.game.tick == -1)
				return;
			
			var left = (x < width / 3);
			if(x < width * 2 / 3 && !left)
				return;
				
			if(start && left)
				self.pressLeft();
			else if(start && !left)
				self.pressRight();
			else if(!start && left)
				self.releaseLeft();
			else
				self.releaseRight();

			event.preventDefault();
		}

		canvas.addEventListener('touchstart', function(e) { touch(e, true); });
		canvas.addEventListener('touchend', function(e) { touch(e, false); });
	}	
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
	this.maxInk = 0;
	this.inkPerSec = 0;
	this.startInk = 0;
	this.mousedownInk = 0;
	this.inkMinimumDistance = 0;
	this.game = game;
	this.indicator = document.getElementById('ink');
}

Pencil.prototype.reset = function() {
	this.drawingAllowed = (this.game.pencilMode == 'on');
	document.getElementById('inkIndicator').style.display = this.drawingAllowed ? 'block' : 'none';
	this.buffer = [];
	this.down = false;
	this.upped = false;
	this.inbuffer = [];
	this.inbufferSolid = [];
	this.inbufferSolidIndex = [];
	this.setInk(this.startInk);
	this.players = this.game.players.length;

	for(var i = 0; i < this.players; i++) {
		this.inbuffer[i] = [];
		this.inbufferSolid[i] = [];
		this.inbufferSolidIndex[i] = 0;
	}

	this.inbufferSolid.length = this.inbuffer.length = this.players;
	this.inbufferSolidIndex.length = this.players;
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
		pos = this.getRelativeMousePos(this.cur);
		var x = pos[0];
		var y = pos[1];
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
			this.buffer.push(this.upped ? -1 : 0);
			this.buffer.push(x);
			this.buffer.push(y);
			this.buffer.push(this.game.tick);
			this.drawSegment(this.x, this.y, x, y, 0, pencilAlpha);
			this.x = x;
			this.y = y;
			this.upped = false;
		}
	}

	if(this.game.tick % inkBufferTicks == 0 && this.buffer.length > 0) {
		this.game.sendMsg('pencil', {'data' : this.buffer});
		this.buffer = [];
	}

	this.drawPlayerSegs(false);
}

Pencil.prototype.drawPlayerSegs = function(redraw) {
	for(var i = 0; i < this.players; i++) {
		var index, seg, buffer = this.inbuffer[i];

		if(redraw) {
			for(index = 0; index < buffer.length; index++) {
				seg = buffer[index];
				this.drawSegment(seg.x1, seg.y1, seg.x2, seg.y2, i, pencilAlpha);
			}
		}

		buffer =  this.inbufferSolid[i];
		index = (redraw) ? 0 : this.inbufferSolidIndex[i];
		
		while(index < buffer.length && buffer[index].tickSolid <= this.game.tick) {
			var seg = buffer[index++];
			this.drawSegment(seg.x1, seg.y1, seg.x2, seg.y2, i, 1);
			
			if(!redraw)
				this.inbuffer[i].shift();
		}
		if(!redraw)
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
		var index = this.game.getIndex(a.playerId);
		this.drawSegment(a.x1, a.y1, a.x2, a.y2, index, pencilAlpha);
		this.inbuffer[index].push(a);
		this.inbufferSolid[index].push(a);
	}
}

Pencil.prototype.getRelativeMousePos = function(ev) {
	var pos = getMousePos(ev);
	pos[0] -= this.canvasLeft;
	pos[1] -= this.canvasTop;
	pos[0] /= this.game.scale;
	pos[1] /= this.game.scale;
	pos[0] = Math.round(Math.max(Math.min(this.game.width, pos[0]), 0));
	pos[1] = Math.round(Math.max(Math.min(this.game.height, pos[1]), 0));
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
	this.canvas.width = this.canvas.height = 0;
	var self = this;
	
	this.canvas.addEventListener('mousedown', function(ev) { self.onmouse('down', ev); }, false);
	this.canvas.addEventListener('mousemove', function(ev) { self.onmouse('move', ev); }, false);
	document.body.addEventListener('mouseup', function(ev) { self.onmouse('up', ev); }, false);
	this.canvas.addEventListener('mouseout', function(ev) { self.onmouse('out', ev); }, false);
	this.canvas.addEventListener('mouseover', function(ev) { self.onmouse('over', ev); }, false);

	this.resetButton = document.getElementById('editorReset');
	this.resetButton.addEventListener('click', function() { 
		this.segments = [];
		this.resize();	
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
	}, false);

	var stop = document.getElementById('editorStop');
	stop.addEventListener('click', function() { 
		self.game.setGameState('waiting'); 
		
		// freeing memory - is this the right way?
		self.canvas.height = self.canvas.width = 0;
	}, false);
}

Editor.prototype.onmouse = function(type, ev) {
	var pos = this.getMousePos(ev);
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

Editor.prototype.getMousePos = function(ev) {
	var pos = getMousePos(ev);
	pos[0] -= this.pos[0];
	pos[1] -= this.pos[1];
	pos[0] /= this.game.scale;
	pos[1] /= this.game.scale;
	return pos;
}

Editor.prototype.drawSegment = function(seg) {
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
	var inputControl = new InputController(localPlayer, keyCodeLeft, keyCodeRight);

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
	}

	/* ik wou dat het niet zo hoefde -- maar het moet */
	window.onscroll = function() {
		document.getElementById('sidebar').style.top = window.scrollY + 'px';
	}

	function sendParams(timeout, onlyAllowReplacement) {
		return function() {
			if(game.host != game.localPlayer || game.gameState != 'waiting')
				return;
			
			/* onlyAllowReplacement allows us not to send the params when it is not
			 * needed. ie, when we already sent the params after an onInput event.
			 * onChange would then still fire, which is annoying if you just pressed
			 * start game */
			if(onlyAllowReplacement && game.paramTimeout === null)
				return;
				
			window.clearTimeout(game.paramTimeout);
		
			game.paramTimeout = window.setTimeout(function() {
				game.sendParams();
				game.paramTimeout = null;
			}, timeout);

			document.getElementById('startGame').disabled = true;

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
		if(inputElts[i].type == 'text') {
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
