/* Audio controller */
AudioController = function() {
	this.sounds = [];
	this.enableSound = true;
}

AudioController.prototype.onload = function() {
	/* listen to sound checkbox */
	var checkBox = document.getElementById('sound');
	var self = this;
	var soundCookie = getCookie('sound');
	
	if(soundCookie != null & soundCookie == 'false')
		checkBox.checked = this.enableSound = false;

	checkBox.addEventListener('change', function(e) {
		self.enableSound = checkBox.checked;
		setCookie('sound', checkBox.checked ? 'true' : 'false', 30);
	});
	
	/* add sounds */
	//this.addSound('localDeath', 'sounds/wilhelm', ['ogg', 'mp3']);
	//this.addSound('localDeath', 'sounds/loser', ['ogg', 'mp3']);
	this.addSound('countdown', 'sounds/countdown', ['ogg', 'mp3']);
	this.addSound('playerLeft', 'sounds/doorclose', ['ogg', 'mp3']);
	this.addSound('newPlayer', 'sounds/playerjoint', ['ogg', 'wav']);
	this.addSound('gameStart', 'sounds/whip', ['ogg', 'mp3']);
	this.addSound('localWin', 'sounds/winner', ['ogg', 'mp3']);
	this.addSound('chat', 'sounds/beep', ['ogg', 'mp3']);
}

AudioController.prototype.addSound = function(name, file, formats) {	
	if(this.sounds[name] == undefined)
		this.sounds[name] = [];

	this.sounds[name].push(new buzz.sound(file, {'formats': formats}));
}

AudioController.prototype.playSound = function(name) {
	if(!enableSound || typeof this.sounds[name] != 'object')
		return;

	this.sounds[name][Math.floor(Math.random() * this.sounds[name].length)].play();
}

/* Segments */
function Segment(x1, y1, x2, y2) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
}

Segment.prototype.getLength = function() {
	return Math.sqrt(Math.pow(this.x2 - this.x1, 2) +
		Math.pow(this.y2 - this.y1, 2));
}

Segment.prototype.setEnd = function(pos) {
	this.x2 = pos.x;
	this.y2 = pos.y;
	
	return this;
}

Segment.prototype.draw = function(ctx) {
	ctx.moveTo(this.x1, this.y1);
	ctx.lineTo(this.x2, this.y2);
}

/* FIXME: DO NOT USE THIS! use canvasmanager method instead! */
Segment.prototype.stroke = function(ctx, color, alpha) {
	ctx.beginPath();
	canvasManager.setLineColor(ctx, color, alpha);
	ctx.lineCap = alpha == 1 ? lineCapStyle : 'butt';
	this.draw(ctx);
	ctx.stroke();
	ctx.lineCap = lineCapStyle;
}

function TimedSegment(x1, y1, x2, y2, tick) {
	Segment.call(this, x1, y1, x2, y2);
	this.tick = tick;
}

TimedSegment.prototype = new Segment();

TimedSegment.prototype.constructor = TimedSegment;

TimedSegment.prototype.print = function() {
	game.gameMessage('seg: ' + [this.x1, this.y1, this.x2, this.y2, this.tick].join(', '));
}

function EditorSegment(x1, y1, x2, y2, mode) {
	Segment.call(this, x1, y1, x2, y2);
	this.mode = mode;
	this.angle = 0;
	this.teleportId = -5000;
}

EditorSegment.prototype = new Segment();

EditorSegment.constructor = EditorSegment;

/* Vector */
Vector = function(x, y) {
	this.x = x;
	this.y = y;
}

Vector.prototype.add = function(v) {
	this.x += v.x;
	this.y += v.y;
	
	return this;
}

Vector.prototype.subtract = function(v) {
	this.x -= v.x;
	this.y -= v.y;
	
	return this;
}

Vector.prototype.scale = function(r) {
	this.x *= r;
	this.y *= r;
	
	return this;
}

