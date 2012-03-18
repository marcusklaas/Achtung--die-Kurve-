/* we set all properties in the constructor so the compiler does not have to add
 * properties later (and you can see what properties an object has by looking
 * at its constructor) */
function Pencil(game) {
	this.game = game;
	this.inkDiv = document.getElementById('ink');
	this.indicator = document.getElementById('inkIndicator');
	this.outbuffer = new Array();

	// just initializing, set dummy value to hint type to compiler
	this.lastTick = this.curY = this.y = this.curX = this.x = this.ink = 0;
	this.mousedownInk = this.startInk = this.maxInk = this.inkPerSec = 0;
	this.drawingAllowed = this.down = this.upped = true;
}

/* pos is scaled location */
Pencil.prototype.startDraw = function(pos) {
	this.ink -= this.mousedownInk;
	this.curX = this.x = pos.x;
	this.curY = this.y = pos.y;
	this.outbuffer.push(1);
	this.outbuffer.push(this.x);
	this.outbuffer.push(this.y);
	this.outbuffer.push(this.game.tick);
	this.down = true;
}

Pencil.prototype.enable = function(tick) {
	this.indicator.style.display = 'block';
	this.drawingAllowed = true;
	this.setInk(this.startInk + this.inkPerSec / 1000 * this.game.tickLength * (this.game.tick - tick));
}

Pencil.prototype.reset = function() {
	this.lastTick = 0;
	this.outbuffer.length = 0;
	this.down = false;
	this.upped = false;
	this.drawingAllowed = false;
	this.indicator.style.display = 'none';

	for(var i in this.game.players) {
		var player = this.game.players[i];
		player.inbuffer.length = 0;
		player.inbufferIndex = 0;
	}
}

Pencil.prototype.setInk = function(ink) {
	this.ink = Math.min(this.maxInk, ink);
	this.inkDiv.style.height = ( 100 * Math.max(0, this.ink) / this.maxInk ) + '%';
}

Pencil.prototype.doTick = function(tick) {
	if(this.drawingAllowed) {
		var dt = tick - this.lastTick;
		this.setInk(this.ink + this.inkPerSec / 1000 * dt * this.game.tickLength);
	}

	this.lastTick = tick;

	if(this.drawingAllowed && (this.down || this.upped)) {
		var x = this.curX;
		var y = this.curY;
		var d = getLength(x - this.x, y - this.y);

		if(this.upped || d >= this.inkMinimumDistance) {
			if(this.ink < d) {
				// shorten move
				var a = x - this.x;
				var b = y - this.y;
				a *= this.ink / d;
				b *= this.ink / d;
				x = this.x + a;
				y = this.y + b;
				d = this.ink;
				
				this.down = false;
				this.upped = true;

				this.game.focusChat();
			}
			this.setInk(this.ink - d);
			this.outbuffer.push(this.upped ? -1 : 0);
			this.outbuffer.push(x);
			this.outbuffer.push(y);
			this.outbuffer.push(this.game.tick);

			this.drawGlobal(this.x, this.y, x, y, this.game.localPlayer, pencilAlpha);

			this.x = x;
			this.y = y;
			this.upped = false;
		}
	}

	if(Math.floor(this.game.tick) % inkBufferTicks == 0 && this.outbuffer.length > 0) {
		this.game.sendMsg('pencil', {'data' : this.outbuffer});
		this.outbuffer.length = 0;
	}

	this.drawPlayerSegs(false);
}

Pencil.prototype.drawPlayerSegs = function(redraw) {
	for(var i in this.game.players) {
		var player = this.game.players[i];
		
		if(player.status == 'ready')
			return;
		
		var buffer = player.inbuffer;
		
		for(var index = redraw ? 0 : player.inbufferIndex; index < buffer.length; index++) {
			var seg = buffer[index];
			var solid = seg.tickSolid <= this.game.tick;
			if(!solid && !redraw)
				break;

			this.drawGlobal(seg.x1, seg.y1, seg.x2, seg.y2, player, solid ? 1 : pencilAlpha);
		}
		
		if(!redraw)
			player.inbufferIndex = index;
	}
}

Pencil.prototype.drawGlobal = function(x1, y1, x2, y2, player, alpha) {
	for(var i = 0; i < backupStates.length; i++)
		this.drawSegment(this.game.contexts[i], x1, y1, x2, y2, player, alpha);
}

Pencil.prototype.drawSegment = function(ctx, x1, y1, x2, y2, player, alpha) {
	if(x1 == x2 && y1 == y2)
		return;

	ctx.beginPath();
	setLineColor(ctx, player.color, alpha);
	var tmp = ctx.lineCap;
	ctx.lineCap = alpha == 1 ? lineCapStyle : 'butt';
	ctx.moveTo(x1, y1);
	ctx.lineTo(x2, y2);
	ctx.stroke();
	ctx.lineCap = tmp;
}

Pencil.prototype.handleMessage = function(msg, player) {
	var lastTick = -1;
	
	while(msg.at < msg.data.length) {
		var pos = msg.readPos();
		var pen = msg.readPencil();
		
		if(!pen.down) {
			var tick;
			
			if(lastTick == -1) {
				msg.at--;
				pen = msg.readPencilFull();
				tick = pen.tick;
			} else {
				tick = lastTick + pen.tickDifference;
			}
			
			var seg = new TimedSegment(player.pencilX, player.pencilY, pos.x, pos.y, tick);
	
			if(player != this.game.localPlayer)
				this.drawGlobal(seg.x1, seg.y1, seg.x2, seg.y2, player, pencilAlpha);

			player.inbuffer.push(seg);
			lastTick = tick;
		}
		
		player.pencilX = pos.x;
		player.pencilY = pos.y;
	}
}
