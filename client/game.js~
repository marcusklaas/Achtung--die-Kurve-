/* debugging */
function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

/* game engine */
function GameEngine(container) {
	debugLog("creating game");

	// game variables
	this.players = [];
	this.idToPlayer = []; // maps playerId to index of this.players
	this.gameStartTimestamp = null;
	this.lastUpdateTimestamp = null;
	this.gameOver = true;

	// game properties
	this.velocity = null;
	this.turnSpeed = null;

	// connection state
	this.websocket = null;
	this.connected = false;

	// canvas related
	this.container = container; // DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.baseContext = null; // on this we draw conclusive segments	
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
		}
		this.websocket.onmessage = function got_packet(msg) {
			if(ultraVerbose)
				debugLog('received data: ' + msg.data);

			try {
				var obj = JSON.parse(msg.data);
			}
			catch(ex) {
				debugLog('JSON parse exception!');
			}

			switch(obj.mode) {
				case 'accept':
					this.players[0].playerId = obj.playerId;
					this.idToPlayer[obj.playerId] = 0;
					break;
				case 'joinGame':
					debugLog('you joined game.');
					break;
				case 'gameParameters':
					game.setParams(obj);
					debugLog('received game params.');
					break;				
				case 'newPlayer':
					var newPlayer = new Player(playerColors[game.players.length]);
					newPlayer.playerId = obj.playerId;
					newPlayer.playerName = obj.playerName;
					game.addPlayer(newPlayer);
					debugLog(obj.playerName + ' joined the game (id = ' + obj.playerId + ')');
					break;
				case 'startGame':
					game.start(obj.startPositions);
					break;
				case 'newInput':
					game.players[game.idToPlayer[obj.playerId]].turn(obj);
					break;

				// TODO: handle case where player leaves before game start

				case 'playerDied':
				case 'playerLeft':
					player[game.idToPlayer[obj.playerId]].alive = false;
					debugLog(player[game.idToPlayer[obj.playerId]].playerName +
					 obj.mode.substr(5));
					break;
				case 'gameEnded':
					game.gameOver = true;
					debugLog('game ended. ' +
					 player[game.idToPlayer[obj.winnerId]].playerName + ' won');
					break;
				default:
					debugLog('unknown mode!');
			}
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

/* initialises the game */ 
GameEngine.prototype.setParams = function(obj) {
	/* Create CanvasStack */
	this.container.style.margin = 0;
	this.container.style.padding = 0;
	this.container.style.width = obj.w;
	this.container.style.height = obj.h;

	/* Set game variables */
	this.velocity = obj.v;
	this.turnSpeed = obj.ts;

	debugLog("this game is for " + obj.nmin + " to " + obj.nmax + " players");
}	

GameEngine.prototype.requestGame = function() {
	//var playerName = prompt('Enter your nickname');
	// for testing reasons, we will use constant name
	var playerName = "testPlayer" + Math.floor(Math.random() * 1000);

	if(typeof playerName != "string" || playerName.length < 1)
		return;

	this.players[0].playerName = playerName;
	this.sendMsg('requestGame', {'playerName': playerName, 'minPlayers': 2, 'maxPlayers': 8});
}

GameEngine.prototype.sendMsg = function(mode, data) {
	// re-enabled!
	if(this.connected === false) {
		debugLog('tried to send msg, but no websocket connection');
		return;
	}

	data.mode = mode;
	data.playerId = this.players[0].playerId;

	var str = JSON.stringify(data);
	this.websocket.send(str);

	if(ultraVerbose)
		debugLog('sending data: ' + str);
}

GameEngine.prototype.draw = function(callback) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].draw();
}

GameEngine.prototype.update = function(deltaTime) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].update(deltaTime);
}

GameEngine.prototype.loop = function() {
	var now = Date.now();
	var deltaTime = now - this.lastUpdateTimestamp;

	this.update(deltaTime);
	this.draw();
	this.lastUpdateTimestamp = now;
}

GameEngine.prototype.addPlayer = function(player) {
	player.game = this;

	if(player.playerId != null) {
		/* internet player */
		var canvas = document.getObjectById(this.canvasStack.createLayer());
		this.context = canvas.getContext('2d');
		this.context.lineWidth = lineWidth;
		this.idToPlayer[player.playerId] = this.players.length;
	}

	this.players.push(player);
	debugLog("adding player to game");
}

GameEngine.prototype.stop = function() {
	debugLog("game ended");
}

