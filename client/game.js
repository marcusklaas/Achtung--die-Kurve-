/* game engine */
function GameEngine(containerId) {
	debugLog("creating game");

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

	// connection state
	this.websocket = null;
	this.connected = false;
	this.syncTries = 0;

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
			if(onConnect != null){
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
			this.players[0].playerId = obj.playerId;
			this.idToPlayer[obj.playerId] = 0;
			break;
		case 'joinedGame':
			debugLog('you joined a game.');
			break;
		case 'gameParameters':
			this.setParams(obj);
			debugLog('received game params.');
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
			this.gameStartTimestamp += obj.forward;
			this.adjustGameTimeMessagesReceived++;
			this.displayDebugStatus();
			break;
		case 'playerLeft':
			var index = this.idToPlayer[obj.playerId];
			debugLog(this.players[index].playerName + " left game");

			if(this.gameOver) {
				for(var i = index + 1; i < this.players.length; i++)
					this.idToPlayer[this.players[i].playerId] = i - 1;

				this.players.splice(index, 1);
			}
			else
				this.players[index].alive = false;

			break;
		case 'playerDied':
			this.players[this.idToPlayer[obj.playerId]].alive = false;
			debugLog(this.players[this.idToPlayer[obj.playerId]].playerName +
			 " died");
			break;
		case 'endGame':
			var winner = (obj.winnerId != -1)
			 ? (this.players[this.idToPlayer[obj.winnerId]].playerName + ' won')
			 : 'draw!';
			this.gameOver = true;
			debugLog('game ended. ' + winner);
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
	for(var i = 0; i < segments.length; i++){
		var s = segments[i];
		this.segctx.moveTo(s.x1, s.y1);
		this.segctx.lineTo(s.x2, s.y2);
	}
	this.segctx.stroke();
}

GameEngine.prototype.handleSyncResponse = function(serverTime) {
	if(this.syncTries == 0){
		this.ping = 0;
		this.bestSyncPing = 9999;
		this.worstSyncPing = 0;
	}
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
	else{
		debugLog('synced with server with a maximum error of ' + this.bestSyncPing
		 + ' msec' + ', and average ping of ' + this.ping + ' msec');
		this.syncTries = 0;
	}
}

GameEngine.prototype.getServerTime = function() {
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

GameEngine.prototype.syncWithServer = function() {
	this.syncSendTime = Date.now();
	this.sendMsg('getTime', {});
}

GameEngine.prototype.doTick = function() {
	var player = this.players[0];
	player.simulate(this.tick, ++this.tick, player.context, null);
}

GameEngine.prototype.doTock = function() {
	for(var i = 1; i < this.players.length; i++){
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

	/* internet player */
	if(player.playerId != null)
		this.idToPlayer[player.playerId] = this.players.length;

	this.players.push(player);
	debugLog("adding player to game");
}

GameEngine.prototype.start = function(startPositions, startTime) {
	this.gameStartTimestamp = startTime - this.getServerTime() - this.ping + Date.now();
	this.gameOver = false;
	var delay = this.gameStartTimestamp - Date.now();
	
	debugLog("starting game in " + delay);

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
		 startPositions[i].startY, startPositions[i].startAngle);
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
			 self.tick * simStep - (Date.now() - self.gameStartTimestamp)));
	}
	gameloop();
}

GameEngine.prototype.displayDebugStatus = function(){
	document.getElementById('status').innerHTML = 
	 'redraws: ' + this.redraws + ' / ' + this.redrawsPossible +
	 ', modified inputs: ' + this.modifiedInputs +
	 ', game time adjustments: ' + this.adjustGameTimeMessagesReceived;
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
	this.alive = false;
	this.inputQueue = [];
	this.baseQueue = [];

	debugLog("creating player");
}