Vector.prototype.floor = function() {
	this.x = Math.floor(this.x);
	this.y = Math.floor(this.y);
	
	return this;
}

Vector.prototype.getLength = function() {
	return Math.sqrt(this.x * this.x + this.y * this.y);
}

Vector.prototype.getDistanceTo = function(pos) {
	return Math.sqrt(Math.pow(pos.x - this.x, 2) +
		Math.pow(pos.y - this.y, 2));
}

Vector.prototype.clone = function() {
	return new Vector(this.x, this.y);
}

Vector.prototype.copyTo = function(v) {
	v.x = this.x;
	v.y = this.y;
}

Vector.prototype.link = function(pos) {
	return new Segment(this.x, this.y, pos.x, pos.y);
}

/* Teleporter */
Teleporter = function(x1, y1, x2, y2, teleportId) {
	this.x1 = x1;
	this.y1 = y1;
	this.x2 = x2;
	this.y2 = y2;
	this.teleportId = teleportId;
	this.left = Math.min(x1, x2);
	this.right = Math.max(x1, x2);
	this.top = Math.min(y1, y2);
	this.bottom = Math.max(y1, y2);

	/* these variables are set manually */
	this.tall = false;
	this.destY = 0;
	this.destX = 0;
	this.extraAngle = 0;
	this.dx = 0;
	this.dy = 1;
}

/* Collision */
Collision = function(isTeleport, x, y, destX, destY, extraAngle) {
	this.isTeleport = isTeleport;
	this.collisionX = x;
	this.collisionY = y;
	this.destX = destX;
	this.destY = destY;
	this.extraAngle = extraAngle;
}

/* Turn object */
Turn = function(turn, tick, x, y, finalTurn) {
	this.turn = turn;
	this.tick = tick;
	this.x = x;
	this.y = y;
	this.finalTurn = finalTurn;
}

/* Math functions */
function getLength(x, y) {
	return Math.sqrt(x * x + y * y);
}

function getAngle(x, y) {
	return (x == 0) ? (y < 0 ? Math.PI * 3 / 2 : Math.PI / 2)
	 : (Math.atan(y / x) + (x > 0 ? 0 : Math.PI));
}

function rotateVector(x, y, angle) {
	return new Vector(Math.cos(angle) * x - Math.sin(angle) * y,
	 Math.sin(angle) * x + Math.cos(angle) * y);
}

function segmentCollision(a, b) {
	if(a.x2 == b.x1 && a.y2 == b.y1)
		return -1;
	
	var denominator = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
	
	if(Math.abs(denominator) < epsilon)
		return -1;
		
	var numeratorA = (b.x2 - b.x1) * (a.y1 - b.y1) - (b.y2 - b.y1) * (a.x1 - b.x1);
	var t = numeratorA / denominator;
	
	if(t < 0 || t > 1)
		return -1;
	
	var numeratorB = (a.x2 - a.x1) * (a.y1 - b.y1) - (a.y2 - a.y1) * (a.x1 - b.x1);
	var s = numeratorB / denominator;
	
	return (s >= 0 && s <= 1) ? s : -1;
}

/* object that handles all drawing (deel van gameengine kan hier dan in) 
 * TODO: wss kunnen hier ook contexts in geabstraheerd worden enzo */
