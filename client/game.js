/* game engine */
function GameEngine(audioController) {
	// game variables
	this.players = [];
	this.indexToPlayer = new Array(8);
	this.state = 'new'; // new, lobby, editing, waiting, countdown, playing, watching, ended
	this.type = null;

	// canvas related
	this.canvasContainer = document.getElementById('canvasContainer');
	this.baseCanvas = document.getElementById('baseCanvas');
	this.baseContext = this.baseCanvas.getContext('2d');
	this.initContext(this.baseContext);
	this.backupCanvas = document.getElementById('backupCanvas');
	this.backupContext = this.backupCanvas.getContext('2d');
	this.initContext(this.backupContext);

	// children
	this.pencil = new Pencil(this);
	this.localPlayer = new Player(this, true);
	this.audioController = new AudioController();
	this.playerList = document.getElementById('playerList').lastChild;
	this.gameList = document.getElementById('gameList').lastChild;
	this.chatBar = document.getElementById('chat');
	this.editor = new Editor(this);
	this.sidebar = document.getElementById('sidebar');
	this.rewardNodes = [];
	
	this.canvasTop = 0;
	this.canvasLeft = this.sidebar.offsetWidth;
}

/* this only resets things like canvas, but keeps the player info */
GameEngine.prototype.reset = function() {
	this.backupNeeded = false;
	this.lastRevert = this.tick = -1;
	this.tock = 0;
	this.redraws = 0;
	this.adjustGameTimeMessagesReceived = 0;
	this.modifiedInputs = 0;
	this.crossQueue = [];
	document.getElementById('winAnnouncer').style.display = 'none';
	
	this.pencil.reset();

	/* clear canvasses */
	this.backupContext.clearRect(0, 0, this.width, this.height);
	this.baseContext.clearRect(0, 0, this.width, this.height);
}

GameEngine.prototype.resetPlayers = function() {
	this.players = [];
	this.clearPlayerList();
	this.host = null;
}

GameEngine.prototype.getPlayer = function(playerId) {
	return this.players[playerId.toString()];
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
			if(self.connected) {
				self.gameMessage('Disconnected from server');
				self.connected = false;
			} else {
				self.gameMessage('Could not connect to server');
			}
			self.setGameState('new');
		}
	} catch(exception) {
		self.gameMessage('Websocket exception! ' + exception.name + ': ' + exception.message);
	}
}

GameEngine.prototype.leaveGame = function() {
	this.sendMsg('leaveGame', {});
	window.clearTimeout(this.gameloopTimeout);
	this.leaveButton.disabled = true;
}

GameEngine.prototype.addComputer = function() {
	this.sendMsg('addComputer', {});
}

/* this function handles user interface changes for state transitions */
GameEngine.prototype.setGameState = function(newState) {
	if(newState == 'new' || this.state == 'new') {
		var display = newState == 'new' ? 'none' : 'block';
		document.getElementById('playerListContainer').style.display = display;
		document.getElementById('gameTitle').style.display = display;
		document.getElementById('chatForm').style.display = display;
	}
	
	if(newState == 'waiting' || newState == 'lobby' || newState == 'new') {
		document.getElementById('gameTitle').className = '';
		document.getElementById('goalDisplay').style.display = 'none';
	}

	this.state = newState;

	switch(newState) {
		case 'lobby':
			setOptionVisibility('disconnect');
			setContentVisibility('gameListContainer');
			this.createButton.disabled = this.automatchButton.disabled = false;
			break;
		case 'editing':
			setContentVisibility('editor');
			break;
		case 'countdown':
			setContentVisibility('gameContainer');
			this.setKickLinksVisibility();
			document.getElementById('gameTitle').className = 'leftSide';
			document.getElementById('goalDisplay').style.display = 'block';
			break;
		case 'waiting':
			setOptionVisibility('stop');
			setContentVisibility('waitContainer');
			this.startButton.disabled = false;
			this.leaveButton.disabled = false;
			break;
		case 'playing':
			setOptionVisibility('stop');
			break;
		case 'ended':
			if(this.showSidebar())
				this.resize();

			this.setKickLinksVisibility();

			if(this.type == 'custom')
				setOptionVisibility('back');
			break;
		case 'new':
			resizeChat();
			setContentVisibility('connectionContainer');
			setOptionVisibility('nothing');
			this.connectButton.disabled = false;
			this.connectButton.innerHTML = 'Connect to Server';
			break;
	}
}

GameEngine.prototype.toggleSidebar = function() {
	if(this.sidebar.style.display == 'none')
		this.showSidebar();
	else
		this.hideSidebar();

	this.resize();
}

GameEngine.prototype.hideSidebar = function() {
	if(this.sidebar.style.display == 'none')
		return false;

	this.canvasLeft = 0;
	this.sidebar.style.display = 'none';
	document.getElementById('menuButton').innerHTML = '&gt;';
	document.getElementById('content').style.paddingLeft = '0px';
	return true;
}

