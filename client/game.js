/* game engine */
function GameEngine(containerId, playerListId) {
	// game variables
	this.players = [];
	this.idToPlayer = []; // maps playerId to index of this.players
	this.gameStartTimestamp = null;
	this.tick = 0;
	this.tock = 0; // seperate tick for the other clients
	this.behind = behind;
	this.gameOver = true;
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
	this.containerId = containerId; // id of DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments

	// player list related
	this.localPlayerId = null;
	this.playerList = document.getElementById(playerListId).lastChild;
}

/* a lot of values we do not clear, but we do not care for them as they 
 * will get overwritten as soon as new game starts */
GameEngine.prototype.reset = function() {
	//var localPlayer = this.players[0];
	this.players = [];
	//this.players.push(localPlayer);
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
			game.gameOver = true;
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
			this.idToPlayer[obj.playerId] = 0;
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
			debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
			break;
		case 'startGame':
			this.start(obj.startPositions, obj.startTime);
			break;
		case 'newInput':
			this.players[this.idToPlayer[obj.playerId]].steer(obj);
			break;
		case 'adjustGameTime':
			debugLog('adjusted game time by ' + obj.forward + ' msec');
			this.gameStartTimestamp -= obj.forward;
			this.adjustGameTimeMessagesReceived++;
			this.displayDebugStatus();
			break;
		case 'playerLeft':
			var index = this.idToPlayer[obj.playerId];
			this.splicePlayerList(index);
			debugLog(this.players[index].playerName + " left the game");

			if(this.gameOver) {
				for(var i = index + 1; i < this.players.length; i++)
					this.idToPlayer[this.players[i].playerId] = i - 1;

				this.players.splice(index, 1);
			}
			else
				this.players[index].alive = false;

			break;
		case 'playerDied':
			var index = this.idToPlayer[obj.playerId];
			this.players[index].alive = false;
			this.updatePlayerList(index, 'dead');
			debugLog(this.players[this.idToPlayer[obj.playerId]].playerName +
			 " died");
			break;
		case 'endGame':
			var winner = (obj.winnerId != -1)
			 ? (this.players[this.idToPlayer[obj.winnerId]].playerName + ' won')
			 : 'draw';
			this.gameOver = true;
			debugLog('game over. ' + winner);
			break;
		case 'time':
			this.handleSyncResponse(obj.time);
			break;
		case 'segments':
			this.handleSegmentsMessage(obj.segments);
			break;
		default:
			debugLog('unknown mode!');
	}
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

	var ping = (Date.now() - this.syncSendTime) / 2;
	if(ping < this.bestSyncPing) {
		this.bestSyncPing = ping;
		this.serverTimeDifference = Date.now() - (serverTime + ping);
	}

	if(ping > this.worstSyncPing) {
		this.ping += this.worstSyncPing / (syncTries - 1);
		this.worstSyncPing = ping;
	}else
		this.ping += ping / (syncTries - 1);

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
	container.style.width = (this.width = obj.w) + 'px';
	container.style.height = (this.height = obj.h) + 'px';

	/* Set game variables */
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;
	this.holeSize = obj.hsize;
	this.holeFreq = obj.hfreq;

	debugLog("this game is for " + obj.nmin + " to " + obj.nmax + " players");
}	

GameEngine.prototype.requestGame = function(player, minPlayers, maxPlayers) {
	if(!this.gameOver)
		return;

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
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++) {
		var player = this.players[i];
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
		this.idToPlayer[player.playerId] = index;
	else
		player.playerId = this.localPlayerId;

	this.players.push(player);
	this.appendPlayerList(index);
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime + this.serverTimeDifference - this.ping;
	this.gameOver = false;
	var delay = this.gameStartTimestamp - Date.now();
	
	this.playerListStart();
	debugLog("starting game in " + delay + " milliseconds");

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.containerId, canvasBgcolor);

	/* create background context */
	var canvas = document.getElementById(this.canvasStack.getBackgroundCanvasId());
	this.baseContext = canvas.getContext('2d');
	this.baseContext.fillStyle = '#000';
	this.baseContext.lineWidth = lineWidth;
	this.baseContext.lineCap = lineCapStyle;

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.idToPlayer[startPositions[i].playerId];
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle,
		 startPositions[i].holeStart);
	}

	/* create segment canvas */
	canvas = document.getElementById(this.canvasStack.createLayer());
	this.segctx = canvas.getContext('2d');
	this.segctx.lineWidth = 1;
	this.segctx.strokeStyle = 'black';
	this.segctx.lineCap = lineCapStyle;
	
	var self = this;
	window.setTimeout(function() { self.realStart(); }, delay + simStep);
}