function createCanvasManager(game) {
	/* private variables / methods go here */

	var publicObject = {
		drawCross: function(ctx, x, y) {	
			this.setLineColor(ctx, crossColor, 1);
			ctx.lineWidth = crossLineWidth;
			ctx.beginPath();
			ctx.moveTo(x - crossSize / 2, y - crossSize / 2);
			ctx.lineTo(x + crossSize / 2, y + crossSize / 2);
			ctx.moveTo(x + crossSize / 2, y - crossSize / 2);
			ctx.lineTo(x - crossSize / 2, y + crossSize / 2);
			ctx.stroke();
			ctx.lineWidth = lineWidth;
		},

		drawSegment: function(seg, color, alpha) {
			for(var i = 0; i < backupStates.length; i++)
				seg.stroke(game.contexts[i], color, alpha);
		}, 
	
		drawMapSegments: function(ctx) {
			ctx.fillStyle = canvasColor;
			ctx.fillRect(0, 0, game.width, game.height);

			if(game.mapSegments.length > 0) {
				ctx.beginPath();
				this.setLineColor(ctx, mapSegmentColor, 1);

				for(var i = 0; i < game.mapSegments.length; i++) {
					var seg = game.mapSegments[i];
					ctx.moveTo(seg.x1, seg.y1);
					ctx.lineTo(seg.x2, seg.y2);
				}

				ctx.stroke();
			}
		
			for(var i in game.mapTeleports)
				this.drawTeleport(ctx, game.mapTeleports[i]);
		}, 
	
		drawPencilSegments: function(ctx) {
			for(var i in game.players) {
				var player = game.players[i];
				var pen = player.pen;
				var switched = false;
			
				this.setLineColor(ctx, player.color, 1);
				ctx.beginPath();
				for(var j = 0; j < pen.seg.length; j++) {
					var seg = pen.seg[j];
				
					if(seg.tick > game.tick && !switched) {
						ctx.stroke();
						this.setLineColor(ctx, player.color, pencilAlpha);
						ctx.beginPath();
						switched = true;
					}
				
					seg.draw(ctx);
				}
				ctx.stroke();
			}
		},

		drawTeleport: function(ctx, seg) {
			this.setLineColor(ctx, playerColors[seg.teleportId], 1);
			ctx.lineWidth = teleportLineWidth;
			var dx = seg.x2 - seg.x1;
			var dy = seg.y2 - seg.y1;
			var len = getLength(dx, dy);

			dx /= len;
			dy /= len;
			var dashes = Math.max(2, Math.round((len + dashSpacing) / (dashLength + dashSpacing)));
			dashSpacing = (len + dashSpacing) / dashes - dashLength;
	
			ctx.beginPath();
			var x = seg.x1;
			var y = seg.y1;
			for(var i = 0; i < dashes; i++) {
				ctx.moveTo(x, y);
				ctx.lineTo(x += dx * dashLength, y += dy * dashLength);
				x += dx * dashSpacing;
				y += dy * dashSpacing;
			}
			ctx.stroke();
			ctx.lineWidth = lineWidth;
		},

		drawIndicatorArrow: function(ctx, x, y, angle, color) {
			this.setLineColor(ctx, color, 1);
			ctx.beginPath();
			ctx.moveTo(x, y);
			ctx.lineTo(x += Math.cos(angle) * indicatorLength, y += Math.sin(angle) * indicatorLength);
			ctx.stroke();

			ctx.fillStyle = getRGBstring(color);
			ctx.beginPath();
			var a = indicatorArrowOffset;
			var b = indicatorArrowLength;
			var c = ctx.lineWidth;
			var d = Math.PI/ 4;
	
			x += Math.cos(angle) * a;
			y += Math.sin(angle) * a;
			for(var i = 0; i < 2; i++) {
				ctx.moveTo(x + Math.cos(angle - d) * c, y + Math.sin(angle - d) * c);
				ctx.arc(x, y, c, angle - d, angle + d, false);
				x += Math.cos(angle) * b;
				y += Math.sin(angle) * b;
				ctx.lineTo(x, y);
				ctx.closePath();
			}
			ctx.fill();
		},
	
		drawDebugSegments: function(ctx, segments) {
			this.setLineColor(ctx, [0, 0, 0], 1);
			ctx.lineWidth = 1;
			ctx.beginPath();

			for(var i = 0; i < segments.length; i++) {
				var s = segments[i];

				if(s.x1 != s.x2 || s.y1 != s.y2) {
					ctx.moveTo(s.x1, s.y1);
					ctx.lineTo(s.x2, s.y2);
				}
				else if(debugZeroLengthSegs) {
					ctx.moveTo(s.x1, s.y1);
					ctx.arc(s.x1, s.y1, 5, 0, Math.PI * 2, false);
				}
			}

			ctx.stroke();
			ctx.lineWidth = lineWidth;
		},
	
		initContext: function(ctx, scaleX, scaleY) {
			ctx.scale(scaleX, scaleY);
			ctx.lineWidth = lineWidth;
			ctx.lineCap = lineCapStyle;
			ctx.drawLine = function(x1, y1, x2, y2) {
				ctx.beginPath();
				ctx.moveTo(x1, y1);
				ctx.lineTo(x2, y2);
				ctx.stroke();
			};
		},

		setLineColor: function(ctx, color, alpha) {
			ctx.strokeStyle = 'rgba(' + color[0] + ', ' + color[1] + ', '
			 + color[2] + ', ' + alpha + ')';
		}
	}
	
	return publicObject;
}