GameEngine.prototype.showSidebar = function() {
	if(this.sidebar.style.display != 'none' && this.sidebar.style.display != '')
		return false;

	this.sidebar.style.display = 'block';
	document.getElementById('menuButton').innerHTML = '&lt;';
	document.getElementById('content').style.paddingLeft = '301px';
	this.canvasLeft = 301;
	return true;
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

GameEngine.prototype.getCollision = function(x1, y1, x2, y2) {
	var seg = new BasicSegment(x1, y1, x2, y2);
	var cut, mincut = 1;
	var other = null;
	
	for(var i in this.mapTeleports) {
		var t = this.mapTeleports[i];
		if(Math.max(x1, x2) < t.left || Math.min(x1, x2) > t.right || 
			Math.max(y1, y2) < t.top || Math.min(y1, y2) > t.bottom)
			continue;
		cut = segmentCollision(t, seg);
		if(cut != -1 && cut < mincut) {
			mincut = cut;
			other = t;
		}
	}
	
	if(other != null) {
		var obj = {};
		obj.isTeleport = true;
		cut = mincut;
		var colx = (1 - cut) * x1 + cut * x2;
		var coly = (1 - cut) * y1 + cut * y2;
		obj.collisionX = colx;
		obj.collisionY = coly;
		var r = other.tall ? coly - other.y1 : colx - other.x1;
		obj.destX = other.destX + r * other.dx;
		obj.destY = other.destY + r * other.dy;
		obj.extraAngle = other.extraAngle;
		return obj;
	}
	
	return null;
}

GameEngine.prototype.getTeleport = function(colorId, a, b, c, d) {
	var vx = b.x - a.x;
	var vy = b.y - a.y;
	var wx = d.x - c.x;
	var wy = d.y - c.y;
	
	var t = new BasicSegment(a.x, a.y, b.x, b.y);
	t.tall = Math.abs(vy) > Math.abs(vx);
	t.color = playerColors[colorId];
	t.dx = wx / (t.tall ? vy : vx);
	t.dy = wy / (t.tall ? vy : vx);
	t.extraAngle = getAngle(wx, wy) - getAngle(vx, vy);
	t.destX = c.x;
	t.destY = c.y;
	t.left = Math.min(a.x, b.x);
	t.right = Math.max(a.x, b.x);
	t.top = Math.min(a.y, b.y);
	t.bottom = Math.max(a.y, b.y);
	return t;
}

GameEngine.prototype.parseByteMsg = function(str) {
	var a = str.charCodeAt(0);
	var mode = a & 7;
	
	if(mode == modeJson)
		return false;
	
	if(mode == modeModified) {
		var b = str.charCodeAt(1);
		var c = str.charCodeAt(2);
		var d = str.charCodeAt(3);
		
		var input = (a & (127 - 7)) >> 3;
		input |= b << 4;
		input |= (c & 15) << 11;
		var tickDelta = (c & (16 + 32 + 64)) >> 4;
		tickDelta |= d << 3;

		this.localPlayer.inputs[input].tick += tickDelta;
		this.backupNeeded = true;
		
		return true;
	}

	if(mode == modeTickUpdate) {
		var b = str.charCodeAt(1);
		var c = str.charCodeAt(2);
	
		var player = this.indexToPlayer[(a & (8 + 16 + 32)) >> 3];
		var tickDelta = (a & 64) >> 6;
		tickDelta |= (127 & b) << 1;
		tickDelta |= (127 & c) << 8;

		player.lastInputTick += tickDelta;
		return true;
	}
	
	if(mode == modeOther) {
		mode = a;
		switch(mode) {
			case modeSetMap:
				var msg = new ByteMessage(str, 3);
				this.mapSegments = [];
				this.mapTeleports = [];
				while(true) {
					var b = str.charCodeAt(msg.at++);
					if(b == 0)
						break;
					var colorId = b & 31;
					this.mapTeleports.push(this.getTeleport(colorId, msg.readPos(), 
						msg.readPos(), msg.readPos(), msg.readPos()));
				}
				while(msg.at < msg.data.length) {
					var a1 = msg.readPos();
					var a2 = msg.readPos();
					this.mapSegments.push(new BasicSegment(a1.x, a1.y, a2.x, a2.y));
				}
			return true;
		}
	}
	
	switch(mode) {
		case modePencil:
			var msg = new ByteMessage(str, 1);
			var player = this.indexToPlayer[(a & (8 + 16 + 32)) >> 3];
			this.pencil.handleMessage(msg, player);
			return true;
	}
}

GameEngine.prototype.decodeTurn = function(oldTurn, turnChange) {
	if((oldTurn == 0 || oldTurn == 1) && turnChange == 0)
		return -1;

	if((oldTurn == 0 || oldTurn == -1) && turnChange == 1)
		return 1;

	return 0;
}

GameEngine.prototype.parseSteerMsg = function(str) {
	var a = str.charCodeAt(0);
	var b = str.charCodeAt(1);
	
	var index = a & 7;
	var turnChange = (a & 8) >> 3;
	var tickDelta = ((a & (16 + 32 + 64)) >> 4) | (b << 3);
	var player = this.indexToPlayer[index];
	var newTurn = this.decodeTurn(player.lastInputTurn, turnChange);
	var tick = player.lastInputTick += tickDelta;
	player.lastInputTurn = newTurn;

	player.inputs.push({tick: tick, turn: newTurn});
	
	if(tick < this.tock)
		this.backupNeeded = true;
}

GameEngine.prototype.interpretMsg = function(msg) {
	var self = this;

	if(msg.data.length == 2)
		return this.parseSteerMsg(msg.data);
	
	if(this.parseByteMsg(msg.data))
		return;
	
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
			this.localPlayer.id = obj.playerId.toString();
			this.tickLength = obj.tickLength;
			this.pencil.inkMinimumDistance = obj.inkMinimumDistance;
			break;
		case 'kickNotification':
			this.gameMessage('You were kicked from the game');
			break;
		case 'joinedGame':
			this.resetPlayers();
			this.type = obj.type;
			this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
			this.mapSegments = undefined;
			this.mapTeleports = [];
			this.noMapSent = true;
			this.indexToPlayer[obj.index] = this.localPlayer;
			this.localPlayer.index = obj.index;
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

			if(obj.type != 'custom')
				this.setHost(null);
			break;
		case 'gameParameters':
			this.setParams(obj);
			break;				
		case 'newPlayer':
			var newPlayer = new Player(this, false);
			newPlayer.id = obj.playerId.toString();
			this.indexToPlayer[obj.index] = newPlayer;
			newPlayer.index = obj.index;
			newPlayer.playerName = escapeString(obj.playerName);
			this.addPlayer(newPlayer);
			this.audioController.playSound('newPlayer');
			break;
		case 'startGame':
			/* keep displaying old game for a while so ppl can see what happened */
			var nextRoundDelay = obj.startTime - this.serverTimeDifference - this.ping
			 + extraGameStartTimeDifference - Date.now();
			 
			// first back to game lobby for some reset work
			if(this.state == 'ended')
				this.backToGameLobby();
				
			document.getElementById('goalDisplay').innerHTML = 'Goal: ' + obj.goal + ' points';

			if(nextRoundDelay > this.countdown) {
				var self = this;

				this.gameloopTimeout = window.setTimeout(function() {
					self.start(obj.startPositions, obj.startTime);
				}, nextRoundDelay - this.countdown);
			}
			else
				this.start(obj.startPositions, obj.startTime);
			break;
		case 'adjustGameTime':
			if(acceptGameTimeAdjustments) {
				//this.gameMessage('Adjusted game time by ' + obj.forward + ' msec');
				this.gameStartTimestamp -= obj.forward;
				this.ping += obj.forward;
				this.adjustGameTimeMessagesReceived++;
				this.displayDebugStatus();
				this.updateSafeTick();
			} else
				this.gameMessage('Game time adjustment of ' + obj.forward + ' msec rejected');
			break;
		case 'playerLeft':
			var player = this.getPlayer(obj.playerId);
			
			if(this.state != 'lobby' || obj.reason != 'normal')
				this.gameMessage(player.playerName + ' left the game' +
				 (obj.reason == 'normal' ? '' : ' (' + obj.reason + ')'));

			this.removePlayer(player);
			this.audioController.playSound('playerLeft');
			break;
		case 'playerDied':
			var player = this.getPlayer(obj.playerId);
			player.finalSteer(obj);

			player.status = 'dead';
			player.updateRow();
	
			if(player == this.localPlayer) {
				if(this.pencilMode == 'ondeath') 
					this.pencil.enable(obj.tick);
				else
					this.setGameState('watching');
				this.audioController.playSound('localDeath');
			}

			this.displayRewards(obj.reward);
			for(var i in this.players) {
				var player = this.players[i];
				if(player.status == 'alive') {
					player.points += obj.reward;
					player.updateRow();
				}
			}

			this.sortPlayerList();		
			break;
		case 'endRound':
			window.clearTimeout(this.gameloopTimeout);
			this.revertBackup();
			document.getElementById('inkIndicator').style.display = 'none';
			for(var i = this.maxHiddenRewards; i < this.rewardNodes.length; i++)
				this.canvasContainer.removeChild(this.rewardNodes.pop());
				
			// simulate to finalTick
			while(this.tick <= obj.finalTick)
				this.doTick();
			while(this.tock <= obj.finalTick)
				this.doTock();
				
			if(debugPos) 
				printDebugPos();
				
			var player = (obj.winnerId != -1) ? this.getPlayer(obj.winnerId) : null;
			var winner = (player != null) ? (player.playerName + ' won') : 'draw!';
			this.setGameState('countdown');
			this.gameMessage('Round ended: ' + winner);
			break;			
		case 'endGame':
			this.setGameState('ended');
			window.clearTimeout(this.gameloopTimeout);
			var winner = this.getPlayer(obj.winnerId);			
			this.gameMessage('Game over: ' + winner.playerName + ' won!');

			var announcement = document.getElementById('winAnnouncer');
			announcement.innerHTML = winner.playerName + ' won!';
			announcement.style.display = 'inline-block';

			if(winner.isLocal)
				this.audioController.playSound('localWin');
			if(jsProfiling)
				console.profileEnd();
			break;
		case 'time':
			this.handleSyncResponse(obj.time);
			break;
		case 'chat':
			this.audioController.playSound('chat');
			this.printChat(this.getPlayer(obj.playerId), obj.message);
			break;
		case 'newGame':
			this.appendGameList(obj);
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
			this.setHost(this.getPlayer(obj.playerId));
			break;
		case 'joinFailed':
			var msg = 'game already started';
			if(obj.reason == 'notFound') msg = 'game not found';
			else if(obj.reason == 'full') msg = 'game is full';
			else if(obj.reason == 'kicked') msg = 'you are banned for another ' + obj.timer + ' milliseconds';

			this.gameMessage('Could not join game: ' + msg);

			if(obj.reason == 'started')
				document.getElementById('game' + obj.id).getElementsByTagName('button')[0].disabled = true;
			else if(obj.reason == 'notFound') {
				var row = document.getElementById('game' + obj.id);

				if(row != null)
					row.parentNode.removeChild(row);

				if(!this.gameList.hasChildNodes())
					document.getElementById('noGames').style.display = 'block';
			}
			break;
		case 'debugPos':
			debugPosB[obj.tick] = obj.msg;
			break;
		default:
			this.gameMessage('Unknown mode ' + obj.mode + '!');
	}
}

GameEngine.prototype.removePlayer = function(player) {
	delete this.players[player.id];
	
	if(this.state == 'waiting' || this.state == 'lobby' || this.state == 'editing' || player.status == 'left' ||
	 (this.state == 'ended' && player.status == 'ready')) {
		this.playerList.removeChild(player.row);
		resizeChat();
	} else {
		player.id += '_left';
		this.players[player.id] = player;
		player.status = 'left';
		player.updateRow();
	}
}

GameEngine.prototype.setKickLinksVisibility = function() {
	var showLinks = this.host == this.localPlayer &&
	 (this.state == 'waiting' || this.state == 'ended' || this.state == 'editing');
	var kickLinks = this.playerList.getElementsByTagName('a');

	for(var i = 0; i < kickLinks.length; i++)
		kickLinks[i].className = showLinks ? 'close' : 'close hidden';
}

