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
	this.players = [];
	this.idToPlayer = []; // maps playerId to index of this.players
	this.container = container; // DOM object that contains canvas layers
	this.canvasStack = null; // object that manages canvas layers
	this.gameStartTimestamp = null;
	this.lastUpdateTimestamp = null;
	this.gameOver = true;
	this.websocket = null;
	this.connected = false;

	this.velocity = null;
	this.turnSpeed = null;
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
			debugLog('received data: ' + msg.data);

			try {
				var obj = JSON.parse(msg.data);
			}
			catch(ex) {
				debugLog('JSON parse exception!');
			}

			switch(obj.mode) {
				case 'accept':
					game.init(obj);
					break;
				case 'newPlayer':
					var newPlayer = new Player(playerColors[game.players.length]);
					newPlayer.playerId = obj.playerId;
					newPlayer.playerName = obj.playerName;
					game.addPlayer(newPlayer);
					debugLog(obj.playername + ' joined the game (id = ' + ob.playerId + ')');
					break;
				case 'startGame':
					game.start(obj.startPositions);
					break;
				case 'newInput':
					game.players[ game.idToPlayer[obj.playerId] ].turn = obj.turn;
					break;
				case 'playerDied':
				case 'playerLeft':
					player[ game.idToPlayer[obj.playerId] ].alive = false;
					debugLog(player[ game.idToPlayer[obj.playerId] ].playerName +
					 obj.mode.substr(5));
					break;
				case 'gameEnded':
					game.gameOver = true;
					debugLog('game ended. ' +
					 player[ game.idToPlayer[obj.winnerId] ].playerName + ' won');
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
GameEngine.prototype.init = function(obj) {
	/* Give human player its playerId */
	this.players[0].playerId = obj.playerId;
	this.idToPlayer[obj.playerId] = 0;

	/* Create CanvasStack */
	this.container.style.margin = 0;
	this.container.style.padding = 0;
	this.container.style.width = obj.gameWidth;
	this.container.style.height = obj.gameHeight;
	this.canvasStack = new CanvasStack(this.container, canvasBgcolor);

	/* Set game variables */
	this.velocity = obj.velocity;
	this.turnSpeed = obj.turnSpeed;
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
	// we assume for now the human player is always first
	data.playerId = this.players[0].playerId;

	var str = JSON.stringify(data);
	this.websocket.send(str);
	//debugLog('sending data: ' + str);
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

	if(player.playerId != null)
		this.idToPlayer[player.playerId] = this.players.length;

	this.players.push(player);
	debugLog("adding player to game");
}

GameEngine.prototype.stop = function() {
	debugLog("game ended");
}

GameEngine.prototype.start = function(startPositions) {
	debugLog("starting game");
	this.lastUpdateTimestamp = Date.now();
	this.gameStartTimestamp = this.lastUpdateTimestamp;
	this.gameOver = false;

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
	this.color = color;
	this.turn = 0; // -1 is turn left, 0 is straight, 1 is turn right
	this.segments = []; // list of drawn segments
	this.undrawnSegs = []; // list of undrawn segments
	this.game = null; //to which game does this player belong
	this.alive = false;

	debugLog("creating player");
}

Player.prototype.initialise = function(x, y, angle) {
	var radius = 2 * this.velocity/ this.turnSpeed; // twice radius of circle

	this.segments = [];
	this.undrawnSegs = [];
	this.turn = 0;

	this.x = x;
	this.y = y;
	this.angle = angle;
	this.alive = true;

	debugLog("initialising player at (" + this.x + ", " + this.y + "), angle = " + this.angle);
}

Player.prototype.update = function(deltaTime) {
	if(!this.alive)
		return false;

	var newX = this.x + this.velocity * deltaTime/ 1000 * Math.cos(this.angle);
	var newY = this.y + this.velocity * deltaTime/ 1000 * Math.sin(this.angle);
	var segment = new Segment(this.x, this.y, newX, newY);

	this.x = newX;
	this.y = newY;

	var angleChange = this.turn * this.turnSpeed * deltaTime/ 1000;
	this.angle += angleChange;
	this.undrawnSegs.push(segment);
}

Player.prototype.draw = function() {
	if(!this.alive)
		return;

	var len = this.undrawnSegs.length;
	var ctx = this.game.ctx;

	ctx.strokeStyle = this.color;
	ctx.lineWidth = 2;
	ctx.beginPath();

	for(var i = 0; i < len; i++)
		this.segments.push(this.undrawnSegs.shift().draw(ctx));

	ctx.closePath();
}

/* segments */
function Segment(x1, y1, x2, y2) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
	this.color = null;
}

Segment.prototype.draw = function(ctx) {
	ctx.moveTo(this.x1, this.y1);
	ctx.lineTo(this.x2, this.y2);
	ctx.stroke();

	return this;
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