Player.prototype.steer = function(obj) {
	var localTick = this.isLocal ? this.game.tick : this.game.tock;
	if(obj.tick >= localTick || (this.isLocal && !obj.hasOwnProperty('modified'))){
		//this.inputQueue.unshift(obj);
		this.baseQueue.unshift(obj);
		if(!this.isLocal){
		
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
	
	if(this.isLocal && obj.hasOwnProperty('modified')){
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
	this.lcx = this.x;
	this.lcy = this.y;
	this.lca = this.angle;
	this.lcturn = this.turn = obj.turn;	
	this.lctick = obj.tick;
	this.baseQueue = [];
	/*var redraw = true;
	if(this.isLocal && Math.abs(this.x - obj.x) < maxPositionError
	 && Math.abs(this.y - obj.y) < maxPositionError
	 && Math.abs(this.angle - obj.angle) < maxAngleError)
		redraw = false;*/
		 
	/* here we sync with server 
	this.lcx = this.x = obj.x;
	this.lcy = this.y = obj.y;
	this.lca = this.angle = obj.angle;
	this.lcturn = this.turn = obj.turn;	
	*/

	/* clear this players canvas and run extrapolation on this player's
	 * context from timestamp in object to NOW */
	//if(localTick - obj.tick > 0 && redraw)
	this.context.clearRect(0, 0, this.game.width, this.game.height);
	if(!this.isLocal){
		this.game.redraws++;
		this.game.redrawsPossible++;
		this.game.displayDebugStatus();
	}
	
	this.simulate(obj.tick, localTick, this.context, this.isLocal ? this.inputQueue : null);
}

Player.prototype.simulate = function(startTick, endTick, ctx, queue) {
	ctx.beginPath();
	ctx.strokeStyle = this.color;
	ctx.moveTo(this.x, this.y);
	
	var i, input;
	if(queue!=null){
		// remove inputs from before startTick
		// we assume this is what we want
		// also set input and i
		for(i = queue.length - 1; i >= 0; i--)
			if(queue[i].tick > startTick){
				queue.length = i + 1;
				break;
			}
		input = queue[i];
	}else
		input = null;
	
	for(var tick=startTick;tick<endTick;tick++) {
		if(input != null && input.tick == tick){
			this.turn = input.turn;
			if(--i >= 0)
				input = queue[i];
			else
				input = null;
		}
		this.angle += this.turn * this.turnSpeed * simStep/ 1000;
		this.x += this.velocity * simStep/ 1000 * Math.cos(this.angle);
		this.y += this.velocity * simStep/ 1000 * Math.sin(this.angle);
		if(ctx != null)
			ctx.lineTo(this.x, this.y);
	}

	ctx.stroke();
}

Player.prototype.initialise = function(x, y, angle) {
	this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
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
	this.context.strokeStyle = this.color;
	this.context.lineCap = lineCapStyle;
	this.context.moveTo(x, y);

	/* draw angle indicator on base layer */
	var ctx = this.game.baseContext;
	ctx.strokeStyle = this.color;
	ctx.beginPath();
	ctx.moveTo(x, y);
	ctx.lineTo(x += Math.cos(angle) * indicatorLength, y += Math.sin(angle) * indicatorLength);
	ctx.stroke();
	ctx.beginPath();
    ctx.arc(x, y, indicatorDotSize, 0, 2 * Math.PI, false);
    ctx.fill();

	debugLog("initialising player at (" + this.x + ", " + this.y + "), angle = " + this.angle);
}

/* input control */
function InputController(left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = null;
	this.game = null;
	this.lastSteerTick = -1;

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

	if(keyCode == this.rightKeyCode && this.player.turn != -1) 
		this.steerLocal(-1);
	
	else if(keyCode == this.leftKeyCode && this.player.turn != 1)
		this.steerLocal(1);
}

InputController.prototype.keyUp = function(keyCode) {
	if(!this.player.alive)
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) 
		this.steerLocal(0);
}

InputController.prototype.steerLocal = function(turn){
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
		
		setCookie('maxPlayers',maxPlayers,30);
		setCookie('minPlayers',minPlayers,30);
		setCookie('playerName',playerName,30);
		
		if(typeof playerName != "string" || playerName.length < 1)
			debugLog('enter a cool playername please');

		if(maxPlayers > 8 || maxPlayers < 1 || minPlayers > 8 || minPlayers < 1
		 || minPlayers > maxPlayers)
			debugLog('min/ maxplayers unacceptable!');
		
		if(game.connected === false){
			game.connect(serverURL, "game-protocol");
			onConnect = function(){
				game.requestGame(playerName, minPlayers, maxPlayers);
			};
		}
		else
			game.requestGame(playerName, minPlayers, maxPlayers);
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

/* cookies */
function setCookie(c_name,value,exdays) {
	var exdate=new Date();
	exdate.setDate(exdate.getDate() + exdays);
	var c_value=escape(value) + ((exdays==null) ? "" : "; expires="+exdate.toUTCString());
	document.cookie=c_name + "=" + c_value;
}

function getCookie(c_name) {
	var i,x,y,ARRcookies=document.cookie.split(";");
	for (i=0;i<ARRcookies.length;i++) {
		x=ARRcookies[i].substr(0,ARRcookies[i].indexOf("="));
		y=ARRcookies[i].substr(ARRcookies[i].indexOf("=")+1);
		x=x.replace(/^\s+|\s+$/g,"");
		if (x==c_name)
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
