var game = (function() {
	var rewardNodes = new Array();
	var crossQueue = new Array();
	var debugSegments = new Array();
	var players = new Array();
	var indexToPlayer = new Array(8);
	var type = 'custom';
	var torus = false;
	var connected = false;
	var canvasContainer; 
	var fpsMeasureTick = 0;
	var frameCount = 0;
	var gameloopTimeout = null;
	var ping = 0;
	var bestSyncPing = 0;
	var worstSyncPing = 0;	
	var gameStartTimestamp = 0;
	var serverTimeDifference = -1;
	var syncTry = -1;
	var adjustGameTimeMessagesReceived = 0;
	var modifiedInputs = 0;
	var redraws = 0;
	var countdown = 0;

	var GameEngine = function() {
		/* public variables */
		this.state = 'new'; // new, lobby, editing, waiting, countdown, playing, watching, ended
		this.scaleX = this.scaleY = 0;
		this.localPlayer;
		this.audioController;
		this.noMapSent = false;
		this.width = 0;
		this.height = 0;
		this.velocity = 0;
		this.correctionTick = 0;
		this.tick = 0;
		this.tock = 0;
		this.holeSize = this.holeFreq = 0;
		this.pencilMode = 'off';
		this.turnSpeed = 1.5;
		this.host = null;
		this.ticklength = 0;
		this.mapSegments;
		this.mapTeleports;
	};

	GameEngine.onload = function() {
		var baseCanvas = document.getElementById('baseCanvas');
		var baseContext = baseCanvas.getContext('2d');
		canvasContainer = document.getElementById('canvasContainer');

		this.mapSegments = new Array();
		this.mapTeleports = new Array();

		canvases = new Array(backupStates.length);
		contexts = new Array(backupStates.length);

		for(var i = 0; i < backupStates.length - 1; i++) {
			canvases[i] = document.createElement('canvas');
			contexts[i] = canvases[i].getContext('2d');
		}

		canvases[backupStates.length - 1] = baseCanvas;
		contexts[backupStates.length - 1] = baseContext;

		/* children */
		this.localPlayer = new Player(this, true);
		this.audioController = new AudioController();

		/* DOM elements. TODO: weghalen deze hiero */
		this.debugBox = document.getElementById('status');
		this.connectButton = document.getElementById('connect');
		this.automatchButton = document.getElementById('automatch');
		this.createButton = document.getElementById('createGame');
		this.leaveButton = document.getElementById('stop');
		this.disconnectButton = document.getElementById('disconnect');
		this.backButton = document.getElementById('back');
		this.startButton = document.getElementById('startGame');
		this.hostContainer = document.getElementById('hostContainer');
		this.addComputerButton = document.getElementById('addComputer');
		this.nonhostContainer = document.getElementById('nonhostContainer');
	};

	/* this only resets things like canvas, but keeps the player info */
	GameEngine.reset = function() {
		this.correctionTick = 0;
		this.tick = -1;
		this.tock = 0;
		redraws = 0;
		adjustGameTimeMessagesReceived = 0;
		modifiedInputs = 0;
		debugSegments.length = 0;

		/* these vars are for fps measuring purposes */
		fpsMeasureTick = 0; // start of interval
		frameCount = 0;
		fps = 0;

		crossQueue.length = 0;
		document.getElementById('winAnnouncer').style.display = 'none';
	
		pencil.reset();
	};

	GameEngine.resetPlayers = function() {
		players.length = 0;
		domManager.clearPlayerList();
		this.host = null;
	};

	GameEngine.getPlayer = function(playerId) {
		return players[playerId];
	};

	GameEngine.connect = function(url, name, callback) {
		if('MozWebSocket' in window)
			this.websocket = new MozWebSocket(url, name);
		else if('WebSocket' in window)
			this.websocket = new WebSocket(url, name);
	
		var self = this;
	
		try {
			this.websocket.onopen = function() {
				domManager.gameMessage('Connected to server');
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
					domManager.gameMessage('Disconnected from server');
					self.connected = false;
				} else {
					domManager.gameMessage('Could not connect to server');
				}
				self.setGameState('new');
			}
		} catch(exception) {
			domManager.gameMessage('Websocket exception! ' + exception.name + ': ' + exception.message);
		}
	};

	GameEngine.leaveGame = function() {
		this.sendMsg('leaveGame', {});
		window.clearTimeout(gameloopTimeout);
		this.leaveButton.disabled = true;
	};

	GameEngine.addComputer = function() {
		this.sendMsg('addComputer', {});
	};

	/* this function handles user interface changes for state transitions */
	GameEngine.setGameState = function(newState) {
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
				domManager.setOptionVisibility('disconnect');
				domManager.setContentVisibility('gameListContainer');
				this.createButton.disabled = this.automatchButton.disabled = false;
				break;
			case 'editing':
				domManager.setContentVisibility('editor');
				break;
			case 'countdown':
				domManager.setContentVisibility('gameContainer');
				domManager.setKickLinksVisibility(false);
				document.getElementById('gameTitle').className = 'leftSide';
				document.getElementById('goalDisplay').style.display = 'block';
				break;
			case 'waiting':
				domManager.setOptionVisibility('stop');
				domManager.setContentVisibility('waitContainer');
				this.startButton.disabled = false;
				this.leaveButton.disabled = false;
				break;
			case 'playing':
				domManager.setOptionVisibility('stop');
				break;
			case 'ended':
				if(domManager.setSidebarVisibility(true))
					this.resize();

				domManager.setKickLinksVisibility(this.host == this.localPlayer);

				if(type == 'custom')
					domManager.setOptionVisibility('back');
				break;
			case 'new':
				domManager.setContentVisibility('connectionContainer');
				domManager.setOptionVisibility('nothing');
				this.connectButton.disabled = false;
				this.connectButton.innerHTML = 'Connect';
				break;
		}
	};

	GameEngine.joinGame = function(gameId) {
		this.sendMsg('join', {'id': gameId});
	};

	GameEngine.joinLobby = function(player) {
		this.sendMsg('joinLobby', {'playerName': player.playerName});
		player.playerName = escapeString(player.playerName);
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

	GameEngine.parseByteMsg = function(str) {
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

			this.correctionTick = Math.min(this.localPlayer.inputs[input].tick += tickDelta,
			 this.correctionTick);
		
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
					this.mapSegments.length = 0;
					this.mapTeleports.length = 0;

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
						this.mapSegments.push(new Segment(a1.x, a1.y, a2.x, a2.y));
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
	};

	GameEngine.decodeTurn = function(oldTurn, turnChange) {
		if((oldTurn == 0 || oldTurn == 1) && turnChange == 0)
			return -1;

		if((oldTurn == 0 || oldTurn == -1) && turnChange == 1)
			return 1;

		return 0;
	};

	GameEngine.parseSteerMsg = function(str) {
		var a = str.charCodeAt(0);
		var b = str.charCodeAt(1);
	
		var index = a & 7;
		var turnChange = (a & 8) >> 3;
		var tickDelta = ((a & (16 + 32 + 64)) >> 4) | (b << 3);
		var player = indexToPlayer[index];
		var newTurn = this.decodeTurn(player.lastInputTurn, turnChange);
		var tick = player.lastInputTick += tickDelta;
		player.lastInputTurn = newTurn;

		player.inputs.push(new Turn(newTurn, tick, 0, 0, false));
	
		if(tick <= Math.floor(this.tock))
			this.correctionTick = Math.min(this.correctionTick, tick);
	};

	GameEngine.interpretMsg = function(msg) {
		var self = this;

		if(msg.data.length == 2)
			return this.parseSteerMsg(msg.data);
	
		if(this.parseByteMsg(msg.data))
			return;
	
		try {
			var obj = JSON.parse(msg.data);
		}
		catch(ex) {
			domManager.gameMessage('JSON parse exception!');
		}
	
		if(ultraVerbose && obj.mode != 'segments')
			domManager.gameMessage('Received data: ' + msg.data);

		switch(obj.mode) {
			case 'acceptUser':
				/* cool, we are accepted. lets adopt the server constants */
				this.localPlayer.id = obj.playerId;
				this.tickLength = obj.tickLength;
				pencil.setParameters(obj);
				if(autoStart)
					this.createGame();
				break;
			case 'kickNotification':
				domManager.gameMessage('You were kicked from the game');
				break;
			case 'joinedGame':
				this.resetPlayers();
				type = obj.type;
				this.setGameState((obj.type == 'lobby') ? 'lobby' : 'waiting');
				this.mapSegments.length = 0;
				this.mapTeleports.length = 0;
				this.noMapSent = true;
				indexToPlayer[obj.index] = this.localPlayer;
				this.localPlayer.index = obj.index;
				this.addPlayer(this.localPlayer);

				if(obj.type == 'lobby') {
					domManager.updateTitle('Lobby');
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
				newPlayer.id = obj.playerId;
				indexToPlayer[obj.index] = newPlayer;
				newPlayer.index = obj.index;
				newPlayer.playerName = escapeString(obj.playerName);
				this.addPlayer(newPlayer);
				this.audioController.playSound('newPlayer');
				break;
			case 'startGame':
				/* keep displaying old game for a while so ppl can see what happened */
				var nextRoundDelay = obj.startTime - serverTimeDifference - ping
				 + extraGameStartTimeDifference - Date.now();
				 
				// first back to game lobby for some reset work
				if(this.state == 'ended')
					this.backToGameLobby();
				
				document.getElementById('goalDisplay').innerHTML = 'Goal: ' + obj.goal + ' points';

				if(nextRoundDelay >  countdown) {
					var self = this;

					gameloopTimeout = window.setTimeout(function() {
						self.start(obj.startPositions, obj.startTime);
					}, nextRoundDelay - countdown);
				}
				else
					this.start(obj.startPositions, obj.startTime);
				break;
			case 'adjustGameTime':
				if(acceptGameTimeAdjustments) {
					//domManager.gameMessage('Adjusted game time by ' + obj.forward + ' msec');
					gameStartTimestamp -= obj.forward;
					ping += obj.forward;
					adjustGameTimeMessagesReceived++;
					this.displayDebugStatus();
				} else
					domManager.gameMessage('Game time adjustment of ' + obj.forward + ' msec rejected');
				break;
			case 'playerLeft':
				var player = this.getPlayer(obj.playerId);
			
				if(this.state != 'lobby' || obj.reason != 'normal')
					domManager.gameMessage(player.playerName + ' left the game' +
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
						pencil.enable(obj.tick);
					else if(this.pencilMode == 'off')
						this.setGameState('watching');
					this.audioController.playSound('localDeath');
				}

				this.displayRewards(obj.reward);
				for(var i in players) {
					var player = players[i];
					if(player.status == 'alive') {
						player.points += obj.reward;
						player.updateRow();
					}
				}

				domManager.sortPlayerList();		
				break;
			case 'endRound':
				window.clearTimeout(gameloopTimeout);
				document.getElementById('inkIndicator').style.display = 'none';
				for(var i = this.maxHiddenRewards; i < rewardNodes.length; i++)
					canvasContainer.removeChild(rewardNodes.pop());
				
				// simulate to finalTick
				this.tock = this.tick = Math.max(this.tick, obj.finalTick);
				this.correctionTick = Math.min(this.correctionTick, obj.finalTick);
				this.revertBackup();
				
				var player = (obj.winnerId != -1) ? this.getPlayer(obj.winnerId) : null;
				var winner = (player != null) ? (player.playerName + ' won') : 'draw!';
				this.setGameState('countdown');
				domManager.gameMessage('Round ended: ' + winner);
				break;			
			case 'endGame':
				this.setGameState('ended');
				window.clearTimeout(gameloopTimeout);
				var winner = this.getPlayer(obj.winnerId);			
				domManager.gameMessage('Game over: ' + winner.playerName + ' won!');

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
				domManager.appendGameList(obj);
				break;
			case 'gameList':
				domManager.buildGameList(obj.games);
				break;
			case 'segments':
				this.handleSegmentsMessage(obj.segments);
				debugSegments = debugSegments.concat(obj.segments);
				break;
			case 'stopSpamming':
				domManager.gameMessage('You are flooding the chat. Your latest message has been blocked');
				break;
			case 'setHost':
				this.setHost(this.getPlayer(obj.playerId));
				if(autoStart)
					this.sendStartGame();
				break;
			case 'joinFailed':
				var msg = 'game already started';
				if(obj.reason == 'notFound') msg = 'game not found';
				else if(obj.reason == 'full') msg = 'game is full';
				else if(obj.reason == 'kicked') msg = 'you are banned for another ' + obj.timer + ' milliseconds';

				domManager.gameMessage('Could not join game: ' + msg);

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
			default:
				domManager.gameMessage('Unknown mode ' + obj.mode + '!');
		}
	};

	GameEngine.removePlayer = function(player) {
		delete players[player.id];
	
		if(this.state == 'waiting' || this.state == 'lobby' || this.state == 'editing' || player.status == 'left' ||
		 (this.state == 'ended' && player.status == 'ready')) {
			this.playerList.removeChild(player.row);
			domManager.resizeChat();
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

		domManager.setKickLinksVisibility(localHost &&
		 (this.state == 'waiting' || this.state == 'ended' || this.state == 'editing'));
	};

	GameEngine.handleSegmentsMessage = function(segments) {
		var ctx = contexts[backupStates.length - 1];
		canvasManager.setLineColor(ctx, [0, 0, 0], 1);
		ctx.lineWidth = 1;
		ctx.beginPath();

		for(var i = 0; i < segments.length; i++) {
			var s = segments[i];

			if(s.x1 != s.x2 || s.y1 != s.y2) {
				ctx.moveTo(s.x1, s.y1);
				ctx.lineTo(s.x2, s.y2);
			}
			else if(debugZeroLengthSegs) {
				ctx.moveTo(s.x1, s.y1);
				ctx.arc(s.x1, s.y1, 5, 0, Math.PI * 2, false);
			}
		}

		ctx.stroke();
		ctx.lineWidth = lineWidth;
	};

	GameEngine.handleSyncResponse = function(serverTime) {
		if(syncTry == -1) {
			ping = 0;
			bestSyncPing = 9999;
			worstSyncPing = 0;
			syncTry = 0;
		}

		var newPing = (Date.now() - this.syncSendTime) / 2;
		if(newPing < bestSyncPing) {
			bestSyncPing = newPing;
			serverTimeDifference = (serverTime + newPing) - Date.now();
		}

		if(newPing > worstSyncPing) {
			ping += worstSyncPing;
			worstSyncPing = ping / (syncTries - 1);
		} else
			ping += newPing / (syncTries - 1);

		if(++syncTry < syncTries) {
			var self = this;
			window.setTimeout(function() { self.syncWithServer(); }, syncTry * syncDelays);
		} else {
			domManager.gameMessage('Your current ping is ' + ping + ' msec');
			if(ultraVerbose)
				domManager.gameMessage('Synced with maximum error of ' + bestSyncPing + ' msec');
			syncTry = -1;
		}
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

		if(this.pencilMode != 'off') {
			pencil.setParameters(obj);
		}
	
		if(this.state == 'editing')
			editor.resize();
	
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

			setPencilMode(obj.pencilmode);
			domManager.updateTitle('Game ' + obj.id);

			var url = new String(window.location);
			var hashPos = url.indexOf('?', 0);

			if(hashPos != -1)
				url = url.substr(0, hashPos);
			url += '?game=' + obj.id;

			document.getElementById('friendInviter').innerHTML = 'Invite your friends by' +
			 ' sending them this link: ' + url;
		}
	};

	GameEngine.requestGame = function(player, minPlayers, maxPlayers) {
		this.sendMsg('requestGame', {'playerName': player.playerName,
		 'minPlayers': minPlayers, 'maxPlayers': maxPlayers});
		this.automatchButton.disabled = true;
	};

	GameEngine.createGame = function() {
		this.sendMsg('createGame', {});
		this.createButton.disabled = true;
	};

	GameEngine.sendMsg = function(mode, data) {
		data.mode = mode;
		var str = JSON.stringify(data);
	
		if(simulatedPing > 0) {
			var that = this;
			window.setTimeout(function() {
				that.websocket.send(str);
				if(ultraVerbose)
					domManager.gameMessage('Sending data: ' + str);
			}, simulatedPing);	
		}
		else{
			this.websocket.send(str);
			if(ultraVerbose)
				domManager.gameMessage('Sending data: ' + str);
		}
	};

	GameEngine.syncWithServer = function() {
		this.syncSendTime = Date.now();
		this.sendMsg('getTime', {});
	};

	GameEngine.addPlayer = function(player) {
		player.color = playerColors[player.index];
		player.segColor = getRGBstring(player.color);
		player.holeColor = getRGBAstring(player.color, holeAlpha);
		player.status = 'ready';
		player.points = 0;
		player.isHost = false;
		players[player.id] = player;
		domManager.appendPlayerList(player);

		if(player == this.localPlayer)
			pencil.updateColor();
	};

	/* sets this.scale, which is canvas size / game size */
	GameEngine.calcScale = function(extraVerticalSpace) {
		var compensation = domManager.sidebarWidth();
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

	GameEngine.unlockStart = function() {
		this.startButton.disabled = false;
		this.startButton.innerHTML = 'Start Game';
		this.unlockTimeout = null;
	};

	GameEngine.sendParams = function() {
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
	};

	GameEngine.sendStartGame = function() {
		var obj = {};

		if(debugMap != null && debugMap != '')
			editor.load(debugMap);
	
		if(editor.mapChanged) {
			obj.segments = editor.segments;
			editor.mapChanged = false;
		}
	
		if(debugComputers > 0)
			for(var i = 0; i < debugComputers; i++)
				this.addComputer();

		this.sendMsg('startGame', obj);
		this.startButton.disabled = true;
	};

	GameEngine.start = function(startPositions, startTime) {
		gameStartTimestamp = startTime - serverTimeDifference - ping
		 + extraGameStartTimeDifference;
		this.setGameState('countdown');
		var delay = gameStartTimestamp - Date.now();

		this.reset();
	
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
			pencil.enable(0);
	
		for(var i in players) {
			var player = players[i];
			if(player.status == 'left')
				player.finalTick = -1;
		}

		if(alwaysHideSidebar || touchDevice)
			domManager.setSidebarVisibility(false);

		this.resize();

		/* set up map segments on all contexts */
		for(var i = 1; i < backupStates.length; i++)
			contexts[i].drawImage(canvases[0], 0, 0, this.width, this.height);

		/* draw angle indicators */
		for(var i = 0; i < startPositions.length; i++)
			this.getPlayer(startPositions[i].playerId).drawIndicator();

		var self = this;
		gameloopTimeout = window.setTimeout(function() { self.realStart(); }, delay + this.tickLength);
		domManager.focusChat();
	};

	GameEngine.revertBackup = function() {
		var ceiledTick = Math.ceil(this.tick);

		/* false alarm, no revert required */
		if(this.correctionTick >= ceiledTick)
			return;

		redraws++;
		this.displayDebugStatus();

		/* calculate closest restore point */
		for(var stateIndex = backupStates.length - 1; this.correctionTick < ceiledTick - backupStates[stateIndex]; stateIndex--);

		/* reset next state to this point */
		for(var i in players) {
			var player = players[i];
			player.states[stateIndex + 1].copyState(player.states[stateIndex]);
		}

		/* copy to next canvas */
		var nextContext = contexts[stateIndex + 1];
		nextContext.drawImage(canvases[stateIndex], 0, 0, this.width, this.height);
		this.correctionTick = ceiledTick - backupStates[stateIndex + 1];

		/* simulate every player up to next backup point */
		this.updateContext(stateIndex + 1, true);
	
		/* not the right place i guess */
		this.handleSegmentsMessage(debugSegments);

		/* recurse all the way until we are at baseCanvas */
		this.revertBackup();
	};

	GameEngine.updateContext = function(stateIndex, floorTick) {
		for(var i in players) {
			var player = players[i];
			var tick = player.isLocal ? this.tick : this.tock;
			tick -= backupStates[stateIndex];

			if(floorTick)
				tick = Math.floor(tick);

			player.simulate(tick, contexts[stateIndex], player.states[stateIndex]);
		}

		this.drawCrosses(stateIndex);
	};

	GameEngine.drawCrosses = function(stateIndex) {
		for(var i = 0, len = crossQueue.length/ 2; i < len; i++)
			canvasManager.drawCross(contexts[stateIndex], crossQueue[2 * i], crossQueue[2 * i + 1]); 

		crossQueue.length = 0;
	};

	GameEngine.measureFPS = function() {
		var dt = this.tickLength * (this.tick - fpsMeasureTick);

		if(dt >= fpsInterval) {
			fps = 1000 * frameCount/ dt;
			fpsMeasureTick = this.tick;
			frameCount = 0;
			this.displayDebugStatus();
		}

		frameCount++;
	};

	GameEngine.gameloop = function() {
		if(this.state != 'playing' && this.state != 'watching')
			return;

		var endTick = (Date.now() - gameStartTimestamp)/ this.tickLength;
		var stateCount = backupStates.length - 1;

		if(displayDebugStatus)
			this.measureFPS();

		while(this.tick < endTick) {
			var nextIntegerTick = Math.floor(this.tick + 1);
			var wholeTick = (this.tick == Math.floor(this.tick));

			/* SIMULATE CPU LAG */
			if(wholeTick && simulateCPUlag && (this.tick % 200 == 199))
				for(var waitStart = Date.now(); Date.now() - waitStart < 4E2;);

			this.revertBackup();

			/* only update the baseCanvas every loop, the rest we can do
			 * on integer ticks */
			if(wholeTick)
				for(var i = 0; i < stateCount; i++)
					this.updateContext(i, true);

			this.updateContext(stateCount, false);

			if(wholeTick) {
				pencil.doTick();
			
				for(var i in players) {
					var player = players[i];
				
					player.pen.doTick();
				}
			}

			this.tick = Math.min(nextIntegerTick, endTick);
			this.correctionTick = Math.ceil(this.tick);
			this.tock = Math.max(0, this.tick - tickTockDifference);
		}

		var self = this;
		var selfCall = function() { self.gameloop(); }

		if(vSync)
			requestAnimFrame(selfCall);
		else
			setTimeout(selfCall, 0);
	};

	GameEngine.realStart = function() {
		this.baseContext.drawImage(canvases[0], 0, 0, this.width, this.height);

		this.audioController.playSound('gameStart');
		this.setGameState('playing');
		this.sendMsg('enableInput', {});
		this.tick = 0;

		this.gameloop();
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
	
		var self = this;
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
			self.rewardNodes = self.rewardNodes.concat(nodes);
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
			this.initContext(contexts[i]);
		}
	
		canvasManager.drawMapSegments(contexts[0]);
		canvasManager.drawPencilSegments(contexts[0]);

		this.correctionTick = -backupStates[1] - 1;
		this.revertBackup();
	};

	GameEngine.initContext = function(ctx) {
		ctx.scale(this.scaleX, this.scaleY);
		ctx.lineWidth = lineWidth;
		ctx.lineCap = lineCapStyle;
		ctx.drawLine = function(x1, y1, x2, y2) {
			ctx.beginPath();
			ctx.moveTo(x1, y1);
			ctx.lineTo(x2, y2);
			ctx.stroke();
		};
	};

	GameEngine.displayDebugStatus = function() {
		if(displayDebugStatus)
			this.debugBox.innerHTML = 'FPS: + ' + fps +
			 '<br/>Reverts: ' + redraws +
			 '<br/>Modified inputs: ' + modifiedInputs + '<br/>Time adjustments: ' +
			 adjustGameTimeMessagesReceived;
	};

	GameEngine.requestKick = function(id) {
		this.sendMsg('kick', {'playerId': id});
	};

	GameEngine.sendChat = function() {
		var msg = this.chatBar.value;

		if(this.state == 'new' || msg.length < 1)
			return;

		this.sendMsg('chat', {'message': msg});
		this.chatBar.value = '';
		this.printChat(this.localPlayer, msg);
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
		pos.subtract(domManager.findPos(e.target));
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
