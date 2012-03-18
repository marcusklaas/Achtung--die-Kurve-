PlayerState = function(player) {
	this.player = player;
	this.x = 0;
	this.y = 0;
	this.angle = 0;
	this.turn = 0;
	this.velocity = 0;
	this.tick = 0;
	this.nextInputIndex = 0;
	this.inHole = 0;
	this.dx = 0;
	this.dy = 0;
}

PlayerState.prototype.copyState = function(orig) {
	this.x = orig.x;
	this.y = orig.y;
	this.angle = orig.angle;
	this.turn = orig.turn;
	this.velocity = orig.velocity;
	this.tick = orig.tick;
	this.nextInputIndex = orig.nextInputIndex;
	this.inHole = orig.inHole;
	this.dx = orig.dx;
	this.dy = orig.dy;
	this.tped = orig.tped;
}

PlayerState.prototype.changeCourse = function(angle) {
	var tickLength = this.player.game.tickLength;

	this.angle += angle;
	this.dx = Math.cos(this.angle) * this.velocity * tickLength / 1000;
	this.dy = Math.sin(this.angle) * this.velocity * tickLength / 1000;
}

/* Player */
Player = function(game, isLocal) {
	this.game = game;
	this.isLocal = isLocal;
	this.inputController = (isLocal) ? new InputController(this, keyCodeLeft, keyCodeRight) : null;
	this.states = new Array(backupStates.length);

	/* inits */
	this.status = this.holeColor = this.segColor = '#FFF';
	this.status = 'ready'; // ready, host, alive, dead or left
	this.inbuffer = new Array();
	this.inputs = new Array();
	this.color = new Array();
	this.lastInputTick = this.lastInputTurn = this.finalTick = this.turnSpeed = 0;
	this.points = this.holeStart = this.holeSize = this.holeFreq = 0;
	this.pencilX = this.pencilY = 0;
	this.isHost = false;

	for(var i = 0; i < backupStates.length; i++)
		this.states[i] = new PlayerState(this);
}

Player.prototype.finalSteer = function(obj) {
	var tick = obj.tick;
	
	for(var i = this.inputs.length - 1; i >= 0 && this.inputs[i].tick >= tick; i--);
	this.inputs.length = i + 2;
	this.inputs[i + 1] = new Turn(0, tick, obj.x, obj.y, true);
	this.finalTick = tick;

	if(tick <= Math.ceil(this.states[backupStates.length - 1].tick))
		this.game.correctionTick = Math.min(this.game.correctionTick, tick);
}

Player.prototype.setSegmentStyle = function(ctx, inHole) {
	ctx.strokeStyle = inHole ? this.holeColor : this.segColor;
	ctx.lineCap = inHole ? 'butt' : 'round';
}

Player.prototype.simulate = function(endTick, ctx, state) {
	if(state.tick > endTick || state.tick > this.finalTick)
		return;
	
	var nextInput = this.inputs[state.nextInputIndex];
	this.setSegmentStyle(ctx, state.inHole);

	while(state.tick < endTick) {
		var wholeTick = (state.tick == Math.floor(state.tick));

		if(wholeTick) {
			var inHole = (state.tick > this.holeStart && (state.tick + this.holeStart)
			 % (this.holeSize + this.holeFreq) < this.holeSize);

			if(inHole != state.inHole) {
				state.inHole = inHole;
				this.setSegmentStyle(ctx, inHole);
			}

			state.tped = false;
		}

		if(state.tped) {
			state.tick = Math.min(Math.floor(state.tick + 1), endTick);
			continue;
		}
		
		if(wholeTick && nextInput != null && nextInput.tick == state.tick) {
			if(nextInput.finalTurn) {
				ctx.drawLine(state.x, state.y, nextInput.x, nextInput.y);
				this.game.crossQueue.push(state.x = nextInput.x);
				this.game.crossQueue.push(state.y = nextInput.y);
				state.tick++;
				return;
			} else {
				state.turn = nextInput.turn;
				nextInput = this.inputs[++state.nextInputIndex];
			}
		}

		if(wholeTick && state.turn != 0)
			state.changeCourse(state.turn * this.turnSpeed  * this.game.tickLength / 1000);
		
		var stepSize = Math.min(1, endTick - state.tick);
		var nextX = state.x + state.dx * stepSize;
		var nextY = state.y + state.dy * stepSize;
		var obj = this.game.getCollision(state.x, state.y, nextX, nextY);
		var handled = false;
		
		if(obj != null && obj.isTeleport) {
			ctx.drawLine(state.x, state.y, obj.collisionX, obj.collisionY);
			state.changeCourse(obj.extraAngle);
			
			state.x = obj.destX + Math.cos(state.angle) / 10;
			state.y = obj.destY + Math.sin(state.angle) / 10;
			state.tped = true;
			handled = true;
		}
		
		if(!handled) {
			ctx.drawLine(state.x, state.y, state.x = nextX, state.y = nextY);
			
			/* wrap around */
			if(this.game.torus && (state.x < 0 || state.x > this.game.width ||
				state.y < 0 || state.y > this.game.height)) {
				if(state.x > this.game.width)
					state.x = 0;
				else if(state.x < 0)
					state.x = this.game.width;

				if(state.y > this.game.height)
					state.y = 0;
				else if(state.y < 0)
					state.y = this.game.height;
			}
		}
		
		state.tick = Math.min(Math.floor(state.tick + 1), endTick);
	}
}

Player.prototype.updateRow = function() {
	if(this.status == 'left')
		this.row.className = 'left';
		
	if(this.game.type != 'lobby')
		this.row.childNodes[0].style.color = getRGBstring(this.color);

	this.row.childNodes[1].innerHTML = this.status;
	this.row.childNodes[2].innerHTML = this.points;
}

Player.prototype.initialise = function(x, y, angle, holeStart) {
	var startState = this.states[0];
	startState.velocity = this.game.velocity;
	startState.inHole = false;
	startState.x = x;
	startState.y = y;
	startState.nextInputIndex = 0;
	startState.angle = angle;
	startState.changeCourse(0);
	startState.turn = 0;
	startState.tick = 0;
	startState.tped = false;

	for(var i = 1; i < backupStates.length; i++)
		this.states[i].copyState(startState);

	this.status = 'alive';
	this.inputs.length = 0;
	this.lastInputTick = -1;
	this.lastInputTurn = 0;
	this.finalTick = Infinity;
	this.turnSpeed = this.game.turnSpeed;
	this.holeStart = holeStart;
	this.holeSize = this.game.holeSize;
	this.holeFreq = this.game.holeFreq;
	this.updateRow();

	if(this.inputController != null)
		this.inputController.reset();
}

Player.prototype.drawIndicator = function() {
	var ctx = this.game.baseContext;
	var x = this.states[0].x;
	var y = this.states[0].y;
	var angle = this.states[0].angle;

	drawIndicatorArrow(ctx, x, y, angle, this.color);
	
	/* draws name next to indicator */
	var text = this.isLocal ? 'YOU' : this.playerName;
	ctx.fillStyle = getRGBstring(this.color);
	ctx.font = 'bold ' + indicatorFont + 'px Helvetica, sans-serif';
	ctx.textBaseline = 'bottom';
	var w = ctx.measureText(text).width;
	x -= (Math.cos(angle) > 0 && Math.sin(angle) < 0 ? w + 2 : 0);
	y -= 3;
	ctx.fillText(text, Math.min(this.game.width - w, Math.max(0, x)), y);
}