GameEngine.prototype.setHost = function(player) {
	if(this.host != null) {
		this.host.isHost = false;
		if(this.state == 'waiting' || this.state == 'editing') {
			this.host.status = 'ready';
			this.host.updateRow();
		}
	}
	if(player != null) {
		this.host = player;
		this.host.isHost = true;
		if(this.state == 'waiting' || this.state == 'editing') {
			this.host.status = 'host';
			this.host.updateRow();
		}
	} else
		this.host = null;
	
	var localHost = this.host == this.localPlayer;
	
	var hostBlock = localHost ? 'block' : 'none';
	var nonhostBlock = localHost ? 'none' : 'block';
	this.hostContainer.style.display = hostBlock;
	this.nonhostContainer.style.display = nonhostBlock;

	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++)
		inputElts[i].disabled = !localHost;

	this.setKickLinksVisibility();
}

GameEngine.prototype.buildGameList = function(list) {
	var startedGames = [];

	while(this.gameList.hasChildNodes())
		this.gameList.removeChild(this.gameList.firstChild);

	document.getElementById('noGames').style.display = 'block';

	for(var i = 0; i < list.length; i++)
		if(startedGamesDisplay != 'below' && list[i].state == 'started')
			startedGames.push(list[i]);
		else
			this.appendGameList(list[i]);

	if(startedGamesDisplay == 'below')
		for(var i = 0; i < startedGames.length; i++)
			this.appendGameList(startedGames[i]);
}

GameEngine.prototype.appendGameList = function(obj) {
	var self = this;
	document.getElementById('noGames').style.display = 'none';

	var row = document.createElement('tr');
	row.id = 'game' + obj.id;

	var node = document.createElement('td');
	node.innerHTML = obj.id;
	row.appendChild(node);

	node = document.createElement('td');
	node.innerHTML = obj.type;
	row.appendChild(node);

	node = document.createElement('td');
	var nameSpan = document.createElement('span');
	nameSpan.innerHTML = obj.host != undefined ? obj.host : '-';
	nameSpan.className = 'noverflow';
	node.appendChild(nameSpan);
	row.appendChild(node);

	node = document.createElement('td');
	node.innerHTML = obj.state;
	row.appendChild(node);

	node = document.createElement('td');
	node.innerHTML = obj.n + "/" + (obj.type == 'custom' ? obj.nmax : obj.nmin);
	row.appendChild(node);

	var button = document.createElement('button');
	button.innerHTML = 'Join';
	button.disabled = (obj.state != 'lobby');
	button.addEventListener('click', function() { self.joinGame(obj.id); });

	node = document.createElement('td');
	node.appendChild(button);
	row.appendChild(node);

	this.gameList.appendChild(row);
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
	var ctx = this.backupContext;
	setLineColor(ctx, [0, 0, 0], 1);
	ctx.lineWidth = 1;
	ctx.beginPath();
	for(var i = 0; i < segments.length; i++) {
		var s = segments[i];
		ctx.moveTo(s.x1, s.y1);
		ctx.lineTo(s.x2, s.y2);
	}
	ctx.stroke();
	ctx.lineWidth = lineWidth;
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

	this.updateSafeTick();
}

GameEngine.prototype.updateSafeTick = function() {
	this.safeTickDifference = Math.ceil((serverDalay + 2 * this.ping)/ this.tickLength  + tickSafetyMargin);
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
	
	if(this.state == 'editing')
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
	this.automatchButton.disabled = true;
}

GameEngine.prototype.createGame = function() {
	this.sendMsg('createGame', {});
	this.createButton.disabled = true;
}

GameEngine.prototype.sendMsg = function(mode, data) {
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

	player.simulate(this.tick, this.baseContext);
		
	this.tick++;
}

GameEngine.prototype.doTock = function() {
	for(var i in this.players) {
		var player = this.players[i];
		player.simulate(this.tock, this.baseContext);
	}
	this.tock++;
}

GameEngine.prototype.addPlayer = function(player) {
	player.color = playerColors[player.index];
	player.segColor = getRGBstring(player.color);
	player.holeColor = getRGBAstring(player.color, holeAlpha);
	if(player == this.localPlayer)
		this.pencil.inkDiv.style.backgroundColor = getRGBAstring(player.color, 0.5);
	player.status = 'ready';
	player.points = 0;
	player.isHost = false;
	this.players[player.id] = player;
	this.appendPlayerList(player);

	if(player == this.localPlayer)
		document.getElementById('ink').style.backgroundColor = 'rgba(' +
		 player.color[0] + ', ' + player.color[1] + ', ' + player.color[2] + ', 0.5)';
}

/* sets this.scale, which is canvas size / game size */
GameEngine.prototype.calcScale = function(extraVerticalSpace) {
	var targetWidth = Math.max(document.body.clientWidth - this.sidebar.offsetWidth - 1,
	 canvasMinimumWidth);
	var targetHeight = document.body.clientHeight - 1;
	if(extraVerticalSpace != undefined)
		targetHeight -= extraVerticalSpace;
	
	var scaleX = targetWidth/ this.width;
	var scaleY = targetHeight/ this.height;
	this.scale = Math.min(scaleX, scaleY);
}

GameEngine.prototype.unlockStart = function() {
	this.startButton.disabled = false;
	this.startButton.innerHTML = 'Start Game';
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

	if(debugMap != null && debugMap != '')
		this.editor.load(debugMap);
	
	if(this.editor.mapChanged) {
		obj.segments = this.editor.segments;
		this.editor.mapChanged = false;
	}
	
	if(debugComputers > 0)
		for(var i = 0; i < debugComputers; i++)
			this.addComputer();

	this.sendMsg('startGame', obj);
	this.startButton.disabled = true;
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime - this.serverTimeDifference - this.ping
	 + extraGameStartTimeDifference;
	this.setGameState('countdown');
	var delay = this.gameStartTimestamp - Date.now();

	this.reset();
	
	if(debugPos) {
		debugPosA = [];
		debugPosB = [];
	}
	
	if(jsProfiling)
		console.profile('canvas performance');

	this.audioController.playSound('countdown');

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var player = this.getPlayer(startPositions[i].playerId);
		
		player.initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle,
		 startPositions[i].holeStart);
	}
	
	if(this.pencilMode == 'on')
		this.pencil.enable(0);
	
	for(var i in this.players) {
		var player = this.players[i];
		if(player.status == 'left')
			player.finalTick = -1;
	}

	if(alwaysHideSidebar || touchDevice)
		this.hideSidebar();

	this.resize();

	/* draw angle indicators */
	for(var i = 0; i < startPositions.length; i++)
		this.getPlayer(startPositions[i].playerId).drawIndicator();

	var self = this;
	this.gameloopTimeout = window.setTimeout(function() { self.realStart(); }, delay + this.tickLength);
	this.focusChat();
}

GameEngine.prototype.revertBackup = function() {
	this.redraws++;
	this.displayDebugStatus();

	// simulate every player up to safe point on backupcanvas
	for(var i in this.players) {
		var player = this.players[i];
		
		if(player.status == 'ready')
			break;

		player.loadLocation();

		var localTick = player.isLocal ? this.tick : this.tock;
		var knownTick = Math.max(Math.min(player.finalTick, localTick - this.safeTickDifference),
		 player.inputs.length == 0 ? 0 : player.inputs[player.inputs.length - 1].tick);

		player.simulate(knownTick, this.backupContext);
		player.saveLocation();
	}

	// draw crosses
	for(var i = 0, len = this.crossQueue.length/ 2; i < len; i++)
		this.drawCross(this.backupContext, this.crossQueue[2 * i], this.crossQueue[2 * i + 1]);

	this.crossQueue = [];

	// clear base canvas
	this.baseContext.clearRect(0, 0, this.width, this.height);

	// simulate every player up to tick/ tock
	for(var i in this.players) {
		var player = this.players[i];
		var tick = player.isLocal ? this.tick - 1 : this.tock - 1;

		if(player.status == 'ready')
			break;

		player.simulate(tick, this.baseContext);
	}

	// copy backupcanvas to basecanvas
	this.baseContext.drawImage(this.backupCanvas, 0, 0, this.width, this.height);

	this.backupNeeded = false;
	this.lastRevert = this.tick;
}

