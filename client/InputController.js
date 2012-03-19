function touchEvent(x, y, identifier) {
	this.startX = x;
	this.startY = y;
	this.identifier = identifier;
}

/* input control for steering and drawing. unified for both mouse/ keyboard and touch */
function InputController(player, left, right) {	
	this.rightKeyCode = left;
	this.leftKeyCode = right;
	this.player = player;
	this.leftDown = false;
	this.rightDown = false;
	this.leftTouch = null;
	this.rightTouch = null;
	this.pencilTouch = null;
	this.lastSteerTick = -1;
	this.lastSteerTurn = 0;

	var self = this;
	var game = player.game;
	var canvas = player.game.baseCanvas;

	/* listen for keyboard events */
	window.addEventListener('keydown', function(e) {
		if(game.state == 'editing' && document.activeElement != game.chatBar
			&& game.editor.modal.style.display != "block") {
			switch(String.fromCharCode(e.keyCode)) {
				case 'U':
					game.editor.undo();
					break;

				case 'P': case '1':
					simulateClick(game.editor.pencilButton);
					break;

				case 'L': case '2':
					simulateClick(game.editor.lineButton);
					break;

				case 'S': case '3':
					simulateClick(game.editor.playerStartButton);
					break;

				case 'T': case '4':
					simulateClick(game.editor.teleportButton);
					break;

				case 'E': case '5':
					simulateClick(game.editor.eraserButton);
					break;

				default:
					return;
			}

			e.preventDefault();
			return;
		}

		if(self.player.status != 'alive' || game.state != 'playing')
			return;

		if(e.keyCode == self.leftKeyCode) {
			self.pressLeft();
			e.preventDefault();
		}
		else if(e.keyCode == self.rightKeyCode) {
			self.pressRight();
			e.preventDefault();
		}
	}, false);

	window.addEventListener('keyup', function(e) {
		if(self.player.status != 'alive' || game.state != 'playing')
			return;

		if(e.keyCode == self.leftKeyCode) {
			self.releaseLeft();
			e.preventDefault();
		}
		else if(e.keyCode == self.rightKeyCode) {
			self.releaseRight();
			e.preventDefault();
		}
	}, false);

	function convertMouseToTouch(e) {
		e.identifier = 1;
		return {changedTouches: [e]};
	}

	function mouseMove(e) {
		game.copyGamePos(e, mouse);
	}

	function mouseDown(e) {
		game.copyGamePos(e, mouse);
		pencil.lower();
	}

	function mouseEnd(e) {
		game.copyGamePos(e, mouse);
		if(emulateTouch)
			touchEnd(convertMouseToTouch(e));
		else
			pencil.raise();
	}

	function touchStart(e) {
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = game.getGamePos(touch);
			var totalWidth = game.width;
			var right = (pos.x <= totalWidth * steerBoxSize);  // FIXME: dit is precies andersom als hoe t zou moeten -- hoe kan dit?
			var left = (pos.x >= (1 - steerBoxSize) * totalWidth);

			if(self.player.status == 'alive' && left && self.leftTouch === null) {
				self.leftTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				self.pressLeft();
			}

			else if(self.player.status == 'alive' && right && self.rightTouch === null) {
				self.rightTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				self.pressRight();
			}

			else if(self.pencilTouch == null && pencil.isLowerable()) {
				self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
				pos.copyTo(mouse);
				pencil.lower();
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	function touchEnd(e) {
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];

			if(self.player.status == 'alive' && self.leftTouch != null &&
			 touch.identifier == self.leftTouch.identifier) {
				self.releaseLeft();
				self.leftTouch = null;
			}

			else if(self.player.status == 'alive' && self.rightTouch != null &&
			 touch.identifier == self.rightTouch.identifier) {
				self.releaseRight();
				self.rightTouch = null;
			}

			else if(self.pencilTouch != null &&
			 touch.identifier == self.pencilTouch.identifier) {
				stopDraw(touch);
				self.pencilTouch = null;
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	function touchMove(e) {
		if(game.state != 'playing') {
			if(game.state == 'countdown' && e.cancelable)
				e.preventDefault();
			return;
		}

		for(var i = 0; i < e.changedTouches.length; i++) {
			var touch = e.changedTouches[i];
			var pos = game.getGamePos(touch);
			var totalWidth = game.width;
			var right = (pos.x <= totalWidth * steerBoxSize);
			var left = (pos.x >= (1 - steerBoxSize) * totalWidth);

			if(self.leftTouch != null && touch.identifier == self.leftTouch.identifier) {
				var convert = (getLength(pos.x - self.leftTouch.startX, pos.y - self.leftTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && pencil.isLowerable());

				/* convert this touch to pencil touch */
				if(convert) {
					self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
					pos.copyTo(mouse);
					pencil.lower();
				}

				if(convert || !left) {
					self.releaseLeft();
					self.leftTouch = null;
				}
			}

			else if(self.rightTouch != null && touch.identifier == self.rightTouch.identifier) {
				var convert = (getLength(pos.x - self.rightTouch.startX, pos.y - self.rightTouch.startY) >= pencilTreshold
				 && self.pencilTouch == null && pencil.isLowerable());

				if(convert) {
					self.pencilTouch = new touchEvent(pos.x, pos.y, touch.identifier);
					pos.copyTo(mouse);
					pencil.lower();
				}

				if(convert || !right) {
					self.releaseRight();
					self.rightTouch = null;
				}
			}

			else if(self.pencilTouch != null &&
			 touch.identifier == self.pencilTouch.identifier) {
					pos.copyTo(mouse);
			}
		}

		if(e.cancelable)
			e.preventDefault();
	}

	/* register touches for fancy phones n tablets */
	if(touchDevice) {
		canvas.addEventListener('touchstart', touchStart, false);
		canvas.addEventListener('touchend', touchEnd, false);
		canvas.addEventListener('touchcancel', touchEnd, false);
		canvas.addEventListener('touchmove', touchMove, false);
	}

	/* catch mouse events (not editor!) */
	canvas.addEventListener('mousedown', function(e) {
		if(emulateTouch)
			touchStart(convertMouseToTouch(e));
		else
			mouseDown(e);
	}, false);

	canvas.addEventListener('mousemove', function(e) {
		if(emulateTouch)
			touchMove(convertMouseToTouch(e));
		else
			mouseMove(e);
	}, false);

	canvas.addEventListener('mouseup', mouseEnd, false);
	canvas.addEventListener('mouseout', mouseEnd, false);
}

InputController.prototype.reset = function() {
	this.leftDown = false;
	this.rightDown = false;
	this.leftTouch = null;
	this.rightTouch = null;
	this.pencilTouch = null;
	this.lastSteerTick = -1;
	this.lastSteerTurn = 0;
}

InputController.prototype.pressLeft = function() {
	if(!this.leftDown)
		this.steerLocal(1);

	this.leftDown = true;
}

InputController.prototype.releaseLeft = function() {
	this.steerLocal(this.rightDown ? -1 : 0);
	this.leftDown = false;
}

InputController.prototype.pressRight = function() {
	if(!this.rightDown)
		this.steerLocal(-1);

	this.rightDown = true;
}

InputController.prototype.releaseRight = function() {
	this.steerLocal(this.leftDown ? 1 : 0);
	this.rightDown = false;
}

InputController.prototype.steerLocal = function(turn) {
	if(turn == this.lastSteerTurn)
		return;

	var game = this.player.game;
	var obj = new Turn(turn, Math.ceil(game.tick), 0, 0, false);

	if(this.lastSteerTick == obj.tick)
		obj.tick = ++this.lastSteerTick;
	else
		this.lastSteerTick = obj.tick;

	this.lastSteerTurn = turn;
	this.player.inputs.push(obj);
	game.sendMsg('input', obj);
}
