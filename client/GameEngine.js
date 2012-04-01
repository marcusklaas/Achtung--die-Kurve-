var rareNaam = (function() { // zodat we het zien als sommige plekken nog op een globale manier game aanroepen
	/* private variables */
	var rewardNodes = new Array();
	var debugSegments = new Array();
	var players = new Array();
	var indexToPlayer = new Array(8);
	var websocket;
	var receiver;
	var torus = false;
	var connected = false;
	var canvasContainer; 
	var fpsMeasureTick = 0;
	var frameCount = 0;
	var gameloopTimeout = null;
	var ping = 0;
	var syncSendTime = 0;
	var bestSyncPing = 0;
	var worstSyncPing = 0;	
	var gameStartTimestamp = 0;
	var serverTimeDifference = -1;
	var syncTry = -1;
	var adjustGameTimeMessagesReceived = 0;
	var modifiedInputs = 0;
	var redraws = 0;
	var countdown = 0;
	var correctionTick = 0;
	var tock = 0;
	
	/* private methods */
	/* this only resets things like canvas, but keeps the player info */
	function reset() {
		correctionTick = 0;
		GameEngine.tick = -1;
		redraws = 0;
		adjustGameTimeMessagesReceived = 0;
		modifiedInputs = 0;
		debugSegments.length = 0;

		/* these vars are for fps measuring purposes */
		fpsMeasureTick = 0; // start of interval
		frameCount = 0;
		fps = 0;

		GameEngine.crossQueue.length = 0;
		document.getElementById('winAnnouncer').style.display = 'none';
	
		GameEngine.pencil.reset();
	}
	
	function resetPlayers() {
		players.length = 0;
		GameEngine.domManager.clearPlayerList();
		GameEngine.host = null;
	}
	
	function parseByteMsg(str) {
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

			correctionTick = Math.min(GameEngine.localPlayer.inputs[input].tick += tickDelta, correctionTick);
		
			return true;
		}

		if(mode == modeTickUpdate) {
			var b = str.charCodeAt(1);
			var c = str.charCodeAt(2);
	
			var player = indexToPlayer[(a & (8 + 16 + 32)) >> 3];
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
					GameEngine.mapSegments.length = 0;
					GameEngine.mapTeleports.length = 0;

					while(true) {
						var b = str.charCodeAt(msg.at++);
						if(b == 0)
							break;

						var colorId = b & 31;
						GameEngine.mapTeleports.push(GameEngine.getTeleport(colorId, msg.readPos(), 
						 msg.readPos(), msg.readPos(), msg.readPos()));
					}

					while(msg.at < msg.data.length) {
						var a1 = msg.readPos();
						var a2 = msg.readPos();
						GameEngine.mapSegments.push(new Segment(a1.x, a1.y, a2.x, a2.y));
					}

				return true;
			}
		}

		switch(mode) {
			case modePencil:
				var msg = new ByteMessage(str, 1);
				var player = indexToPlayer[(a & (8 + 16 + 32)) >> 3];
				receiver.handlePencilMessage(msg, player);
				return true;
		}
	}

	function decodeTurn(oldTurn, turnChange) {
		if((oldTurn == 0 || oldTurn == 1) && turnChange == 0)
			return -1;

		if((oldTurn == 0 || oldTurn == -1) && turnChange == 1)
			return 1;

		return 0;
	}

	function parseSteerMsg(str) {
		var a = str.charCodeAt(0);
		var b = str.charCodeAt(1);
	
		var index = a & 7;
		var turnChange = (a & 8) >> 3;
		var tickDelta = ((a & (16 + 32 + 64)) >> 4) | (b << 3);
		var player = indexToPlayer[index];
		var newTurn = decodeTurn(player.lastInputTurn, turnChange);
		var tick = player.lastInputTick += tickDelta;
		player.lastInputTurn = newTurn;

		player.inputs.push(new Turn(newTurn, tick, 0, 0, false));
	
		if(tick <= Math.floor(tock))
			correctionTick = Math.min(correctionTick, tick);
	}
	
	function interpretMsg(msg) {
		if(msg.data.length == 2)
			return parseSteerMsg(msg.data);
	
		if(parseByteMsg(msg.data))
			return;
	
		try {
			var obj = JSON.parse(msg.data);
		}
		catch(ex) {
			GameEngine.domManager.gameMessage('JSON parse exception!');
		}
	
		if(ultraVerbose && obj.mode != 'segments')
			GameEngine.domManager.gameMessage('Received data: ' + msg.data);

		switch(obj.mode) {
			case 'acceptUser':
				/* cool, we are accepted. lets adopt the server constants */
				GameEngine.localPlayer.id = obj.playerId;
				GameEngine.tickLength = obj.tickLength;
				GameEngine.pencil.setParameters(obj);
				if(autoStart)
					GameEngine.createGame();
				break;
			case 'kickNotification':
				GameEngine.domManager.gameMessage('You were kicked from the game');
				break;
			case 'joinedGame':
				resetPlayers();
				GameEngine.type = obj.type;
				GameEngine.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
				GameEngine.mapSegments.length = 0;
				GameEngine.mapTeleports.length = 0;
				GameEngine.noMapSent = true;
				indexToPlayer[obj.index] = GameEngine.localPlayer;
				GameEngine.localPlayer.index = obj.index;
				GameEngine.addPlayer(GameEngine.localPlayer);

				if(obj.type == 'lobby') {
					GameEngine.domManager.updateTitle('Lobby');
					var index = window.location.href.indexOf('?game=', 0)

					if(!joinedLink && index != -1) {
						GameEngine.joinGame(parseInt(window.location.href.substr(index + 6)));
						joinedLink = true;
					}
				}
				else
					GameEngine.domManager.setWaitMessage(obj.type == 'custom');

				if(obj.type != 'custom')
					GameEngine.setHost(null);
				break;
			case 'gameParameters':
				GameEngine.setParams(obj);
				break;				
			case 'newPlayer':
				var newPlayer = new Player(GameEngine, false);
				newPlayer.id = obj.playerId;
				indexToPlayer[obj.index] = newPlayer;
				newPlayer.index = obj.index;
				newPlayer.playerName = escapeString(obj.playerName);
				GameEngine.addPlayer(newPlayer);
				GameEngine.audioController.playSound('newPlayer');
				break;
			case 'startGame':
				/* keep displaying old game for a while so ppl can see what happened */
				var nextRoundDelay = obj.startTime - serverTimeDifference - ping
				 + extraGameStartTimeDifference - Date.now();
				 
				// first back to game lobby for some reset work
				if(GameEngine.state == 'ended')
					GameEngine.backToGameLobby();
				
				document.getElementById('goalDisplay').innerHTML = 'Goal: ' + obj.goal + ' points';

				if(nextRoundDelay >  countdown) {
					gameloopTimeout = window.setTimeout(function() {
						GameEngine.start(obj.startPositions, obj.startTime);
					}, nextRoundDelay - countdown);
				}
				else
					GameEngine.start(obj.startPositions, obj.startTime);
				break;
			case 'adjustGameTime':
				if(acceptGameTimeAdjustments) {
					//GameEngine.domManager.gameMessage('Adjusted game time by ' + obj.forward + ' msec');
					gameStartTimestamp -= obj.forward;
					ping += obj.forward;
					adjustGameTimeMessagesReceived++;
					GameEngine.displayDebugStatus();
				} else
					GameEngine.domManager.gameMessage('Game time adjustment of ' + obj.forward + ' msec rejected');
				break;
			case 'playerLeft':
				var player = GameEngine.getPlayer(obj.playerId);
			
				if(GameEngine.state != 'lobby' || obj.reason != 'normal')
					GameEngine.domManager.gameMessage(player.playerName + ' left the game' +
					 (obj.reason == 'normal' ? '' : ' (' + obj.reason + ')'));

				GameEngine.removePlayer(player);
				GameEngine.audioController.playSound('playerLeft');
				break;
			case 'playerDied':
				var player = GameEngine.getPlayer(obj.playerId);
				player.finalSteer(obj);
				player.status = 'dead';
				player.updateRow();
	
				if(player == GameEngine.localPlayer) {
					if(GameEngine.pencilMode == 'ondeath') 
						GameEngine.pencil.enable(obj.tick);
					else if(GameEngine.pencilMode == 'off')
						GameEngine.setGameState('watching');
					GameEngine.audioController.playSound('localDeath');
				}

				GameEngine.displayRewards(obj.reward);
				for(var i in players) {
					var player = players[i];
					if(player.status == 'alive') {
						player.points += obj.reward;
						player.updateRow();
					}
				}

				GameEngine.domManager.sortPlayerList();		
				break;
			case 'endRound':
				window.clearTimeout(gameloopTimeout);
				document.getElementById('inkIndicator').style.display = 'none';
				for(var i = GameEngine.maxHiddenRewards; i < rewardNodes.length; i++)
					canvasContainer.removeChild(rewardNodes.pop());
				
				// simulate to finalTick
				tock = GameEngine.tick = Math.max(GameEngine.tick, obj.finalTick);
				correctionTick = Math.min(correctionTick, obj.finalTick);
				GameEngine.revertBackup();
				
				var player = (obj.winnerId != -1) ? GameEngine.getPlayer(obj.winnerId) : null;
				var winner = (player != null) ? (player.playerName + ' won') : 'draw!';
				GameEngine.setGameState('countdown');
				GameEngine.domManager.gameMessage('Round ended: ' + winner);
				break;			
			case 'endGame':
				GameEngine.setGameState('ended');
				window.clearTimeout(gameloopTimeout);
				var winner = GameEngine.getPlayer(obj.winnerId);			
				GameEngine.domManager.gameMessage('Game over: ' + winner.playerName + ' won!');

				var announcement = document.getElementById('winAnnouncer');
				announcement.innerHTML = winner.playerName + ' won!';
				announcement.style.display = 'inline-block';

				if(winner.isLocal)
					GameEngine.audioController.playSound('localWin');
				if(jsProfiling)
					console.profileEnd();
				break;
			case 'time':
				handleSyncResponse(obj.time);
				break;
			case 'chat':
				GameEngine.audioController.playSound('chat');
				GameEngine.domManager.printChat(GameEngine.getPlayer(obj.playerId), obj.message);
				break;
			case 'newGame':
				GameEngine.domManager.appendGameList(obj);
				break;
			case 'gameList':
				GameEngine.domManager.buildGameList(obj.games);
				break;
			case 'segments':
				this.canvasManager.drawDebugSegments(GameEngine.baseContext, obj.segments);
				debugSegments = debugSegments.concat(obj.segments);
				break;
			case 'stopSpamming':
				GameEngine.domManager.gameMessage('You are flooding the chat. Your latest message has been blocked');
				break;
			case 'setHost':
				GameEngine.setHost(GameEngine.getPlayer(obj.playerId));
				if(autoStart)
					GameEngine.sendStartGame();
				break;
			case 'joinFailed':
				/* TODO: dit hele blok zou naar domManager kunnen */
				var msg = 'game already started';
				if(obj.reason == 'notFound') msg = 'game not found';
				else if(obj.reason == 'full') msg = 'game is full';
				else if(obj.reason == 'kicked') msg = 'you are banned for another ' + obj.timer + ' milliseconds';

				GameEngine.domManager.gameMessage('Could not join game: ' + msg);

				if(obj.reason == 'started')
					document.getElementById('game' + obj.id).getElementsByTagName('button')[0].disabled = true;
				else if(obj.reason == 'notFound') {
					var row = document.getElementById('game' + obj.id);

					if(row != null)
						row.parentNode.removeChild(row);

					if(!GameEngine.gameList.hasChildNodes())
						document.getElementById('noGames').style.display = 'block';
				}
				break;
			default:
				GameEngine.domManager.gameMessage('Unknown mode ' + obj.mode + '!');
		}
	}
	
	function realStart() {
		GameEngine.baseContext.drawImage(canvases[0], 0, 0, this.width, this.height);
		GameEngine.audioController.playSound('gameStart');
		GameEngine.setGameState('playing');
		GameEngine.sendMsg('enableInput', {});
		GameEngine.tick = 0;
		gameloop();
	}
	
	function gameloop() {
		if(GameEngine.state != 'playing' && GameEngine.state != 'watching')
			return;

		var endTick = (Date.now() - gameStartTimestamp)/ GameEngine.tickLength;
		var stateCount = backupStates.length - 1;

		if(displayDebugStatus)
			measureFPS();

		while(GameEngine.tick < endTick) {
			var nextIntegerTick = Math.floor(GameEngine.tick + 1);
			var wholeTick = (GameEngine.tick == Math.floor(GameEngine.tick));

			/* SIMULATE CPU LAG */
			if(wholeTick && simulateCPUlag && (GameEngine.tick % 200 == 199))
				for(var waitStart = Date.now(); Date.now() - waitStart < 4E2;);

			GameEngine.revertBackup();

			/* only update the baseCanvas every loop, the rest we can do
			 * on integer ticks */
			if(wholeTick)
				for(var i = 0; i < stateCount; i++)
					GameEngine.updateContext(i, true);

			GameEngine.updateContext(stateCount, false);

			if(wholeTick) {
				GameEngine.pencil.doTick();
			
				for(var i in players)
					var player = players[i].pen.doTick();
			}

			GameEngine.tick = Math.min(nextIntegerTick, endTick);
			correctionTick = Math.ceil(GameEngine.tick);
			tock = Math.max(0, GameEngine.tick - tickTockDifference);
		}

		if(vSync)
			requestAnimFrame(gameloop);
		else
			setTimeout(gameloop, 0);
	}
	
	function measureFPS() {
		var dt = GameEngine.tickLength * (GameEngine.tick - fpsMeasureTick);

		if(dt >= fpsInterval) {
			fps = 1000 * frameCount/ dt;
			fpsMeasureTick = GameEngine.tick;
			frameCount = 0;
			GameEngine.displayDebugStatus();
		}

		frameCount++;
	}
	
	function syncWithServer() {
		syncSendTime = Date.now();
		GameEngine.sendMsg('getTime', {});
	}
	
	function handleSyncResponse(serverTime) {
		if(syncTry == -1) {
			ping = 0;
			bestSyncPing = 9999;
			worstSyncPing = 0;
			syncTry = 0;
		}

		var newPing = (Date.now() - syncSendTime)/ 2;
		if(newPing < bestSyncPing) {
			bestSyncPing = newPing;
			serverTimeDifference = (serverTime + newPing) - Date.now();
		}

		if(newPing > worstSyncPing) {
			ping += worstSyncPing;
			worstSyncPing = ping/ (syncTries - 1);
		}
		else
			ping += newPing/ (syncTries - 1);

		if(++syncTry < syncTries)
			window.setTimeout(syncWithServer, syncTry * syncDelays);
		else {
			GameEngine.domManager.gameMessage('Your current ping is ' + ping + ' msec');
			if(ultraVerbose)
				GameEngine.domManager.gameMessage('Synced with maximum error of ' + bestSyncPing + ' msec');
			syncTry = -1;
		}
	}

	/* public object */
	var GameEngine = function() {
		this.state; // new, lobby, editing, waiting, countdown, playing, watching, ended
		this.type = 'custom';
		this.scaleX = this.scaleY = 0;
		this.noMapSent = false;
		this.width = 0;
		this.height = 0;
		this.velocity = 0;
		this.tick = 0;
		this.holeSize = this.holeFreq = 0;
		this.pencilMode = 'off';
		this.turnSpeed = 1.5;
		this.host = null;
		this.ticklength = 0;
		this.crossQueue;
		this.mapSegments;
		this.mapTeleports;
		this.baseContext;
		this.contexts;
		this.mouse;
		
		/* children */
		this.localPlayer;
		this.audioController;
		this.editor;
		this.pencil;
		this.domManager;
		this.canvasManager;
	};

	GameEngine.onload = function() {
		var baseCanvas = document.getElementById('baseCanvas');
		canvasContainer = document.getElementById('canvasContainer');

		this.mouse = new Vector(0, 0);
		this.crossQueue = new Array();
		this.mapSegments = new Array();
		this.mapTeleports = new Array();
		this.baseContext = baseCanvas.getContext('2d');
		this.state = 'new';

		canvases = new Array(backupStates.length);
		this.contexts = new Array(backupStates.length);

		for(var i = 0; i < backupStates.length - 1; i++) {
			canvases[i] = document.createElement('canvas');
			this.contexts[i] = canvases[i].getContext('2d');
		}

		canvases[backupStates.length - 1] = baseCanvas;
		this.contexts[backupStates.length - 1] = this.baseContext;

		/* children -- be careful we need to init these in right order */
		this.audioController = new AudioController();
		this.domManager = createDomManager(this);
		this.canvasManager = createCanvasManager(this);
		this.pencil = createPencil(this);
		this.editor = createEditor(this);
		this.localPlayer = new Player(this, true);
		receiver = createReceiver();
		
		this.audioController.onload();
		this.pencil.onload();
		this.editor.onload(); 
		this.domManager.onload();
	};

	GameEngine.getPlayer = function(playerId) {
		return players[playerId];
	};

	GameEngine.connect = function(url, name, callback) {
		if('MozWebSocket' in window)
			websocket = new MozWebSocket(url, name);
		else if('WebSocket' in window)
			websocket = new WebSocket(url, name);
		else
			return;
	
		try {
			websocket.onopen = function() {
				GameEngine.domManager.gameMessage('Connected to server');
				GameEngine.connected = true;
				syncWithServer();
				callback();
			}
			websocket.onmessage = function(msg) {
				if(simulatedPing > 0)
					window.setTimeout(function() { interpretMsg(msg); }, simulatedPing);
				else
					interpretMsg(msg);
			}
			websocket.onclose = function() {
				if(GameEngine.connected) {
					GameEngine.domManager.gameMessage('Disconnected from server');
					GameEngine.connected = false;
				} 
				else
					GameEngine.domManager.gameMessage('Could not connect to server');

				GameEngine.setGameState('new');
			}
		}
		catch(exception) {
			GameEngine.domManager.gameMessage('Websocket exception! ' + exception.name + ': ' + exception.message);
		}
	};
	
	GameEngine.disconnect = function() {
		websocket.close(1000);
	};

	/* some message methods */
	GameEngine.leaveGame = function() {
		this.sendMsg('leaveGame', {});
		window.clearTimeout(gameloopTimeout);
	};

	GameEngine.addComputer = function() {
		this.sendMsg('addComputer', {});
	};

	GameEngine.joinGame = function(gameId) {
		this.sendMsg('join', {'id': gameId});
	};

	GameEngine.joinLobby = function(player) {
		this.sendMsg('joinLobby', {'playerName': player.playerName});
		player.playerName = escapeString(player.playerName);
	};

	GameEngine.sendStartGame = function() {
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
	};

	GameEngine.requestKick = function(id) {
		this.sendMsg('kick', {'playerId': id});
	};

	GameEngine.getCollision = function(x1, y1, x2, y2) {
		var seg = new Segment(x1, y1, x2, y2);
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
			cut = mincut;
			var colx = (1 - cut) * x1 + cut * x2;
			var coly = (1 - cut) * y1 + cut * y2;
			var r = other.tall ? coly - other.y1 : colx - other.x1;

			return new Collision(true, colx, coly, other.destX + r * other.dx,
			 other.destY + r * other.dy, other.extraAngle);
		}
	
		return null;
	};
	
	GameEngine.setGameState = function(newState) {
		this.domManager.setGameState(GameEngine.state, newState);
		this.state = newState;
	};

	GameEngine.getTeleport = function(teleporterId, a, b, c, d) {
		var vx = b.x - a.x;
		var vy = b.y - a.y;
		var wx = d.x - c.x;
		var wy = d.y - c.y;
	
		var t = new Teleporter(a.x, a.y, b.x, b.y, teleporterId);
		t.tall = Math.abs(vy) > Math.abs(vx);
		t.dx = wx / (t.tall ? vy : vx);
		t.dy = wy / (t.tall ? vy : vx);
		t.extraAngle = getAngle(wx, wy) - getAngle(vx, vy);
		t.destX = c.x;
		t.destY = c.y;

		return t;
	};

	GameEngine.removePlayer = function(player) {
		delete players[player.id];
		
		if(this.state == 'waiting' || this.state == 'lobby' ||
		 this.state == 'editing' || player.status == 'left' ||
		 (this.state == 'ended' && player.status == 'ready')) {
		 	this.domManager.splicePlayerList(player);
		} else {
			player.id += '_left';
			players[player.id] = player;
			player.status = 'left';
			player.updateRow();
		}
	};

	GameEngine.setHost = function(player) {
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
		}
		else
			this.host = null;
			
		this.domManager.newHost(this.host == this.localPlayer);
	};

	/* initialises the game */ 
	GameEngine.setParams = function(obj) {
		this.width = obj.w;
		this.height = obj.h;
		countdown = obj.countdown;
		this.velocity = obj.v;
		this.turnSpeed = obj.ts;
		this.holeSize = obj.hsize;
		this.holeFreq = obj.hfreq;
		this.pencilMode = obj.pencilmode;
		torus = (obj.torus != 0);

		if(this.pencilMode != 'off')
			this.pencil.setParameters(obj);
	
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
			document.getElementById('torus').checked = torus;
			document.getElementById('inkCapacity').value = obj.inkcap;
			document.getElementById('inkRegen').value = obj.inkregen;
			document.getElementById('inkDelay').value = obj.inkdelay;

			setPencilMode(obj.pencilmode); // FIXME: move setpencilmode to domManager
			this.domManager.updateTitle('Game ' + obj.id);

			var url = new String(window.location);
			var hashPos = url.indexOf('?', 0);

			if(hashPos != -1)
				url = url.substr(0, hashPos);
			url += '?game=' + obj.id;

			document.getElementById('friendInviter').innerHTML = 'Invite your friends by' + 
			 ' sending them this link: ' + url;
		}
	};

	GameEngine.sendMsg = function(mode, data) {
		data.mode = mode;
		var str = JSON.stringify(data);
	
		if(simulatedPing > 0) {
			window.setTimeout(function() {
				websocket.send(str);
				if(ultraVerbose)
					GameMessage.domManager.gameMessage('Sending data: ' + str);
			}, simulatedPing);	
		}
		else{
			websocket.send(str);
			if(ultraVerbose)
				this.domManager.gameMessage('Sending data: ' + str);
		}
	};

	GameEngine.addPlayer = function(player) {
		player.color = playerColors[player.index];
		player.segColor = getRGBstring(player.color);
		player.holeColor = getRGBAstring(player.color, holeAlpha);
		player.status = 'ready';
		player.points = 0;
		player.isHost = false;
		players[player.id] = player;
		this.domManager.appendPlayerList(player);

		if(player == this.localPlayer)
			this.pencil.updateColor();
	};

	/* sets this.scale, which is canvas size / game size */
	GameEngine.calcScale = function(extraVerticalSpace) {
		var compensation = this.domManager.sidebarWidth();
		var targetWidth = Math.max(document.body.clientWidth - compensation, canvasMinimumWidth);
		var targetHeight = document.body.clientHeight - extraVerticalSpace;
		var scaleX = targetWidth/ this.width;
		var scaleY = targetHeight/ this.height;
		this.scaleY = this.scaleX = Math.min(scaleX, scaleY);

		if(Math.max(this.scaleX/ scaleX, scaleX/ this.scaleX,
		 this.scaleY/ scaleY, scaleY/ this.scaleY) <= maxCanvasStretch) {
			this.scaleX = scaleX;
			this.scaleY = scaleY;
		}
	};

	GameEngine.sendParams = function() {
		this.sendMsg('setParams', {
			goal: parseInt(document.getElementById('goal').value),
			v: parseInt(document.getElementById('velocity').value),
			w: parseInt(document.getElementById('width').value),
			h: parseInt(document.getElementById('height').value),
			ts: parseFloat(document.getElementById('turnSpeed').value),
			hsize: parseInt(document.getElementById('holeSize').value),
			hfreq: parseInt(document.getElementById('holeFreq').value),
			pencilmode: getPencilMode(), // FIXME: move getPencilMode to domManager
			nmax: parseInt(document.getElementById('nmax').value),
			torus: document.getElementById('torus').checked ? 1 : 0,
			inkcap: parseInt(document.getElementById('inkCapacity').value),
			inkregen: parseInt(document.getElementById('inkRegen').value),
			inkdelay: parseInt(document.getElementById('inkDelay').value)
		});
	};

	GameEngine.start = function(startPositions, startTime) {
		gameStartTimestamp = startTime - serverTimeDifference - ping
		 + extraGameStartTimeDifference;
		this.setGameState('countdown');
		var delay = gameStartTimestamp - Date.now();

		reset();
	
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
	
		for(var i in players) {
			var player = players[i];
			if(player.status == 'left')
				player.finalTick = -1;
		}

		if(alwaysHideSidebar || touchDevice)
			this.domManager.setSidebarVisibility(false);

		this.resize();

		/* set up map segments on all contexts */
		for(var i = 1; i < backupStates.length; i++)
			this.contexts[i].drawImage(canvases[0], 0, 0, this.width, this.height);

		/* draw angle indicators */
		for(var i = 0; i < startPositions.length; i++)
			this.getPlayer(startPositions[i].playerId).drawIndicator();

		gameloopTimeout = window.setTimeout(realStart, delay + this.tickLength);
		this.domManager.focusChat();
	};

	GameEngine.revertBackup = function() {
		var ceiledTick = Math.ceil(this.tick);

		/* false alarm, no revert required */
		if(correctionTick >= ceiledTick)
			return;

		redraws++;
		this.displayDebugStatus();

		/* calculate closest restore point */
		for(var stateIndex = backupStates.length - 1; correctionTick < ceiledTick - backupStates[stateIndex]; stateIndex--);

		/* reset next state to this point */
		for(var i in players) {
			var player = players[i];
			player.states[stateIndex + 1].copyState(player.states[stateIndex]);
		}

		/* copy to next canvas */
		var nextContext = this.contexts[stateIndex + 1];
		nextContext.drawImage(canvases[stateIndex], 0, 0, this.width, this.height);
		correctionTick = ceiledTick - backupStates[stateIndex + 1];

		/* simulate every player up to next backup point */
		this.updateContext(stateIndex + 1, true);
	
		/* not the right place i guess */
		this.canvasManager.drawDebugSegments(this.baseContext, debugSegments);

		/* recurse all the way until we are at baseCanvas */
		this.revertBackup();
	};

	GameEngine.updateContext = function(stateIndex, floorTick) {
		for(var i in players) {
			var player = players[i];
			var tick = player.isLocal ? this.tick : tock;
			tick -= backupStates[stateIndex];

			if(floorTick)
				tick = Math.floor(tick);

			player.simulate(tick, this.contexts[stateIndex], player.states[stateIndex]);
		}

		this.drawCrosses(stateIndex);
	};

	GameEngine.drawCrosses = function(stateIndex) {
		for(var i = 0, len = this.crossQueue.length/ 2; i < len; i++)
			this.canvasManager.drawCross(this.contexts[stateIndex], this.crossQueue[2 * i], this.crossQueue[2 * i + 1]); 

		this.crossQueue.length = 0;
	};

	GameEngine.createRewardNode = function(player, reward) {
		var node;
		var recycle = rewardNodes.length > 0;
		var w = rewardWidth;
		var h = rewardHeight;
		var playerState = player.states[backupStates.length - 1];

		if(recycle) {
			node = rewardNodes.pop();
		} else {
			node = document.createElement('div');
			node.className = 'reward';
		}
	
		node.innerHTML = '+' + reward;
		var left = playerState.x * this.scaleX - w / 2;
		left = Math.min(this.width * this.scaleX - w, Math.max(0, left));
		var top = playerState.y * this.scaleY - h - rewardOffsetY;
		if(top < 0)
			top += rewardOffsetY * 2 + h;
		node.style.left = left + 'px';
		node.style.top = top + 'px';
	
		if(recycle) {
			node.style.display = 'block';
		} else {
			canvasContainer.appendChild(node);
		}
	
		return node;
	};

	GameEngine.displayRewards = function(reward) {
		if(!reward)
			return;
	
		var nodes = [];
	
		for(var i in players) {
			var player = players[i];
			if(player.status == 'alive') {
				nodes.push(this.createRewardNode(player, reward));
			}
		}
	
		function recycleRewards() {
			for(var i = 0; i < nodes.length; i++) {
				nodes[i].className = 'reward';
				nodes[i].style.display = 'none';
			}
			rewardNodes = rewardNodes.concat(nodes);
		}
	
		function startHidingRewards() { 
			for(var i = 0; i < nodes.length; i++) {
				nodes[i].classList.add('reward-hidden');
			}
		}
	
		window.setTimeout(startHidingRewards, rewardShowLength);
		window.setTimeout(recycleRewards, rewardShowLength + rewardMaxTransitionLength);
	};

	GameEngine.resize = function() {
		this.calcScale(0);
		var scaledWidth = Math.round(this.scaleX * this.width);
		var scaledHeight = Math.round(this.scaleY * this.height)
		canvasContainer.style.width = scaledWidth + 'px';
		canvasContainer.style.height = scaledHeight + 'px';

		for(var i = 0; i < backupStates.length; i++) {
			canvases[i].width = scaledWidth;
			canvases[i].height = scaledHeight;
			this.canvasManager.initContext(this.contexts[i], this.scaleX, this.scaleY);
		}
	
		this.canvasManager.drawMapSegments(this.contexts[0]);
		this.canvasManager.drawPencilSegments(this.contexts[0]);

		correctionTick = -backupStates[1] - 1;
		this.revertBackup();
	};

	GameEngine.displayDebugStatus = function() {
		if(displayDebugStatus)
			this.domManager.setDebugMessage('FPS: + ' + fps +
			 '<br/>Reverts: ' + redraws +
			 '<br/>Modified inputs: ' + modifiedInputs + '<br/>Time adjustments: ' +
			 adjustGameTimeMessagesReceived);
	};

	GameEngine.backToGameLobby = function() {	
		// remove players who left game & set status for other players
		for(var i in players) {
			var player = players[i];

			if(player.status == 'left')
				this.removePlayer(player);
			else {
				player.status = player.isHost ? 'host' : 'ready';
				player.points = 0;
				player.updateRow();
			}
		}
	};

	GameEngine.copyGamePos = function(e, pos) {
		pos.x = e.pageX;
		pos.y = e.pageY;
		pos.subtract(this.domManager.findPos(e.target));
		pos.x = Math.round(Math.max(Math.min(this.width, pos.x / this.scaleX), 0))
		pos.y = Math.round(Math.max(Math.min(this.height, pos.y / this.scaleY), 0));
	
		return pos;
	};

	GameEngine.getGamePos = function(e) {
		var pos = new Vector(0, 0);
		this.copyGamePos(e, pos);
		return pos;
	}

	return GameEngine;
})();
