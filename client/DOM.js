function createDomManager(game) {
	var playerList;
	var gameList;
	var chatBar;
	var sidebar;
	var debugBox;
	var connectButton;
	var automatchButton;
	var createButton;
	var leaveButton;
	var disconnectButton;
	var backButton;
	var startButton;
	var hostContainer;
	var addComputerEasyButton;
	var addComputerHardButton;
	var nonhostContainer;
	
	var resizeTimeout = null;
	var paramTimeout = null;
	var unlockTimeout = null;
	
	function unlockStart() {
		startButton.disabled = false;
		startButton.innerHTML = 'Start Game';
		unlockTimeout = null;
	};
	
	function setOptionVisibility(target) {
		var sections = ['disconnect', 'stop', 'back'];

		for(var i = 0; i < sections.length; i++) {
			var elt = document.getElementById(sections[i]);
			elt.style.display = (target == sections[i]) ? 'block' : 'none';
		}
	};

	function setContentVisibility(target) {
		var sections = ['connectionContainer', 'gameListContainer', 'editor',
		 'waitContainer', 'gameContainer'];

		for(var i = 0; i < sections.length; i++) {
			var elt = document.getElementById(sections[i]);

			if(target == sections[i])
				elt.classList.add('contentVisible');
			else
				elt.classList.remove('contentVisible');
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

	function resizeWindow() {
		if(game.state == 'editing')
			editor.resize();

		else if(game.state == 'playing' || game.state == 'watching' || 
		 game.state == 'ended' || game.state == 'countdown')
			game.resize();

		resizeChat();
	}
	
	function scheduleWindowResize() {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(resizeWindow, resizeDelay);
	}
	
	function sendParams(timeout, onlyAllowReplacement) {
		return function() {
			if(game.host != game.localPlayer || game.state != 'waiting')
				return;
			
			/* onlyAllowReplacement allows us not to send the params when it is not
			 * needed. ie, when we already sent the params after an onInput event.
			 * onChange would then still fire, which is annoying if you just pressed
			 * start game */
			if(onlyAllowReplacement && paramTimeout == null)
				return;
				
			window.clearTimeout(paramTimeout);
		
			paramTimeout = window.setTimeout(function() {
				game.sendParams();
				paramTimeout = null;
			}, timeout);

			startButton.disabled = true;
			startButton.innerHTML = 'Please wait';

			if(unlockTimeout !== null)
				window.clearTimeout(unlockTimeout);

			unlockTimeout = window.setTimeout(unlockStart, unlockInterval + timeout);
		}
	}
	
	function connect() {
		var playerName = document.getElementById('playername').value;

		domManager.setSidebarVisibility(true);

		if(typeof playerName != 'string' || playerName.length < 1 || playerName.length > maxNameLength) {
			domManager.gameMessage('Enter a cool nickname please (no longer than ' + maxNameLength + ' chars)');
			return;
		}

		setCookie('playerName', game.localPlayer.playerName = playerName, 30);

		game.connect(serverURL, 'game-protocol', function() {
			game.joinLobby(game.localPlayer);
		});
		
		connectButton.disabled = true;
		connectButton.innerHTML = 'Connecting...';
	}

	function reqGame() {
		var maxPlayers = parseInt(document.getElementById('maxplayers').value);
		var minPlayers = parseInt(document.getElementById('minplayers').value);
	
		if(maxPlayers > 8 || maxPlayers < 1 || minPlayers > 8 || minPlayers < 1
		 || minPlayers > maxPlayers) {
			domManager.gameMessage('Min/ maxplayers unacceptable!');
			return;
		}

		setCookie('maxPlayers', maxPlayers, 30);
		setCookie('minPlayers', minPlayers, 30);
		automatchButton.disabled = true;
		
		game.sendMsg('requestGame', {'minPlayers': minPlayers, 'maxPlayers': maxPlayers});
	}
	
	setKickLinksVisibility = function(showLinks) {
		var kickLinks = playerList.getElementsByTagName('a');

		for(var i = 0; i < kickLinks.length; i++)
			kickLinks[i].className = showLinks ? 'close' : 'close hidden';
	};

	function domManager() {
		/* public vars */
	}

	domManager.onload = function() {
		playerList = document.getElementById('playerList').lastChild;
		gameList = document.getElementById('gameList').lastChild;
		chatBar = document.getElementById('chat');
		sidebar = document.getElementById('sidebar');
		debugBox = document.getElementById('status');
		connectButton = document.getElementById('connect');
		automatchButton = document.getElementById('automatch');
		createButton = document.getElementById('createGame');
		leaveButton = document.getElementById('stop');
		disconnectButton = document.getElementById('disconnect');
		backButton = document.getElementById('back');
		startButton = document.getElementById('startGame');
		hostContainer = document.getElementById('hostContainer');
		addComputerHardButton = document.getElementById('addComputerHard');
		addComputerEasyButton = document.getElementById('addComputerEasy');
		nonhostContainer = document.getElementById('nonhostContainer');
		
		if(displayDebugStatus)
			debugBox.style.display = 'block';
			
		window.onresize = scheduleWindowResize;

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
		
		/* hide alert box for browsers with websockets */
		if('WebSocket' in window || 'MozWebSocket' in window)
			document.getElementById('noWebsocket').style.display = 'none';
		
		/* add event handlers to schedule paramupdate message when game options are changed */
		var inputElts = document.getElementById('details').getElementsByTagName('input');
		
		for(var i = 0; i < inputElts.length; i++) {
			if(inputElts[i].type == 'text' || inputElts[i].type == 'number') {
				inputElts[i].addEventListener('input', sendParams(paramInputInterval, false), false);
				inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, true), false);
			}
			else 
				inputElts[i].addEventListener('change', sendParams(paramUpdateInterval, false), false);
		}
		
		/* add listener for chat submit */
		document.getElementById('chatForm').addEventListener('submit', function(e) {
			var msg = chatBar.value;
			chatBar.value = '';

			if(msg.length < 1)
				return;

			game.sendMsg('chat', {'message': msg});
			domManager.printChat(game.localPlayer, msg);
			e.preventDefault();
		}, false);
		
		/* Set event listeners for buttons */
		connectButton.addEventListener('click', connect, false);
		automatchButton.addEventListener('click', reqGame, false);
		startButton.addEventListener('click', function() {
			game.sendStartGame();
			startButton.disabled = true;
		}, false);
		
		createButton.addEventListener('click', function() {
			game.sendMsg('createGame', {});
			createButton.disabled = true;
		}, false);

		leaveButton.addEventListener('click', function() {
			game.leaveGame();
			leaveButton.disabled = true;
		}, false);

		disconnectButton.addEventListener('click', function() {
			game.disconnect();
		}, false);

		backButton.addEventListener('click', function() {
			game.setGameState('waiting');
			game.backToGameLobby();
		}, false);
	
		addComputerEasyButton.addEventListener('click', function() {
			game.addComputer('easy');
		}, false);
		
		addComputerHardButton.addEventListener('click', function() {
			game.addComputer('hard');
		}, false);

		/* load cookie data */
		var minPlayers = getCookie('minPlayers');
		if(minPlayers != null)
			document.getElementById('minplayers').value = minPlayers;
	
		var maxPlayers = getCookie('maxPlayers');
		if(maxPlayers != null)
			document.getElementById('maxplayers').value = maxPlayers;
	
		var playerName = getCookie('playerName');
	
		/* for debugging purposes */
		if(location.href.indexOf('C:/Dropbox') != -1) {
			playerName = 'piet';
			document.getElementById('sound').checked = false;
			game.audioController.enableSound = false;
			document.getElementById('minplayers').value = 1;
		}
	
		/* auto connect if name is known */
		if(playerName != null && playerName != '') {
			document.getElementById('playername').value = playerName;
			connect();
		}
	};
	
	domManager.setDebugMessage = function(msg) {
		debugBox.innerHTML = msg;
	};
	
	domManager.setWaitMessage = function(customGame) {
		nonhostContainer.innerHTML = customGame ? customGameWaitMessage :
		 autoMatchWaitMessage;
	};
	
	domManager.newHost = function(localHost) {
		hostContainer.style.display = localHost ? 'block' : 'none';
		nonhostContainer.style.display = localHost ? 'none' : 'block';

		var inputElts = document.getElementById('details').getElementsByTagName('input');
		for(var i = 0; i < inputElts.length; i++)
			inputElts[i].disabled = !localHost;

		setKickLinksVisibility(localHost &&
		 (this.state == 'waiting' || this.state == 'ended' || this.state == 'editing'));
	};

	domManager.updateTitle = function(title) {
		document.getElementById('gameTitle').innerHTML = title;
	};

	domManager.appendPlayerList = function(player) {
		var row = document.createElement('tr');
		var nameNode = document.createElement('td');
		var nameSpan = document.createElement('span');
		var kickLink = document.createElement('a');
		var statusNode = document.createElement('td');
		var pointsNode = document.createElement('td');

		nameSpan.innerHTML = player.playerName;
		nameSpan.className = 'noverflow';
		player.row = row;

		kickLink.className = game.host == game.localPlayer ? 'close' : 'close hidden';
		kickLink.innerHTML = 'x';
		kickLink.addEventListener('click', function() { game.requestKick(parseInt(player.id)); });

		playerList.appendChild(row);
		if(player != game.localPlayer)
			nameNode.appendChild(kickLink);
		nameNode.appendChild(nameSpan);
		row.appendChild(nameNode);
		row.appendChild(statusNode);
		row.appendChild(pointsNode);
		player.updateRow();
		resizeChat();
	};

	domManager.clearPlayerList = function() {
		while(playerList.hasChildNodes())
			playerList.removeChild(playerList.firstChild);

		resizeChat();
	};
	
	domManager.splicePlayerList = function(player) {
		playerList.removeChild(player.row);
		resizeChat();
	};

	domManager.sortPlayerList = function() {
		var rows = playerList.getElementsByTagName('tr');
		var arr = new Array(rows.length);

		for (var i = 0; i < rows.length; i++)
			arr[i] = rows[i];

		arr.sort(function(row1, row2) {
			var score1 = parseInt(row1.lastChild.innerHTML);
			var score2 = parseInt(row2.lastChild.innerHTML);
			return score1 == score2 ? 0 : (score1 > score2 ? -1 : 1);
		});

		for(var i = 1; i < rows.length; i++)
			if(arr[i] != playerList.lastChild) {
				playerList.removeChild(arr[i]);
				playerList.appendChild(arr[i]);
			}
	};

	domManager.buildGameList = function(list) {
		var startedGames = new Array();

		while(gameList.hasChildNodes())
			gameList.removeChild(gameList.firstChild);

		document.getElementById('noGames').style.display = 'block';

		for(var i = 0; i < list.length; i++)
			if(startedGamesDisplay != 'below' && list[i].state == 'started')
				startedGames.push(list[i]);
			else
				this.appendGameList(list[i]);

		if(startedGamesDisplay == 'below')
			for(var i = 0; i < startedGames.length; i++)
				this.appendGameList(startedGames[i]);
	};

	domManager.appendGameList = function(obj) {
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
		nameSpan.innerHTML = obj.host != undefined ? obj.host : '-'; // FIXME: undefined is nooit nice
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
		button.addEventListener('click', function() { game.joinGame(obj.id); });

		node = document.createElement('td');
		node.appendChild(button);
		row.appendChild(node);

		gameList.appendChild(row);
	};
	
	domManager.setGameState = function(oldState, newState) {
		if(newState == 'new' || oldState == 'new') {
			var display = newState == 'new' ? 'none' : 'block';
			document.getElementById('playerListContainer').style.display = display;
			document.getElementById('gameTitle').style.display = display;
			document.getElementById('chatForm').style.display = display;
		}
	
		if(newState == 'waiting' || newState == 'lobby' || newState == 'new') {
			document.getElementById('gameTitle').className = '';
			document.getElementById('goalDisplay').style.display = 'none';
		}

		switch(newState) {
			case 'lobby':
				setOptionVisibility('disconnect');
				setContentVisibility('gameListContainer');
				createButton.disabled = automatchButton.disabled = false;
				break;
			case 'editing':
				setContentVisibility('editor');
				break;
			case 'countdown':
				setContentVisibility('gameContainer');
				setKickLinksVisibility(false);
				document.getElementById('gameTitle').className = 'leftSide';
				document.getElementById('goalDisplay').style.display = 'block';
				break;
			case 'waiting':
				setOptionVisibility('stop');
				setContentVisibility('waitContainer');
				startButton.disabled = false;
				leaveButton.disabled = false;
				break;
			case 'playing':
				setOptionVisibility('stop');
				break;
			case 'ended':
				if(this.setSidebarVisibility(true))
					game.resize();

				setKickLinksVisibility(game.host == game.localPlayer);

				if(game.type == 'custom')
					setOptionVisibility('back');
				break;
			case 'new':
				setContentVisibility('connectionContainer');
				setOptionVisibility('nothing');
				connectButton.disabled = false;
				connectButton.innerHTML = 'Connect';
		}
	};

	domManager.focusChat = function() {
		if(!touchDevice)
			chatBar.focus();
	};

	domManager.gameMessage = function(msg) {
		var container = document.getElementById('messages');
		var elt = document.createElement('li');

		elt.innerHTML = msg;
		elt.className = 'gameMessage';
		container.insertBefore(elt, container.firstChild);
	};

	domManager.printChat = function(player, message) {
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
	};

	domManager.setSidebarVisibility = function(visible) {
		if(visible == (sidebar.classList.contains('visible')))
			return false;

		sidebar.classList.toggle('visible');
		document.getElementById('menuButton').innerHTML = visible ? '&lt;' : '&gt;';

		var articles = document.getElementsByTagName('article');
		for(var i = 0; i < articles.length; i++)
			articles[i].classList.toggle('translated');

		return true;
	};

	domManager.sidebarWidth = function() {
		return sidebar.classList.contains('visible') ? sidebarWidth : 0;
	};

	domManager.toggleSidebar = function() {
		this.setSidebarVisibility(!sidebar.classList.contains('visible'));
		game.resize();
	};

	domManager.findPos = function(obj) {
		var curleft = curtop = 0;
		if (obj.offsetParent) {
			do {
				curleft += obj.offsetLeft;
				curtop += obj.offsetTop;
			} while(obj = obj.offsetParent);
		}

		return new Vector(curleft, curtop);
	};

	return domManager;
}
