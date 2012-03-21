/* pencil of local player */
var pencil = (function() {
	var inkDiv, indicator;
	var pos = new Vector(0, 0);
	var ink, outbuffer, down, enabled;
	var mouseDownInk, inkRegen, startInk, inkMinDistance, maxInk;
	
	function sendBuffer() {
		game.sendMsg('pencil', {'data' : outbuffer});
		outbuffer = [];
	}
	
	function move() {
		var seg = pos.link(mouse);
		var d = seg.getLength();
		
		if(ink < d + epsilon) {
			var v = mouse.clone().subtract(pos);
			
			pos.add(v.scale((ink - epsilon) / d).floor());
		}
		else
			mouse.copyTo(pos);
		
		appendpos();
		seg.setEnd(pos);
		canvas.drawSegment(seg, game.localPlayer.color, pencilAlpha);
	}
	
	function appendpos() {
		outbuffer.push(pos.x);
		outbuffer.push(pos.y);
		outbuffer.push(game.tick);
	}
	
	function updateDiv() {
		inkDiv.style.height = ( 100 * Math.max(0, ink) / maxInk ) + '%';
	}
	
	return {
		isLowerable: function() {
			return enabled && !down && ink > mouseDownInk + epsilon;
		}, 
		
		lower: function() {
			if(!pencil.isLowerable())
				return;
				
			mouse.copyTo(pos);
			if(outbuffer.length > 0)
				send();
			outbuffer.push(-1);
			appendpos();
			down = true;
		}, 
		
		raise: function() {
			if(!down)
				return;
				
			move();
			down = false;
		}, 
		
		enable: function(tick) {
			indicator.style.display = 'block';
			enabled = true;
			ink = startInk + inkRegen * (game.tick - tick);
			updateDiv();
		}, 
		
		reset: function() {
			outbuffer = [];
			down = false;
			enabled = false;
			indicator.style.display = 'none';
		}, 
		
		doTick: function() {
			if(!enabled)
				return;
			
			if(down && pos.getDistanceTo(mouse) > inkMinimumDistance + epsilon) {
				move();
			}
			
			ink = Math.min(maxInk, ink + inkRegen);
			updateDiv();

			if(outbuffer.length > 0 && Math.floor(game.tick) % inkBufferTicks == 0) {
				sendBuffer();
			}
		}, 
		
		setParameters: function(obj) {
			if(obj.inkMinimumDistance)
				inkMinDistance = obj.inkMinimumDistance;
			else {
				mouseDownInk = obj.inkmousedown;
				inkRegen = obj.inkregen * 1000 / game.tickLength;
				startInk = obj.inkstart;
				maxInk = obj.inkcap;
			}
		}, 
		
		updateColor: function() {
			inkDiv.style.backgroundColor = getRGBAstring(game.localPlayer.color, 0.5);
		}, 
		
		onload: function() {
			inkDiv = document.getElementById('ink');
			indicator = document.getElementById('inkIndicator');
		}
	};
}());

/* pencil that is controlled by server */
var Pen = function(player) {
	this.seg = [];
	this.pos = new Vector(0, 0);
	this.solidIndex = 0;
	this.visibleIndex = 0;
	this.player = player;
};

Pen.prototype.reset = function() {
	this.seg = [];
	this.pos = new Vector(0, 0);
	this.solidIndex = 0;
	this.visibleIndex = 0;
}

Pen.prototype.doTick = function() {
	if(!this.player.isLocal)
		while(this.visibleIndex < this.seg.length)
			canvas.drawSegment(this.seg[this.visibleIndex++], this.player.color, pencilAlpha);
	
	while(this.solidIndex < this.seg.length && this.seg[this.solidIndex].tick <= game.tick)
		canvas.drawSegment(this.seg[this.solidIndex++], this.player.color, 1);
}