GameEngine.prototype.start = function(startPositions) {
	debugLog("starting game");

	/* init some vals */
	this.lastUpdateTimestamp = Date.now();
	this.gameStartTimestamp = this.lastUpdateTimestamp;
	this.gameOver = false;

	/* create canvas stack */
	this.canvasStack = new CanvasStack(this.container, canvasBgcolor);

	/* draw on background context, since we never need to redraw anything 
	 * on this layer (only clear for new game) */
	var canvas = document.getObjectById(this.canvasStack.getBackgroundCanvasId());
	this.baseContext = canvas.getContext('2d');
	this.baseContext.lineWidth = lineWidth;

	/* create context for human player */
	canvas = document.getObjectById(this.canvasStack.createLayer());
	this.players[0].context = canvas.getContext('2d');
	this.players[0].context.lineWidth = lineWidth;

	/* init players */
	for(var i = 0; i < startPositions.length; i++) {
		var index = this.idToPlayer[ startPositions[i].playerId ];
		this.players[index].initialise(startPositions[i].startX,
		 startPositions[i].startY, startPositions[i].startAngle);
	}

	var that = this;

	(function gameLoop() {
		that.loop();

		if(that.gameOver)
			that.stop();
		else
			requestAnimFrame(gameLoop, that.canvas);
	})();
}

window.requestAnimFrame = (function() {
	return  window.requestAnimationFrame       ||
			window.webkitRequestAnimationFrame ||
			window.mozRequestAnimationFrame    ||
			window.oRequestAnimationFrame      ||
			window.msRequestAnimationFrame     ||
			function(/* function */ callback, /* DOMElement */ element) {
				window.setTimeout(callback, 1000 / 60);
			};
})();

/* players */
function Player(color) {
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
	this.undrawnPts = []; // list of undrawn points x1, y1, x2, y2, ...
	this.game = null; // to which game does this player belong
	this.context = null; // this is the canvas context in which we draw simulation
	this.alive = false;

	debugLog("creating player");
}

Player.prototype.turn = function(obj) {
	/* run simulation from lcx, lcy on the conclusive canvas from time 
	 * lct to timestamp in object */
	var x = this.lcx;
	var y = this.lcy;
	var t = this.lct;
	var a = this.lca;
	var step = step = Math.min(simStep, obj.gameTime - t);
	var ctx = this.game.baseContext;
	
	ctx.strokeStyle = this.color;
	ctx.beginPath();
	ctx.moveTo(this.lcx, this.lcy);
	
	while(t < obj.gameTime) {
		x += this.velocity * step/ 1000 * Math.cos(a);
		y += this.velocity * step/ 1000 * Math.sin(a);
		a += this.turn * this.turnSpeed * step/ 1000;
		ctx.lineTo(x, y);

		step = Math.min(simStep, obj.gameTime - t);
		t += step;
	}

	// connect to sync point
	ctx.lineTo(obj.x, obj.y);

	ctx.closePath();
	ctx.stroke();

	/* here we sync with server */
	this.lcx = this.x = obj.x;
	this.lcy = this.y = obj.y;
	this.lca = this.angle = obj.angle;
	this.lct = obj.gameTime;
	this.turn = obj.turn;

	/* TODO: clear this players canvas and run simulation on this player's
	 * context from timestamp in object to NOW */
}

Player.prototype.initialise = function(x, y, angle) {
	this.velocity = this.game.velocity;
	this.turnSpeed = this.game.turnSpeed;
	this.undrawnSegs = [];
	this.alive = true;

	this.lcx = this.x = x;
	this.lcy = this.y = y;
	this.context.moveTo(x, y);
	this.context.strokeStyle = this.color;

	this.lct = 0;
	this.angle = angle;
	this.turn = 0;

	debugLog("initialising player at (" + this.x + ", " + this.y + "), angle = " + this.angle);
}

Player.prototype.update = function(deltaTime) {
	if(!this.alive)
		return false;

	this.x += this.velocity * deltaTime/ 1000 * Math.cos(this.angle);
	this.y += this.velocity * deltaTime/ 1000 * Math.sin(this.angle);
	this.undrawnPts.push(newX);
	this.undrawnPts.push(newY);

	this.angle += this.turn * this.turnSpeed * deltaTime/ 1000;
}

Player.prototype.draw = function() {
	if(!this.alive)
		return;

	var len = this.undrawnPts.length/ 2;

	this.context.beginPath();
	for(var i = 0; i < len; i++)
		this.context.lineTo(this.undrawnPts[i], this.undrawnPts[i + 1]);
	this.context.closePath();
	this.context.stroke();

	this.undrawnPts = [];
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
		this.game.sendMsg('newInput', {'turn': -1,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
	else if(keyCode == this.leftKeyCode && this.player.turn != 1){
		this.player.turn = 1;
		this.game.sendMsg('newInput', {'turn': 1,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
}

InputController.prototype.keyUp = function(keyCode) {
	if(!this.player.alive)
		return;

	if((keyCode == this.rightKeyCode && this.player.turn == -1) ||
	 (keyCode == this.leftKeyCode && this.player.turn == 1)) {
		this.player.turn = 0;
		this.game.sendMsg('newInput', {'turn': 0,
		 'gameTime': Date.now() - this.game.gameStartTimestamp});
	}
}

/* create game */
window.onload = function() {

	/* some constants */
	var container = document.getElementById('container');
	var game = new GameEngine(container);
	var player = new Player(playerColors[0]);
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

	/* start! */
	function startGame() {
		game.requestGame();
	};

	var startButton = document.getElementById('start');
	startButton.addEventListener('click', startGame, false);
	game.connect(serverURL, "game-protocol");
}
