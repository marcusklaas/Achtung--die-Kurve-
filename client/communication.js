/* Receiver */
var receiver = (function() {
	return {
		handlePencilMessage: function(msg, player) {
			var tickSolid = msg.readTick();
			var reset = msg.readBool();
			var pen = player.pen;
			
			if(reset)
				pen.pos = msg.readPos();
			
			while(msg.at < msg.data.length) {
				var pos = msg.readPos();
				var seg = new TimedSegment(pen.pos.x, pen.pos.y, pos.x, pos.y, tickSolid);
				
				pen.seg.push(seg);
				tickSolid++;
				pen.pos = pos;
			}
		}
	};
}());

/* Byte Message */
ByteMessage = function(data, at) {
	this.data = data;
	this.at = at;
}

ByteMessage.prototype.readPos = function() {
	var x, y;
	var a = this.data.charCodeAt(this.at++);
	var b = this.data.charCodeAt(this.at++);
	var c = this.data.charCodeAt(this.at++);
	
	x = a | (b & 15) << 7;
	y = b >> 4 | c << 3;
	
	return new Vector(x, y);
}

ByteMessage.prototype.readTick = function() {
	var a = this.data.charCodeAt(this.at++);
	var b = this.data.charCodeAt(this.at++);
	var c = this.data.charCodeAt(this.at++);
	
	return a | b << 7 | c << 14;
}

ByteMessage.prototype.readBool = function() {
	return this.data.charCodeAt(this.at++);
}