window.requestAnimFrame = (function() {
	return  window.requestAnimationFrame       || 
			window.webkitRequestAnimationFrame || 
			window.mozRequestAnimationFrame    || 
			window.oRequestAnimationFrame      || 
			window.msRequestAnimationFrame     || 
			function(callback) {
				window.setTimeout(callback, 1000 / 60);
			};
})();

/* DOM/ UI functions */
function getPencilMode() {
	if(document.getElementById('pencilOn').lastChild.checked)
		return 'on';

	if(document.getElementById('pencilOff').lastChild.checked)
		return 'off';

	if(document.getElementById('pencilOnDeath').lastChild.checked)
		return 'ondeath';

	return null;
}

function setPencilMode(mode) {
	var sections = ['pencilOn', 'pencilOff', 'pencilOnDeath'];
	var selected = 0;

	if(mode == 'off')
		selected = 1;
	else if(mode == 'ondeath')
		selected = 2;

	for(var i = 0; i < sections.length; i++)
		document.getElementById(sections[i]).lastChild.checked = (i == selected);
}

/* Cookie wrappers */
function setCookie(c_name, value, exdays) {
	var exdate = new Date();
	exdate.setDate(exdate.getDate() + exdays);
	var c_value = escape(value) + ((exdays==null) ? '' : '; expires='+exdate.toUTCString());
	document.cookie = c_name + '=' + c_value;
}

function getCookie(c_name) {
	var i, x, y, ARRcookies=document.cookie.split(';');
	for (i = 0; i < ARRcookies.length; i++) {
		x = ARRcookies[i].substr(0,ARRcookies[i].indexOf('='));
		y = ARRcookies[i].substr(ARRcookies[i].indexOf('=')+1);
		x = x.replace(/^\s+|\s+$/g,'');
		if (x == c_name)
			return unescape(y);
	}
}

/* Misc helper functions */
function escapeString(str) {
	return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getRGBstring(color) {
	return 'rgb(' + color[0] + ', ' + color[1] + ', '
		 + color[2] + ')';
}

function getRGBAstring(color, alpha) {
	return 'rgba(' + color[0] + ', ' + color[1] + ', '
		 + color[2] + ', ' + alpha + ')';
}

function printDebugPos() {
	var s = '';
	for(var i = 0; i < debugPosA.length; i++) {
		s += debugPosA[i] + '<br />' + debugPosB[i] + '<br />' + '<br />';
	}
	echo(s);
}

function format(s, len) {
	return (s  +  '0000000000000000000000000000').substr(0, len);
}

function simulateClick(element) {
	var evt = document.createEvent("MouseEvents");
	evt.initMouseEvent("click", true, true, window, 
		0, 0, 0, 0, 0, false, false, false, false, 0, null);
	element.dispatchEvent(evt);
}
