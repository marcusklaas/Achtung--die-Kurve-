/* pencil of local player */
function createPencil(game, mouse) {
	var canvasManager = game.canvasManager;
	var mouse = game.mouse;
	var inkDiv, indicator;
	var pos = new Vector(0, 0);
	var outbuffer = new Array()
	var ink, down, enabled;
	var mouseDownInk, inkRegen, startInk, inkMinDistance, maxInk;
	
	function sendBuffer() {
		game.sendMsg('pencil', {'data' : outbuffer});
		outbuffer.length = 0;
	}
	
	function move() {
		var seg = pos.link(mouse);
		var d = seg.getLength();
		
		if(ink < d + epsilon) {
			down = false;
			
			if(ink < epsilon)
				return;
			
			var v = mouse.clone().subtract(pos);
			v.scale((ink - epsilon) / d);
			v.x = v.x < 0 ? Math.ceil(v.x) : Math.floor(v.x);
			v.y = v.y < 0 ? Math.ceil(v.y) : Math.floor(v.y);
			pos.add(v);
			ink -= v.getLength();
		}
		else {
			mouse.copyTo(pos);
			ink -= d;
		}
		
		appendpos();
		seg.setEnd(pos);
		canvasManager.drawSegment(seg, game.localPlayer.color, pencilAlpha);
	}
	
	function appendpos() {
		outbuffer.push(pos.x);
		outbuffer.push(pos.y);
		outbuffer.push(Math.floor(game.tick));
	}
	
	function updateDiv() {
		inkDiv.style.height = ( 100 * Math.max(0, ink) / maxInk ) + '%';
	}
	
	return {
		isLowerable: function() {
			return enabled && !down && ink > mouseDownInk + epsilon + inkMinDistance;
		}, 
		
		lower: function() {
			if(!this.isLowerable()) // was eerst pencil.isLowerable() maar global pencil bestaat niet meer.. dit zou ook moeten werken (tog?) anders deze literal ff naam geven (bijv pencil ;P)
				return;
				
			mouse.copyTo(pos);
			if(outbuffer.length > 0)
				sendBuffer();
			outbuffer.push(-1);
			appendpos();
			down = true;
			ink -= mouseDownInk;
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
			ink = startInk + inkRegen * (Math.floor(game.tick) - tick);
			updateDiv();
		}, 
		
		reset: function() {
			outbuffer.length = 0;
			down = false;
			enabled = false;
			indicator.style.display = 'none';
		}, 
		
		doTick: function() {
			if(!enabled)
				return;
			
			if(down && pos.getDistanceTo(mouse) > inkMinDistance + epsilon) {
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
				inkRegen = obj.inkregen / 1000 * game.tickLength;
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
}

/* pencil that is controlled by server */
var Pen = function(player) {
	this.seg;
	this.pos;
	this.solidIndex = 0;
	this.visibleIndex = 0;
	this.player = player;
}

Pen.prototype.reset = function() {
	this.seg = [];
	this.pos = new Vector(0, 0);
	this.solidIndex = 0;
	this.visibleIndex = 0;
}

Pen.prototype.doTick = function() {
	var canvasManager = this.player.game.canvasManager;
	
	if(!this.player.isLocal)
		while(this.visibleIndex < this.seg.length)
			canvasManager.drawSegment(this.seg[this.visibleIndex++], this.player.color, pencilAlpha);
	
	while(this.solidIndex < this.seg.length && this.seg[this.solidIndex].tick <= game.tick)
		canvasManager.drawSegment(this.seg[this.solidIndex++], this.player.color, 1);
}
