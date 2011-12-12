/* debugging */
function debugLog(msg) {
	var container = document.getElementById('debugLog');
	var elt = document.createElement('li');

	elt.innerHTML = msg;
    container.insertBefore(elt, container.firstChild);
}

/* game engine */
function GameEngine(canvas) {
	debugLog("creating game");
	this.players = [];
	this.canvas = canvas;
	this.ctx = canvas.getContext('2d');
	this.gameStartTimestamp = null;
	this.lastUpdateTimestamp = null;
	this.deltaTime = null;
	this.gameOver = true;
	this.websocket = null;
	this.connected = false;

	this.idToPlayer = []; /* this maps a player id to the the index of the player in
	 the array this.players */
}

GameEngine.prototype.connect = function(url, name) {
	if(typeof MozWebSocket != "undefined")
		this.websocket = new MozWebSocket(url, name);
	else
		this.websocket = new WebSocket(url, name);
	
	this.websocket.parent = this;
	
	try {
		this.websocket.onopen = function() {
			debugLog('Connected to websocket server');
			this.connected = true;
			
			// for testing purposes
			//this.parent.requestGame();
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
					// TODO: geeft error! player not defined!
					player[0].playerId = obj.playerId;
					this.idToPlayer[obj.playerId] = 0;
					break;
				case 'newPlayer':
					var newPlayer = new Player(speed, turnSpeed, playerColors[this.players.length]);
					newPlayer.playerId = obj.players[i].playerId;
					newPlayer.playerName = obj.players[i].playerName;
					this.addPlayer(newPlayer);
					debugLog('new player joined the game');
					break;
				case 'start':
					// TODO: set starting positions/ angles for each player
					this.start();
					break;
				case 'newInput':
					player[ idToPlayer[obj.playerId] ].turn = obj.turn;
					break;
				case 'playerDied':
					player[ idToPlayer[obj.playerId] ].alive = false;
					debugLog(player[ idToPlayer[obj.playerId] ].playerName + ' died');
					break;
				case 'playerLeft':
					// do something. at the least stop his worm
					break;
				case 'gameEnded':
					this.gameOver = true;
					debugLog('game ended. ' +
					 player[ idToPlayer[obj.winnerId] ].playerName + ' won');
					break;
				default:
					debugLog('unknown mode!');
			}
		}
		this.websocket.onclose = function() {
			debugLog('Websocket connection closed!');
			this.connected = false;
		}
	} catch(exception) {
		debugLog('websocket exception! name = ' + exception.name + ", message = "
		 + exception.message);
	}
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
	// disabled for testing reasons
	/*
	if(this.connected === false) {
		debugLog('tried to send msg, but no websocket connection');
		return;
	} */

	data.mode = mode;
	// we assume for now the human player is always first
	data.playerId = this.players[0].playerId;

	var str = JSON.stringify(data);
	this.websocket.send(str);
	debugLog('sending data: ' + str);
}

GameEngine.prototype.draw = function(callback) {
	for(var i = 0; i < this.players.length; i++)
		this.players[i].draw();
}

GameEngine.prototype.update = function() {
	for(var i = 0; i < this.players.length; i++)
		this.gameOver |= this.players[i].update(this.deltaTime);
}

GameEngine.prototype.loop = function() {
	var now = Date.now();
	this.deltaTime = now - this.lastUpdateTimestamp;
	this.update();
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

GameEngine.prototype.start = function() {
	debugLog("starting game");
	this.lastUpdateTimestamp = Date.now();
	this.gameStartTimestamp = this.lastUpdateTimestamp;
	this.gameOver = false;

	/* background color */
	this.ctx.fillStyle = "rgba(230, 230, 230, 1)";
	this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

	/* init players */
	for(var i = 0; i < this.players.length; i++)
		this.players[i].initialise();

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
function Player(velocity, turnSpeed, color) {
	this.playerId = null;
	this.playerName = null;
	this.velocity = velocity; //pixels per sec
	this.turnSpeed = turnSpeed;
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

Player.prototype.initialise = function() {
	var radius = 2 * this.velocity/ this.turnSpeed; // twice radius of circle

	this.segments = [];
	this.undrawnSegs = [];
	this.turn = 0;

	/* this should be given by server */
	this.x = Math.floor(radius + Math.random() * (this.game.canvas.width - 2 * radius));
	this.y = Math.floor(radius + Math.random() * (this.game.canvas.height - 2 * radius));
	this.angle = Math.random() * 2 * 3.141592;
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

	this.angle += this.turn * this.turnSpeed * deltaTime/ 1000;
	this.undrawnSegs.push(segment);

	// this logic should not be in this place here. this is server business
	if(newX > 800 || newX < 0 || newY > 400 || newY < 0) {
		this.alive = false;
		return true;
	}
	return false;
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
	var canvas = document.getElementById('game');
	var game = new GameEngine(canvas);
	var player = new Player(speed, turnSpeed, playerColors[0]);
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
	//
}