GameEngine.prototype.realStart = function() {
	this.baseContext.clearRect(0, 0, this.width, this.height);
	this.baseContext.drawImage(this.backupCanvas, 0, 0, this.width, this.height);

	this.audioController.playSound('gameStart');
	this.setGameState('playing');
	this.sendMsg('enableInput', {});
	this.tick = 0;
	
	var self = this;
	var gameloop = function() {
		var timeOut;
		var tellert = 0;

		do {
			if(self.state != 'playing' && self.state != 'watching')
				return;
				
			if(debugRewards && self.tick % 60 == 0)
				self.displayRewards(1);

			if(tellert++ > 100) {
		 		self.gameMessage('ERROR. stopping gameloop. debug information: next tick time = ' +
		 		 ((self.tick + 1) * self.tickLength) + ', current game time = ' + 
		 		 (Date.now() - self.gameStartTimestamp));
		 		return;
		 	}

			if(self.backupNeeded || self.tick - self.lastRevert > maxTickDifference)
				self.revertBackup();
			
			while(self.tick - self.tock >= tickTockDifference)
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
	var ctx = this.backupContext;
	ctx.beginPath();
	setLineColor(ctx, mapSegmentColor, 1);
	for(var i = 0; i < this.mapSegments.length; i++) {
		var seg = this.mapSegments[i];
		ctx.moveTo(seg.x1, seg.y1);
		ctx.lineTo(seg.x2, seg.y2);
	}
	ctx.stroke();
	
	for(var i in this.mapTeleports) {
		var seg = this.mapTeleports[i];
		drawTeleport(ctx, seg);
	}
}

GameEngine.prototype.createRewardNode = function(player, reward) {
	var node;
	var recycle = this.rewardNodes.length > 0;
	var w = rewardWidth;
	var h = rewardHeight;

	if(recycle) {
		node = this.rewardNodes.pop();
	} else {
		node = document.createElement('div');
		node.className = 'reward';
	}
	
	node.innerHTML = '+' + reward;
	var left = player.x * this.scale - w / 2;
	left = Math.min(this.width * this.scale - w, Math.max(0, left));
	var top = player.y * this.scale - h - rewardOffsetY;
	if(top < 0)
		top += rewardOffsetY * 2 + h;
	node.style.left = left + 'px';
	node.style.top = top + 'px';
	
	if(recycle) {
		node.style.display = 'block';
	} else {
		this.canvasContainer.appendChild(node);
	}
	
	return node;
}

GameEngine.prototype.displayRewards = function(reward) {
	if(!reward)
		return;
	
	var self = this;
	var nodes = [];
	
	for(var i in this.players) {
		var player = this.players[i];
		if(player.status == 'alive') {
			nodes.push(this.createRewardNode(player, reward));
		}
	}
	
	function recycleRewards() {
		for(var i = 0; i < nodes.length; i++) {
			nodes[i].className = 'reward';
			nodes[i].style.display = 'none';
		}
		self.rewardNodes = self.rewardNodes.concat(nodes);
	}
	
	function startHidingRewards() { 
		for(var i = 0; i < nodes.length; i++) {
			nodes[i].className += ' reward-hidden';
		}
	}
	
	window.setTimeout(startHidingRewards, rewardShowLength);
	window.setTimeout(recycleRewards, rewardShowLength + rewardMaxTransitionLength);
}

GameEngine.prototype.resize = function() {
	this.calcScale();
	var scaledWidth = Math.round(this.scale * this.width);
	var scaledHeight = Math.round(this.scale * this.height)
	this.canvasContainer.style.width = scaledWidth + 'px';
	this.canvasContainer.style.height = scaledHeight + 'px';
	
	var ctx = this.backupContext;
	var canvas = this.backupCanvas;
	canvas.width = scaledWidth;
	canvas.height = scaledHeight;
	this.initContext(ctx);

	ctx = this.baseContext;
	canvas = this.baseCanvas;
	canvas.width = scaledWidth;
	canvas.height = scaledHeight;
	this.initContext(ctx);

	for(var i in this.players) {
		var player = this.players[i];
		
		if(player.status == 'ready')
			break;

		//TODO: voor alle startvariabelen zelfde methode gebruiken als saveLocation loadLocation
		player.x = player.startX;
		player.y = player.startY;
		player.angle = player.startAngle;
		player.changeCourse(0);
		player.inHole = false;
		player.velocity = player.startVelocity;
		player.tick = 0;
		player.turn = 0;
		player.nextInputIndex = 0;
		player.saveLocation();
	}
	
	this.drawMapSegments();

	if(this.pencilMode != 'off')
		this.pencil.drawPlayerSegs(true);

	this.revertBackup();
}

GameEngine.prototype.drawCross = function(ctx, x, y) {	
	setLineColor(ctx, crossColor, 1);
	ctx.lineWidth = crossLineWidth;
	ctx.beginPath();
	ctx.moveTo(x - crossSize / 2, y - crossSize / 2);
	ctx.lineTo(x + crossSize / 2, y + crossSize / 2);
	ctx.moveTo(x + crossSize / 2, y - crossSize / 2);
	ctx.lineTo(x - crossSize / 2, y + crossSize / 2);
	ctx.stroke();
	ctx.lineWidth = lineWidth;
}

GameEngine.prototype.initContext = function(ctx) {
	ctx.scale(this.scale, this.scale);
	ctx.lineWidth = lineWidth;
	ctx.lineCap = lineCapStyle;
}

GameEngine.prototype.displayDebugStatus = function() {
	if(displayDebugStatus)
		document.getElementById('status').innerHTML = 
		 'redraws: ' + this.redraws + ', modified inputs: ' + this.modifiedInputs +
		 ', game time adjustments: ' + this.adjustGameTimeMessagesReceived;
}

GameEngine.prototype.requestKick = function(id) {
	this.sendMsg('kick', {'playerId': id});
}

GameEngine.prototype.appendPlayerList = function(player) {
	var row = document.createElement('tr');
	var nameNode = document.createElement('td');
	var nameSpan = document.createElement('span');
	var kickLink = document.createElement('a');
	var statusNode = document.createElement('td');
	var pointsNode = document.createElement('td');
	var self = this;

	nameSpan.innerHTML = player.playerName;
	nameSpan.className = 'noverflow';
	player.row = row;

	kickLink.className = this.host == this.localPlayer ? 'close' : 'close hidden';
	kickLink.innerHTML = 'x';
	kickLink.addEventListener('click', function() { self.requestKick(parseInt(player.id)); });

	this.playerList.appendChild(row);
	if(player != this.localPlayer)
		nameNode.appendChild(kickLink);
	nameNode.appendChild(nameSpan);
	row.appendChild(nameNode);
	row.appendChild(statusNode);
	row.appendChild(pointsNode);
	player.updateRow();
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

	for(var i = 1; i < arr.length; i++)
		if(arr[i] != this.playerList.lastChild) {
			this.playerList.removeChild(arr[i]);
			this.playerList.appendChild(arr[i]);
		}
}

GameEngine.prototype.sendChat = function() {
	var msg = this.chatBar.value;

	if(this.state == 'new' || msg.length < 1)
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
	// remove players who left game & set status for other players
	for(var i in this.players) {
		var player = this.players[i];

		if(player.status == 'left')
			this.removePlayer(player);
		else {
			player.status = player.isHost ? 'host' : 'ready';
			player.points = 0;
			player.updateRow();
		}
	}
}

GameEngine.prototype.getGamePos = function(e) {
	var v = getPos(e);
	v.x = (v.x - this.canvasLeft) / this.scale;
	v.y = (v.y - this.canvasTop) / this.scale;
	v.x = Math.round(Math.max(Math.min(this.width, v.x), 0));
	v.y = Math.round(Math.max(Math.min(this.height, v.y), 0));
	return v;
}

/* Player
 * properties:
 * - status: ready, host, alive, dead or left
 */
function Player(game, isLocal) {
	this.game = game;
	this.isLocal = isLocal;
	if(isLocal)
		this.inputController = new InputController(this, keyCodeLeft, keyCodeRight);
}

Player.prototype.saveLocation = function() {
	this.lcx = this.x;
	this.lcy = this.y;
	this.lca = this.angle;
	this.lcturn = this.turn;
	this.lcvelocity = this.velocity;
	this.lctick = this.tick;
	this.lcnextInputIndex = this.nextInputIndex;
	this.lcinHole = this.inHole;
	this.lcdx = this.dx;
	this.lcdy = this.dy;
}

Player.prototype.loadLocation = function() {
	this.x = this.lcx;
	this.y = this.lcy;
	this.angle = this.lca;
	this.turn = this.lcturn;
	this.velocity = this.lcvelocity;
	this.tick = this.lctick;
	this.nextInputIndex = this.lcnextInputIndex;
	this.inHole = this.lcinHole;
	this.dx = this.lcdx;
	this.dy = this.lcdy;
}

Player.prototype.changeCourse = function(angle) {
	this.angle += angle;
	this.dx = Math.cos(this.angle) * this.velocity * this.game.tickLength / 1000;
	this.dy = Math.sin(this.angle) * this.velocity * this.game.tickLength / 1000;
}

Player.prototype.finalSteer = function(obj) {
	var tick = obj.tick;
	var localTick = this.isLocal ? this.game.tick : this.game.tock;
	
	for(var i = this.inputs.length - 1; i >= 0 && this.inputs[i].tick >= tick; i--);
	this.inputs.length = i + 2;
	this.inputs[i + 1] = {'tick': tick, 'finalTurn': true, 'x': obj.x, 'y': obj.y};
	this.finalTick = tick;

	if(tick < localTick)
		this.game.backupNeeded = true;
}

Player.prototype.setSegmentStyle = function(ctx) {
	ctx.strokeStyle = this.inHole ? this.holeColor : this.segColor;
	ctx.lineCap = this.inHole ? 'butt' : 'round';
}

Player.prototype.simulate = function(endTick, ctx) {
	if(this.tick > endTick || this.tick > this.finalTick)
		return;
	
	var nextInput = this.inputs[this.nextInputIndex];
	this.setSegmentStyle(ctx);

	ctx.beginPath();
	ctx.moveTo(this.x, this.y);
	
	for(; this.tick <= endTick; this.tick++) {

		var inHole = (this.tick > this.holeStart && (this.tick + this.holeStart)
		 % (this.holeSize + this.holeFreq) < this.holeSize);
		if(inHole != this.inHole) {
			ctx.stroke();

			this.inHole = inHole;
			this.setSegmentStyle(ctx);
			ctx.beginPath();
			ctx.moveTo(this.x, this.y);
		}
		
		if(nextInput != null && nextInput.tick == this.tick) {
			if(nextInput.finalTurn) {
				ctx.lineTo(nextInput.x, nextInput.y);
				ctx.stroke();

				this.game.crossQueue.push(this.x = nextInput.x);
				this.game.crossQueue.push(this.y = nextInput.y);
				this.tick++;
				return;
			} else {
				this.turn = nextInput.turn;
				nextInput = this.inputs[++this.nextInputIndex];
			}
		}

		if(this.turn != 0) {
			this.changeCourse(this.turn * this.turnSpeed  * this.game.tickLength / 1000);
		}
		
		var obj = this.game.getCollision(this.x, this.y, this.x + this.dx, this.y + this.dy);
		var handled = false;
		
		if(obj != null) {
			if(obj.isTeleport) {
				ctx.lineTo(obj.collisionX, obj.collisionY);
				this.changeCourse(obj.extraAngle);
				
				this.x = obj.destX + Math.cos(this.angle) / 10;
				this.y = obj.destY + Math.sin(this.angle) / 10;
				ctx.moveTo(this.x, this.y);
				handled = true;
			}
		}
		
		if(!handled) {
			ctx.lineTo(this.x += this.dx, this.y += this.dy);
			
			/* wrap around */
			if(this.game.torus && (this.x < 0 || this.x > this.game.width ||
				this.y < 0 || this.y > this.game.height)) {
				if(this.x > this.game.width)
					this.x = 0;
				else if(this.x < 0)
					this.x = this.game.width;

				if(this.y > this.game.height)
					this.y = 0;
				else if(this.y < 0)
					this.y = this.game.height;
			}
		}
		
		if(debugPos && debugPosA[this.tick] == null)
			debugPosA[this.tick] = format(this.x, 21) + ', ' + format(this.y, 21) + ', ' + 
				format(this.angle, 21) + ', ' + handled;
	}

	ctx.stroke();
}

Player.prototype.updateRow = function() {
	if(this.status == 'left')
		this.row.className = 'left';
		
	if(this.game.type != 'lobby')
		this.row.childNodes[0].style.color = getRGBstring(this.color);

	this.row.childNodes[1].innerHTML = this.status;
	this.row.childNodes[2].innerHTML = this.points;
}

Player.prototype.initialise = function(x, y, angle, holeStart) {
	this.startVelocity = this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.holeStart = holeStart;
	this.holeSize = this.game.holeSize;
	this.holeFreq = this.game.holeFreq;
	this.inHole = false;
	this.status = 'alive';
	this.startX = this.x = x;
	this.startY = this.y = y;
	this.nextInputIndex = 0;
	this.startAngle = this.angle = angle;
	this.changeCourse(0);
	this.turn = 0;
	this.inputs = [];
	this.tick = 0;
	this.lastInputTick = -1;
	this.lastInputTurn = 0;
	this.finalTick = Infinity;
	this.updateRow();
	this.saveLocation();

	if(this.inputController != undefined)
		this.inputController.reset();
}

Player.prototype.drawIndicator = function() {
	var ctx = this.game.baseContext, x = this.x, y = this.y, angle = this.angle;

	drawIndicatorArrow(ctx, x, y, angle, this.color);
	
	/* draws name next to indicator */
	var text = this.isLocal ? 'YOU' : this.playerName;
	ctx.fillStyle = getRGBstring(this.color);// this.isLocal ? '#fff' : '#444';
	ctx.font = 'bold ' + indicatorFont + 'px Helvetica, sans-serif';
	ctx.textBaseline = 'bottom';
	var w = ctx.measureText(text).width;
	x = this.x - (Math.cos(this.angle) > 0 && Math.sin(this.angle) < 0 ? w + 2 : 0);
	y = this.y - 3;
	ctx.fillText(text, Math.min(this.game.width - w, Math.max(0, x)), y);
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
	var canvas = player.game.baseCanvas;

	this.reset();

	/* listen for keyboard events */
	window.addEventListener('keydown', function(e) {
		if(self.player.status != 'alive' || game.state != 'playing') {
			if(game.state == 'editing' && document.activeElement != game.chatBar) {
				if(e.keyCode == 85) {
					game.editor.undo();
					e.preventDefault();
				}
				if(e.keyCode == 80 || e.keyCode == 49) {
					simulateClick(game.editor.pencilButton);
					e.preventDefault();
				}
				if(e.keyCode == 83 || e.keyCode == 50) {
					simulateClick(game.editor.playerStartButton);
				}
				if(e.keyCode == 84 || e.keyCode == 51) {
					simulateClick(game.editor.teleportButton);
					e.preventDefault();
				}
				if(e.keyCode == 69 || e.keyCode == 52) {
					simulateClick(game.editor.eraserButton);
					e.preventDefault();
				}
			}
			return;
		}

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
		if(self.player.status != 'alive' || game.state != 'playing')
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
			var pos = game.getGamePos(e);
			pencil.curX = pos.x;
			pencil.curY = pos.y;
		}
	}

	function mouseDown(e) {
		if(pencil.drawingAllowed && !pencil.down && pencil.ink > pencil.mousedownInk)
			pencil.startDraw(game.getGamePos(e));
	}

	function mouseEnd(e) {
		if(emulateTouch)
			touchEnd(convertMouseToTouch(e));
		else
			stopDraw(e);
	}
	
	function stopDraw(e) {
		if(pencil.drawingAllowed && pencil.down) {
			var pos = game.getGamePos(e);
			pencil.curX = pos.x;
			pencil.curY = pos.y;

			pencil.down = false;
			pencil.upped = true;

			pencil.game.focusChat();
		}
	};

	function touchStart(e) {
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = game.getGamePos(touch);
			var totalWidth = game.width;
			var right = (pos.x <= totalWidth * steerBoxSize);  // FIXME: dit is precies andersom als hoe t zou moeten -- hoe kan dit?
			var left = (pos.x >= (1 - steerBoxSize) * totalWidth);

			if(self.player.status == 'alive' && left && self.leftTouch === null) {
				self.leftTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				self.pressLeft();
			}

			else if(self.player.status == 'alive' && right && self.rightTouch === null) {
				self.rightTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				self.pressRight();
			}

			else if(self.pencilTouch == null && !pencil.down &&
			 pencil.ink > pencil.mousedownInk && pencil.drawingAllowed) {
				self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				pencil.startDraw(pos);
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	function touchEnd(e) {
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
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
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = game.getGamePos(touch);
			var totalWidth = game.width;
			var right = (pos.x <= totalWidth * steerBoxSize);
			var left = (pos.x >= (1 - steerBoxSize) * totalWidth);

			if(self.leftTouch != null && touch.identifier == self.leftTouch.identifier) {
				var convert = (getLength(pos.x - self.leftTouch.startX, pos.y - self.leftTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && !pencil.down && pencil.ink > pencil.mousedownInk);

				/* convert this touch to pencil touch */
				if(convert) {
					self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
					pencil.startDraw({x: self.leftTouch.startX, y: self.leftTouch.startY});
				}

				if(convert || !left) {
					self.releaseLeft();
					self.leftTouch = null;
				}
			}

			else if(self.rightTouch != null && touch.identifier == self.rightTouch.identifier) {
				var convert = (getLength(pos.x - self.rightTouch.startX, pos.y - self.rightTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && !pencil.down && pencil.ink > pencil.mousedownInk);

				if(convert) {
					self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
					pencil.startDraw({x: self.rightTouch.startX, y: self.rightTouch.startY});
				}

				if(convert || !right) {
					self.releaseRight();
					self.rightTouch = null;
				}
			}

			else if(self.pencilTouch != null && touch.identifier == self.pencilTouch.identifier)
				if(pencil.drawingAllowed && pencil.down) {
					var pos = game.getGamePos(touch);
					pencil.curX = pos.x;
					pencil.curY = pos.y;
				}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		canvas.addEventListener('touchstart', touchStart, false);
		canvas.addEventListener('touchend', touchEnd, false);
		canvas.addEventListener('touchcancel', touchEnd, false);
		canvas.addEventListener('touchmove', touchMove, false);
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
	this.lastSteerTick = -1;
	this.lastSteerTurn = 0;
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
	if(turn == this.lastSteerTurn)
		return;

	var game = this.player.game;
	var obj = {'turn': turn, 'tick': game.tick};

	if(this.lastSteerTick == obj.tick)
		obj.tick = ++this.lastSteerTick;
	else
		this.lastSteerTick = obj.tick;

	this.lastSteerTurn = turn;
	this.player.inputs.push(obj);
	game.sendMsg('input', obj);
}

/* Audio manager */
function AudioController() {
	this.sounds = [];
}

AudioController.prototype.addSound = function(name, file, formats) {	
	if(this.sounds[name] == undefined)
		this.sounds[name] = [];

	this.sounds[name].push(new buzz.sound(file, {'formats': formats}));
}

AudioController.prototype.playSound = function(name) {
	if(!enableSound || typeof this.sounds[name] != 'object')
		return;

	this.sounds[name][Math.floor(Math.random() * this.sounds[name].length)].play();
}

/* Pencil
 * properties:
 * - pencilMode: on, off or ondeath
 */
function Pencil(game) {
	this.game = game;
	this.inkDiv = document.getElementById('ink');
	this.indicator = document.getElementById('inkIndicator');
}

/* pos is scaled location */
Pencil.prototype.startDraw = function(pos) {
	this.ink -= this.mousedownInk;
	this.curX = this.x = pos.x;
	this.curY = this.y = pos.y;
	this.outbuffer.push(1);
	this.outbuffer.push(this.x);
	this.outbuffer.push(this.y);
	this.outbuffer.push(this.game.tick);
	this.down = true;
}

Pencil.prototype.enable = function(tick) {
	this.indicator.style.display = 'block';
	this.drawingAllowed = true;
	this.setInk(this.startInk + this.inkPerSec / 1000 * this.game.tickLength * (this.game.tick - tick));
}

Pencil.prototype.reset = function() {
	this.outbuffer = [];
	this.down = false;
	this.upped = false;
	this.drawingAllowed = false;
	this.indicator.style.display = 'none';

	for(var i in this.game.players) {
		var player = this.game.players[i];
		player.inbuffer = [];
		player.inbufferIndex = 0;
	}
}

Pencil.prototype.setInk = function(ink) {
	this.ink = Math.min(this.maxInk, ink);
	this.inkDiv.style.height = ( 100 * Math.max(0, this.ink) / this.maxInk ) + '%';
}

Pencil.prototype.doTick = function() {
	if(this.drawingAllowed)
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

			this.drawSegment(this.game.backupContext, this.x, this.y, x, y, this.game.localPlayer, pencilAlpha);
			this.drawSegment(this.game.baseContext, this.x, this.y, x, y, this.game.localPlayer, pencilAlpha);

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
	for(var i in this.game.players) {
		var player = this.game.players[i];
		
		if(player.status == 'ready')
			return;
		
		var buffer = player.inbuffer;
		
		for(var index = redraw ? 0 : player.inbufferIndex; index < buffer.length; index++) {
			var seg = buffer[index];
			var solid = seg.tickSolid <= this.game.tick;
			if(!solid && !redraw)
				break;

			if(!redraw)
				this.drawSegment(this.game.baseContext, seg.x1, seg.y1,
				 seg.x2, seg.y2, player, solid ? 1 : pencilAlpha);

			this.drawSegment(this.game.backupContext, seg.x1, seg.y1,
			 seg.x2, seg.y2, player, solid ? 1 : pencilAlpha);
		}
		
		if(!redraw)
			player.inbufferIndex = index;
	}
}

Pencil.prototype.drawSegment = function(ctx, x1, y1, x2, y2, player, alpha) {
	if(x1 == x2 && y1 == y2)
		return;

	ctx.beginPath();
	setLineColor(ctx, player.color, alpha);
	var tmp = ctx.lineCap;
	ctx.lineCap = alpha == 1 ? lineCapStyle : 'butt';
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.lineCap = tmp;
}

Pencil.prototype.handleMessage = function(msg, player) {
	var lastTick = -1;
	
	while(msg.at < msg.data.length) {
		var pos = msg.readPos();
		var pen = msg.readPencil();
		
		if(!pen.down) {
			var tick;
			
			if(lastTick == -1) {
				msg.at--;
				pen = msg.readPencilFull();
				tick = pen.tick;
			} else {
				tick = lastTick + pen.tickDifference;
			}
			
			var seg = {x1: player.pencilX, y1: player.pencilY, x2: pos.x, y2: pos.y, tickSolid: tick};
			if(player != this.game.localPlayer) {
				this.drawSegment(this.game.baseContext, seg.x1, seg.y1, seg.x2, seg.y2, player, pencilAlpha);
				this.drawSegment(this.game.backupContext, seg.x1, seg.y1, seg.x2, seg.y2, player, pencilAlpha);
			}

			player.inbuffer.push(seg);
			lastTick = tick;
		}
		
		player.pencilX = pos.x;
		player.pencilY = pos.y;
	}
}

/* Byte Message */
function ByteMessage(data, at) {
	this.data = data;
	this.at = at;
}

ByteMessage.prototype.readPos = function() {
	var x, y;
	var a = this.data.charCodeAt(this.at++);
	var b = this.data.charCodeAt(this.at++);
	var c = this.data.charCodeAt(this.at++);
	
	x = a | (b & 15) << 7;
	y = b >> 4 | c << 3;
	
	return {x: x, y: y};
}

ByteMessage.prototype.readPencil = function() {
	var a = this.data.charCodeAt(this.at++);
	
	return {down: a & 1, tickDifference: a >> 1};
}

ByteMessage.prototype.readPencilFull = function() {
	var a = this.data.charCodeAt(this.at++);
	var b = this.data.charCodeAt(this.at++);
	var c = this.data.charCodeAt(this.at++);
	
	return {down: a & 1, tick: a >> 1 | b << 6 | c << 13};
}


/* Map editor */
Editor = function(game) {
	this.game = game;
	this.mouse = {down: false, out: true};
	this.canvas = document.getElementById('editorCanvas');
	this.context = this.canvas.getContext('2d');
	this.container = document.getElementById('editor');
	this.pos = [0, 0];
	this.segments = [];
	this.canvas.width = this.canvas.height = 0;
	this.mode = 'pencil';
	var self = this;

	/* modal stuff */
	this.textField = document.getElementById('editorTextField');
	this.modal = document.getElementById('mapLoader');
	this.overlay = document.getElementById('overlay');
	this.modalHeader = document.getElementById('modalHeader');
	this.modalButton = document.getElementById('modalOk');
	
	/********* add event listeners *********/
	this.canvas.addEventListener('mousedown', function(ev) { self.handleInput('down', ev, self.mouse); }, false);
	this.canvas.addEventListener('mousemove', function(ev) { self.handleInput('move', ev, self.mouse); }, false);
	window.addEventListener('mouseup', function(ev) { self.handleInput('up', ev, self.mouse); }, false);
	this.canvas.addEventListener('mouseout', function(ev) { self.handleInput('out', ev, self.mouse); }, false);
	this.canvas.addEventListener('mouseover', function(ev) { self.handleInput('over', ev, self.mouse); }, false);

	this.resetButton = document.getElementById('editorReset');
	this.resetButton.addEventListener('click', function() { 
		self.segments = [];
		self.mapChanged = true;
		self.resize();	
	}, false);

	var copy = document.getElementById('editorCopy');
	copy.addEventListener('click', function() {
		self.modalHeader.innerHTML = 'Store map';
		self.overlay.style.display = 'block';
		self.modal.style.display = 'block';
		self.modalButton.innerHTML = 'Done';
		self.copy();
	}, false);

	var load = document.getElementById('editorLoad');
	load.addEventListener('click', function() {
		self.modalHeader.innerHTML = 'Load map';
		self.overlay.style.display = 'block';
		self.modal.style.display = 'block';
		self.modalButton.innerHTML = 'Load Map';
	}, false);

	function closeModal() {
		self.overlay.style.display = 'none';
		self.modal.style.display = 'none';
	}

	this.modalButton.addEventListener('click', function() {
		if(self.modalButton.innerHTML == 'Load Map')
			self.load(self.textField.value);

		closeModal();
	});

	this.overlay.addEventListener('click', closeModal);
	document.getElementById('modalClose').addEventListener('click', closeModal);

	var undo = document.getElementById('editorUndo');
	undo.addEventListener('click', function() { self.undo(); }, false);

	var start = document.getElementById('editorStart');
	start.addEventListener('click', function() {
		self.game.setGameState('editing');
		self.pos = findPos(self.canvas);
		self.resize();
		self.interval = window.setInterval(function() { self.handleInput('move', null, self.mouse); }, editorStepTime);
		if(self.game.noMapSent && self.segments.length > 0) {
			self.game.noMapSent = false;
			self.mapChanged = true;
		}
		window.scroll(document.body.offsetWidth, 0);
	}, false);

	var done = document.getElementById('editorDone');
	done.addEventListener('click', function() {
		self.game.setGameState('waiting'); 
		window.clearInterval(self.interval);
		// freeing memory - is this the right way?
		self.canvas.height = self.canvas.width = 0;
	}, false);

	function activate(node) {
		var siblings = node.parentNode.getElementsByTagName('a');

		for(var i = 0; i < siblings.length; i++)
			siblings[i].className = 'btn';

		node.className = 'btn active';
	}
	
	this.pencilButton = document.getElementById('editorPencil');
	this.eraserButton = document.getElementById('editorEraser');
	this.playerStartButton = document.getElementById('editorPlayerStart');
	this.teleportButton = document.getElementById('editorTeleport');
	
	this.pencilButton.mode = 'pencil';
	this.eraserButton.mode = 'eraser';
	this.playerStartButton.mode = 'playerStart';
	this.teleportButton.mode = 'teleport';
	
	var click = function(e) {
		activate(e.target);
		self.mode = e.target.mode;
	};
	
	this.pencilButton.className = 'btn active';
	this.pencilButton.addEventListener('click', click, false);
	this.eraserButton.addEventListener('click', click, false);
	this.playerStartButton.addEventListener('click', click, false);
	this.teleportButton.addEventListener('click', click, false);
	
	/********* touch *********/
	function getTouchEvent(type) {
		return function(e) {
			for(var i = 0; i < e.changedTouches.length; i++) {
				var t = e.changedTouches[i];
				self.handleInput(type, t, t);
			}
			e.preventDefault();
		};
	}
	
	this.canvas.addEventListener('touchstart', getTouchEvent('down'), false);
	this.canvas.addEventListener('touchmove', getTouchEvent('move'), false);
	this.canvas.addEventListener('touchend', getTouchEvent('up'), false);
	this.canvas.addEventListener('touchcancel', getTouchEvent('up'), false);
}

Editor.prototype.handleInput = function(type, ev,  state) {
	var stepTime = this.mode == 'eraser' ? eraserStepTime : editorStepTime;
	var setStart = false;
	var doAction = false;
	
	if(ev != undefined) {
		state.pos = this.game.getGamePos(ev);
		if(ev.preventDefault)
			ev.preventDefault();
	}
	
	switch(type) {
		case 'down':
			state.down = true;
			state.out = false;
			setStart = true;
			break;
		case 'over':
			state.out = false;
			if(state.down && this.inMode('eraser', 'pencil'))
				setStart = true;
			break;
		case 'up':
			if(state.down && !state.out)
				doAction = true;
			state.down = false;
			break;
		case 'out':
			state.out = true;
			if(state.down && this.inMode('eraser', 'pencil'))
				doAction = true;
			break;
		case 'move':
			if(state.down && this.inMode('eraser', 'pencil') && Date.now() - state.startTime > stepTime)
				doAction = true;
			break;
	}
		
	if(doAction) {
		
	 	if(state.pos.x != state.start.x || state.pos.y != state.start.y) {
			var seg = new BasicSegment(state.start.x, state.start.y, state.pos.x, state.pos.y);
			
			switch(this.mode) {
				case 'playerStart':
					seg.playerStart = true;
					seg.angle = getAngle(seg.x2 - seg.x1, seg.y2 - seg.y1);
					seg.x2 = seg.x1 + Math.cos(seg.angle) * (indicatorLength + 2 * indicatorArrowLength);
					seg.y2 = seg.y1 + Math.sin(seg.angle) * (indicatorLength + 2 * indicatorArrowLength);
					break;
				case 'teleport':
					//TODO: some visual feedback for these return statements
					if(getLength(seg.x2 - seg.x1, seg.y2 - seg.y1) < minTeleportSize)
						return;
					seg.teleportId = this.getNextTeleportId();
					if(seg.teleportId == -1)
						return;
					seg.color = playerColors[seg.teleportId];
					break;
				case 'eraser':
					var changed = false;
					for(var i = 0; i < this.segments.length; i++) {
						if(segmentCollision(this.segments[i], seg) != -1) {
							this.segments.splice(i--, 1);
							changed = true;
							this.mapChanged = true;
						}
					}
					if(changed)
						this.resize();
					break;
			}
			
			if(!this.inMode('eraser')) {
				this.segments.push(seg);
				this.mapChanged = true;
				this.drawSegment(seg);
			}
			
			setStart = true;
		}
	}
	
	if(setStart) {
		state.start = state.pos;
		state.startTime = Date.now();
	}
}

Editor.prototype.getNextTeleportId = function () {
	var ar = new Array(maxTeleports);
	for(var i = 0; i < maxTeleports; i++)
		ar[i] = 0;
	for(var i in this.segments) {
		var seg = this.segments[i];
		if(seg.teleportId != undefined)
			ar[seg.teleportId]++;
	}
	var id = -1;
	for(var i = 0; i < maxTeleports; i++) {
		if(ar[i] == 1)
			return i;
		else if(ar[i] == 0 && id == -1)
			id = i;
	}
	return id;
}

Editor.prototype.inMode = function() {
	for(var i in arguments)
		if(this.mode == arguments[i])
			return true;
	return false;
}

Editor.prototype.drawSegment = function(seg) {
	if(seg.x1 == seg.x2 && seg.y1 == seg.y2)
		return;
	if(seg.playerStart != undefined) {
		drawIndicatorArrow(this.context, seg.x1, seg.y1, seg.angle, playerColors[0]);
		setLineColor(this.context, mapSegmentColor, 1);
	} else if(seg.teleportId != undefined) {
		drawTeleport(this.context, seg);
		setLineColor(this.context, mapSegmentColor, 1);
	} else {
		this.context.beginPath();
		this.context.moveTo(seg.x1, seg.y1);
		this.context.lineTo(seg.x2, seg.y2);
		this.context.stroke();
	}
}

Editor.prototype.copy = function() {
	this.textField.value = JSON.stringify(this.segments);
}

Editor.prototype.load = function(str) {
	try {
		var segs = JSON.parse(str);
	}
	catch(ex) {
		this.game.gameMessage('JSON parse exception!');
	}

	/* FIXME: hier moet nog iets meer checks op segs komen
	 * het kan nu van alles zijn en dan krijg je later js errors */	

	this.segments = segs;
	this.resize();
	this.mapChanged = true;
}

Editor.prototype.undo = function() {
	if(this.segments.length > 0) {
		this.segments.pop();
		this.resize();
	}
}

Editor.prototype.resize = function() {
	var game = this.game;
	game.calcScale(this.resetButton.offsetHeight + 10);
	var w = Math.round(game.scale * game.width);
	var h = Math.round(game.scale * game.height);
	var sizeChanged = w != this.canvas.width;
	this.canvas.width = w;
	this.canvas.height = h;
	this.context.scale(game.scale, game.scale);
	this.context.lineWidth = 3;
	setLineColor(this.context, mapSegmentColor, 1);
	this.context.lineCap = 'round';
	
	for(var i = 0; i < this.segments.length; i++)
		this.drawSegment(this.segments[i]);
		
	// stop drawing
	if(sizeChanged) {
		this.mouse.down = false;
	}
}

BasicSegment = function(x1, y1, x2, y2) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
}

/* create game */
window.onload = function() {
	var game = new GameEngine();
	var localPlayer = game.localPlayer;
	var audioController = game.audioController;

	/* add sounds to controller */
	//audioController.addSound('localDeath', 'sounds/wilhelm', ['ogg', 'mp3']);
	//audioController.addSound('localDeath', 'sounds/loser', ['ogg', 'mp3']);
	audioController.addSound('countdown', 'sounds/countdown', ['ogg', 'mp3']);
	audioController.addSound('playerLeft', 'sounds/doorclose', ['ogg', 'mp3']);
	audioController.addSound('newPlayer', 'sounds/playerjoint', ['ogg', 'wav']);
	audioController.addSound('gameStart', 'sounds/whip', ['ogg', 'mp3']);
	audioController.addSound('localWin', 'sounds/winner', ['ogg', 'mp3']);
	audioController.addSound('chat', 'sounds/beep', ['ogg', 'mp3']);

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

	function connect() {
		var playerName = document.getElementById('playername').value;

		game.showSidebar();

		if(typeof playerName != 'string' || playerName.length < 1 || playerName.length > maxNameLength) {
			game.gameMessage('Enter a cool nickname please (no longer than ' + maxNameLength + ' chars)');
			return;
		}

		setCookie('playerName', localPlayer.playerName = playerName, 30);

		game.connect(serverURL, 'game-protocol', function() {
			game.joinLobby(localPlayer);
		});
		game.connectButton.disabled = true;
		game.connectButton.innerHTML = 'Connecting...';
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
		
		game.requestGame(localPlayer, minPlayers, maxPlayers);
	}

	game.connectButton = document.getElementById('connect');
	game.connectButton.addEventListener('click', connect, false);

	game.automatchButton = document.getElementById('automatch');
	game.automatchButton.addEventListener('click', reqGame, false);
	
	game.createButton = document.getElementById('createGame');
	game.createButton.addEventListener('click', function() { game.createGame(); }, false);

	game.leaveButton = document.getElementById('stop');
	game.leaveButton.addEventListener('click', function() {
		game.leaveGame();
	}, false);

	game.disconnectButton = document.getElementById('disconnect');
	game.disconnectButton.addEventListener('click', function() {
		game.websocket.close(1000);
	}, false);
	
	game.backButton = document.getElementById('back');
	game.backButton.addEventListener('click', function() {
		game.setGameState('waiting');
		game.backToGameLobby();
	}, false);
	
	game.startButton = document.getElementById('startGame');
	game.startButton.addEventListener('click', function() { game.sendStartGame(); }, false);
	
	game.hostContainer = document.getElementById('hostContainer');
	game.nonhostContainer = document.getElementById('nonhostContainer');

	game.addComputerButton = document.getElementById('addComputer');
	game.addComputerButton.addEventListener('click', function() {
		game.addComputer();
	}, false);

	var minPlayers = getCookie('minPlayers');
	if(minPlayers != null)
		document.getElementById('minplayers').value = minPlayers;
	var maxPlayers = getCookie('maxPlayers');
	if(maxPlayers != null)
		document.getElementById('maxplayers').value = maxPlayers;
	var playerName = getCookie('playerName');
	
	// for debug purposes
	if(window.location.href.indexOf('C:/Dropbox') != -1) {
		playerName = 'piet';
		document.getElementById('minplayers').value = '1';
		enableSound = false;
	}
		
	/* auto connect if name is known */
	if(playerName != null && playerName != '') {
		document.getElementById('playername').value = playerName;
		connect();
	}
	
	window.onresize = function() {
		this.clearTimeout(this.resizeTimeout);
		this.resizeTimeout = this.setTimeout(function() { 
			if(game.state == 'editing')
				game.editor.resize();
			else if (game.state == 'playing' || game.state == 'watching' || 
			 game.state == 'ended' || game.state == 'countdown')
				game.resize();
		}, resizeDelay);

		resizeChat();
	}

	/* moving sidebar for horizontal scroll */
	window.onscroll = function() {
		game.sidebar.style.left = -window.scrollX + 'px';
	}

	/* way to see sidebar for touch screens */
	if(touchDevice || alwaysHideSidebar) {
		var button = document.getElementById('menuButton');
		button.style.display = 'block';
		button.addEventListener('click', function(e) {
			game.toggleSidebar();
			e.preventDefault();
			e.stopPropagation();
		}, true);
	}

	function sendParams(timeout, onlyAllowReplacement) {
		return function() {
			if(game.host != game.localPlayer || game.state != 'waiting')
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

			game.startButton.disabled = true;
			game.startButton.innerHTML = 'Please wait';

			if(game.unlockTimeout !== null)
				window.clearTimeout(game.unlockTimeout);

			game.unlockTimeout = window.setTimeout(function() {
				game.unlockStart();
			}, unlockInterval + timeout);
		}
	}
	
	// for debug purposes
	echo = function(msg) { game.gameMessage(msg); };
	engine = game;

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
	ctx.strokeStyle = 'rgba(' + color[0] + ', ' + color[1] + ', '
	 + color[2] + ', ' + alpha + ')';
}

/* cookies */
function setCookie(c_name, value, exdays) {
	var exdate = new Date();
	exdate.setDate(exdate.getDate() + exdays);
	var c_value = escape(value) + ((exdays==null) ? '' : '; expires='+exdate.toUTCString());
	document.cookie = c_name + '=' + c_value;
}

function getCookie(c_name) {
	var i, x, y, ARRcookies=document.cookie.split(';');
	for (i = 0; i < ARRcookies.length; i++) {
		x = ARRcookies[i].substr(0,ARRcookies[i].indexOf('='));
		y = ARRcookies[i].substr(ARRcookies[i].indexOf('=')+1);
		x = x.replace(/^\s+|\s+$/g,'');
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
	return {x: curleft, y: curtop};
}

function escapeString(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getPos(e) {
	var posx = 0;
	var posy = 0;

	if (!e)
		e = window.event;

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

	return {x: posx, y: posy};
}

function getRGBstring(color) {
	return 'rgb(' + color[0] + ', ' + color[1] + ', '
		 + color[2] + ')';
}

function getRGBAstring(color, alpha) {
	return 'rgba(' + color[0] + ', ' + color[1] + ', '
		 + color[2] + ', ' + alpha + ')';
}

function segmentCollision(a, b) {
	if(a.x2 == b.x1 && a.y2 == b.y1)
		return -1;
	
	var denominator = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
	
	if(Math.abs(denominator) < epsilon)
		return -1;
		
	var numeratorA = (b.x2 - b.x1) * (a.y1 - b.y1) - (b.y2 - b.y1) * (a.x1 - b.x1);
	var t = numeratorA / denominator;
	
	if(t < 0 || t > 1)
		return -1;
	
	var numeratorB = (a.x2 - a.x1) * (a.y1 - b.y1) - (a.y2 - a.y1) * (a.x1 - b.x1);
	var s = numeratorB / denominator;
	
	return (s >= 0 && s <= 1) ? s : -1;
}

function drawIndicatorArrow(ctx, x, y, angle, color) {
	setLineColor(ctx, color, 1);
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x += Math.cos(angle) * indicatorLength, y += Math.sin(angle) * indicatorLength);
	ctx.stroke();

	ctx.fillStyle = getRGBstring(color);
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

function drawTeleport(ctx, seg) {
	setLineColor(ctx, seg.color, 1);
	ctx.lineWidth = teleportLineWidth;
	var dx = seg.x2 - seg.x1;
	var dy = seg.y2 - seg.y1;
	var len = getLength(dx, dy);
	var dashLength = 5;
	var dashSpacing = 5;
	dx /= len;
	dy /= len;
	var dashes = Math.max(2, Math.round((len + dashSpacing) / (dashLength + dashSpacing)));
	dashSpacing = (len + dashSpacing) / dashes - dashLength;
	
	ctx.beginPath();
	var x = seg.x1;
	var y = seg.y1;
	for(var i = 0; i < dashes; i++) {
		ctx.moveTo(x, y);
		ctx.lineTo(x += dx * dashLength, y += dy * dashLength);
		x += dx * dashSpacing;
		y += dy * dashSpacing;
	}
	ctx.stroke();
	ctx.lineWidth = lineWidth;
}

function getAngle(x, y) {
	if(x == 0)
		return y < 0 ? Math.PI * 3 / 2 : Math.PI / 2;
	return Math.atan(y / x) + (x > 0 ? 0 : Math.PI);
}

function rotateVector(x, y, angle) {
	var a = Math.cos(angle) * x - Math.sin(angle) * y;
	var b = Math.sin(angle) * x + Math.cos(angle) * y;
	return {x: a, y: b};
}

function printDebugPos() {
	var s = '';
	for(var i = 0; i < debugPosA.length; i++) {
		s += debugPosA[i] + '<br />' + debugPosB[i] + '<br />' + '<br />';
	}
	echo(s);
}

function format(s, len) {
	return (s  +  '0000000000000000000000000000').substr(0, len);
}

function simulateClick(element) {
	var evt = document.createEvent("MouseEvents");
	evt.initMouseEvent("click", true, true, window, 
		0, 0, 0, 0, 0, false, false, false, false, 0, null);
	element.dispatchEvent(evt);
}
