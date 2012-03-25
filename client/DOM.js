var domManager = (function() {
	var playerList;
	var gameList;
	var chatBar;
	var resizeTimeout = null;

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

	function domManager() {
		/* public vars */
		this.test = 5;
	}

	domManager.onload = function() {
		playerList = document.getElementById('playerList').lastChild;
		gameList = document.getElementById('gameList').lastChild;
		chatBar = document.getElementById('chat');
	};

	domManager.windowResize = function() {
		clearTimeout(resizeTimeout);
		resizeTimeout = setTimeout(resizeWindow, resizeDelay);
	};

	domManager.setKickLinksVisibility = function(showLinks) {
		var kickLinks = playerList.getElementsByTagName('a');

		for(var i = 0; i < kickLinks.length; i++)
			kickLinks[i].className = showLinks ? 'close' : 'close hidden';
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

	domManager.setOptionVisibility = function(target) {
		var sections = ['disconnect', 'stop', 'back'];

		for(var i = 0; i < sections.length; i++) {
			var elt = document.getElementById(sections[i]);
			elt.style.display = (target == sections[i]) ? 'block' : 'none';
		}
	};

	domManager.setContentVisibility = function(target) {
		var sections = ['connectionContainer', 'gameListContainer', 'editor',
		 'waitContainer', 'gameContainer'];

		for(var i = 0; i < sections.length; i++) {
			var elt = document.getElementById(sections[i]);

			if(target == sections[i])
				elt.classList.add('contentVisible');
			else
				elt.classList.remove('contentVisible');
		}
	};

	return domManager;
}());
