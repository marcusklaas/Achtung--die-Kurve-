window.onload = function() {
	game = new GameEngine();
	mouse = new Vector(0, 0);
	pencil.onload();
	editor.onload(); 	
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

		game.setSidebarVisibility(true);

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
	
	/* Set event listeners for buttons */
	game.connectButton.addEventListener('click', connect, false);
	game.automatchButton.addEventListener('click', reqGame, false);
	game.createButton.addEventListener('click', function() { game.createGame(); }, false);
	game.startButton.addEventListener('click', function() { game.sendStartGame(); }, false);

	game.leaveButton.addEventListener('click', function() {
		game.leaveGame();
	}, false);

	game.disconnectButton.addEventListener('click', function() {
		game.websocket.close(1000);
	}, false);

	game.backButton.addEventListener('click', function() {
		game.setGameState('waiting');
		game.backToGameLobby();
	}, false);
	
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

	/* for debug purposes */
	if(window.location.href.indexOf('C:/Dropbox') != -1) {
		playerName = 'piet';
		document.getElementById('minplayers').value = '1';
		enableSound = false;
	}
	echo = function(msg) {game.gameMessage(msg);}
		
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
			if(onlyAllowReplacement && game.paramTimeout == undefined) // FIXME: undefined niet nice
				return;
				
			window.clearTimeout(game.paramTimeout);
		
			game.paramTimeout = window.setTimeout(function() {
				game.sendParams();
				game.paramTimeout = undefined; // FIXME: niet doen
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

	/* add event handlers to schedule paramupdate message when game options are changed */
	var inputElts = document.getElementById('details').getElementsByTagName('input');
	for(var i = 0; i < inputElts.length; i++) {
		if(inputElts[i].type == 'text' || inputElts[i].type == 'number') {
			inputElts[i].addEventListener('input', sendParams(paramInputInterval, false), false);
			inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, true), false);
		} else 
			inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, false), false);
	}

	if(displayDebugStatus)
		game.debugBox.style.display = 'block';
}