GameEngine.prototype.realStart = function() {
	/* clear angle indicators from base layer */
	this.baseContext.clearRect(0, 0, this.width, this.height);

	var self = this;
	var gameloop = function() {
		while(self.tick - self.tock >= self.behind)
			self.doTock();
		self.doTick();
		
		if(!self.gameOver)
			window.setTimeout(gameloop, Math.max(0,
			 (self.tick + 1) * simStep - (Date.now() - self.gameStartTimestamp)));
	}

	// yo ik heb de delay van simstep opgeteld bij de delay van t aanroepen
	// van realStart, dan blijven de angle indicators nog een tick langer zichtbaar
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
	if(obj.tick >= localTick || (this.isLocal && obj.modified == undefined)) {
		if(this.isLocal && obj.modified != undefined)
			debugLog("server is playing with you! now you are out of sync");
		this.baseQueue.unshift(obj);
		if(!this.isLocal) { 
			if(this.lastSteerTick == obj.tick)
				this.inputQueue[0] = obj;
			else{
				this.inputQueue.unshift(obj);
				this.lastSteerTick = obj.tick;
			}
			this.game.redrawsPossible++;
			this.game.displayDebugStatus();
		}
		return;
	}
	
	var currentTurn = this.turn;
	
	if(this.isLocal && obj.modified != undefined) {
		this.game.modifiedInputs ++;
		this.game.displayDebugStatus();
	}
	
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

		// removing old inputs from queue (can this be merged with the logic at
		// beginning of method?) doesn't look like it
		for(i = queue.length - 1; i >= 0; i--)
			if(queue[i].tick > startTick) {
				queue.length = i + 1;
				break;
			}
	}
	
	this.simulate(obj.tick, localTick, this.context, this.isLocal ? this.inputQueue : null);
	if(this.isLocal)
		this.turn = currentTurn;
}

Player.prototype.simulate = function(startTick, endTick, ctx, queue) {
	if(startTick == endTick)
		return;

	var inHole = (startTick > this.holeStart && (startTick + this.holeStart)
	 % (this.holeSize + this.holeFreq) < this.holeSize);

	ctx.beginPath();
	setLineColor(ctx, this.color, inHole ? gapAlpha : 1);
	ctx.moveTo(this.x, this.y);
	
	var i, input;
	if(queue != null) {
		// now not removing inputs, doing this in steer
		// also set input and i
		for(i = queue.length - 1; i >= 0 && queue[i].tick > startTick; i--);
		input = queue[i];
	}else
		input = null;
	
	for(var tick = startTick; tick < endTick; tick++) {
		if(inHole !== (tick > this.holeStart && (tick + this.holeStart)
		 % (this.holeSize + this.holeFreq) < this.holeSize)) {
			ctx.stroke();
			return this.simulate(tick, endTick, ctx, queue);
		}

		if(input != null && input.tick == tick) {
			this.turn = input.turn;
			if(--i >= 0)
				input = queue[i];
			else
				input = null;
		}
		this.angle += this.turn * this.turnSpeed * simStep/ 1000;
		this.x += this.velocity * simStep/ 1000 * Math.cos(this.angle);
		this.y += this.velocity * simStep/ 1000 * Math.sin(this.angle);
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
function InputController(left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = null;
	this.game = null;
	this.lastSteerTick = -1;
}

InputController.prototype.setPlayer = function(player) {
	this.player = player;
}

InputController.prototype.setGame = function(game) {
	this.game = game;
}

InputController.prototype.keyDown = function(keyCode) {
	if(this.game.gameOver || !this.player.alive)
		return;

	if(keyCode == this.rightKeyCode && this.player.turn != -1) 
		this.steerLocal(-1);
	
	else if(keyCode == this.leftKeyCode && this.player.turn != 1)
		this.steerLocal(1);
}

InputController.prototype.keyUp = function(keyCode) {
	if(this.game.gameOver || !this.player.alive)
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) 
		this.steerLocal(0);
}

InputController.prototype.steerLocal = function(turn) {
	this.player.turn = turn;
	var obj = {'turn': turn, 'tick': game.tick};
	if(this.lastSteerTick == this.game.tick)
		this.player.inputQueue[0] = obj;
	else{
		this.player.inputQueue.unshift(obj);
		this.lastSteerTick = this.game.tick;
	}
	this.game.sendMsg('newInput', obj);
}

/* create game */
window.onload = function() {

	/* some constants */
	game = new GameEngine('canvasContainer', 'playerList');
	var player = new Player(playerColors[0], true);
	var inputControl = new InputController(keyCodeLeft, keyCodeRight);
	
	inputControl.setGame(game);
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
	}, false);
	
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
function setCookie(c_name,value,exdays) {
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

/* debugging */
function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}
