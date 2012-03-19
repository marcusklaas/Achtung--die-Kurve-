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


var pencilReceiver = (function() {
	return {
		reset: function() {
			for(var i in game.players) {
				var player = game.players[i];
				player.inbuffer = [];
				player.inbufferIndex = 0;
			}
		}, 
		
		doTick: function() {
			return;
			
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
		}, 
		
		handleMessage: function(msg, player) {
			return;
			
			var tickSolid = msg.readTick();
			
			while(msg.at < msg.data.length) {
				var pos = msg.readPos();
								
				if(!pen.down) {
					var tick;
					
					if(lastTick == -1) {
						msg.at--;
						pen = msg.readPencilFull();
						tick = pen.tick;
					} else {
						tick = lastTick + pen.tickDifference;
					}
					
					var seg = {x1: player.pencilX, y1: player.pencilY, x2: pos.x, y2: pos.y, tickSolid: tick};
			
					if(player != this.game.localPlayer)
						this.drawGlobal(seg.x1, seg.y1, seg.x2, seg.y2, player, pencilAlpha);

					player.inbuffer.push(seg);
					lastTick = tick;
				}
				
				player.pencilX = pos.x;
				player.pencilY = pos.y;
			}
		}
	};
}());