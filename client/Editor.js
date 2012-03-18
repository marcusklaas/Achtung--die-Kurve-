MouseState = function() {
	this.down = false;
	this.out = true;
}

Editor = function(game) {
	this.game = game;
	this.mouse = new MouseState();
	this.canvas = document.getElementById('editorCanvas');
	this.context = this.canvas.getContext('2d');
	this.container = document.getElementById('editor');
	this.pos = [0, 0];
	this.segments = new Array();
	this.canvas.width = this.canvas.height = 0;
	this.mode = 'pencil';
	var self = this;

	/* extra inits */
	this.mapChanged = false;

	/* modal stuff */
	this.textField = document.getElementById('editorTextField');
	this.modal = document.getElementById('mapLoader');
	this.overlay = document.getElementById('overlay');
	this.modalHeader = document.getElementById('modalHeader');
	this.modalButton = document.getElementById('modalOk');

	/* buttons */
	this.pencilButton = document.getElementById('editorPencil');
	this.lineButton = document.getElementById('editorLine');
	this.eraserButton = document.getElementById('editorEraser');
	this.playerStartButton = document.getElementById('editorPlayerStart');
	this.teleportButton = document.getElementById('editorTeleport');
	
	this.pencilButton.mode = 'pencil';
	this.lineButton.mode = 'line';
	this.eraserButton.mode = 'eraser';
	this.playerStartButton.mode = 'playerStart';
	this.teleportButton.mode = 'teleport';
	
	/********* add event listeners *********/
	this.canvas.addEventListener('mousedown', function(ev) { self.handleInput('down', ev, self.mouse); }, false);
	this.canvas.addEventListener('mousemove', function(ev) { self.handleInput('move', ev, self.mouse); }, false);
	window.addEventListener('mouseup', function(ev) { self.handleInput('up', ev, self.mouse); }, false);
	this.canvas.addEventListener('mouseout', function(ev) { self.handleInput('out', ev, self.mouse); }, false);
	this.canvas.addEventListener('mouseover', function(ev) { self.handleInput('over', ev, self.mouse); }, false);

	this.resetButton = document.getElementById('editorReset');
	this.resetButton.addEventListener('click', function() { 
		self.segments = [];
		self.mapChanged = true;
		self.resize();	
	}, false);

	var copy = document.getElementById('editorCopy');
	copy.addEventListener('click', function() {
		self.modalHeader.innerHTML = 'Store map';
		self.overlay.style.display = 'block';
		self.modal.style.display = 'block';
		self.modalButton.innerHTML = 'Done';
		self.copy();
	}, false);

	var load = document.getElementById('editorLoad');
	load.addEventListener('click', function() {
		self.modalHeader.innerHTML = 'Load map';
		self.overlay.style.display = 'block';
		self.modal.style.display = 'block';
		self.modalButton.innerHTML = 'Load Map';
	}, false);

	function closeModal() {
		self.overlay.style.display = 'none';
		self.modal.style.display = 'none';
	}

	this.modalButton.addEventListener('click', function() {
		if(self.modalButton.innerHTML == 'Load Map')
			self.load(self.textField.value);

		closeModal();
	});

	this.overlay.addEventListener('click', closeModal);
	document.getElementById('modalClose').addEventListener('click', closeModal);

	var undo = document.getElementById('editorUndo');
	undo.addEventListener('click', function() { self.undo(); }, false);

	var start = document.getElementById('editorStart');
	start.addEventListener('click', function() {
		self.game.setGameState('editing');
		self.pos = findPos(self.canvas);
		self.resize();

		self.interval = window.setInterval(function() {
			self.handleInput('move', null, self.mouse);
		}, editorStepTime);

		if(self.game.noMapSent && self.segments.length > 0) {
			self.game.noMapSent = false;
			self.mapChanged = true;
		}
		window.scroll(document.body.offsetWidth, 0);
	}, false);

	var done = document.getElementById('editorDone');
	done.addEventListener('click', function() {
		self.game.setGameState('waiting'); 
		window.clearInterval(self.interval);
		// freeing memory - is this the right way?
		self.canvas.height = self.canvas.width = 0;
	}, false);

	function activate(node) {
		var siblings = node.parentNode.getElementsByTagName('a');

		for(var i = 0; i < siblings.length; i++)
			siblings[i].className = 'btn';

		node.className = 'btn active';
	}
	
	function click(e) {
		activate(e.target);
		self.mode = e.target.mode;
	}
	
	this.pencilButton.className = 'btn active';
	this.pencilButton.addEventListener('click', click, false);
	this.lineButton.addEventListener('click', click, false);
	this.eraserButton.addEventListener('click', click, false);
	this.playerStartButton.addEventListener('click', click, false);
	this.teleportButton.addEventListener('click', click, false);
	
	/********* touch *********/
	function getTouchEvent(type) {
		return function(e) {
			for(var i = 0; i < e.changedTouches.length; i++) {
				var t = e.changedTouches[i];
				self.handleInput(type, t, t);
			}
			e.preventDefault();
		};
	}
	
	this.canvas.addEventListener('touchstart', getTouchEvent('down'), false);
	this.canvas.addEventListener('touchmove', getTouchEvent('move'), false);
	this.canvas.addEventListener('touchend', getTouchEvent('up'), false);
	this.canvas.addEventListener('touchcancel', getTouchEvent('up'), false);
}

Editor.prototype.handleInput = function(type, ev,  state) {
	var stepTime = this.mode == 'eraser' ? eraserStepTime : editorStepTime;
	var setStart = false;
	var doAction = false;
	
	if(ev != undefined) {
		state.pos = this.game.getGamePos(ev);
		if(ev.preventDefault)
			ev.preventDefault();
	}
	
	switch(type) {
		case 'down':
			state.down = true;
			state.out = false;
			setStart = true;
			break;
		case 'over':
			state.out = false;
			if(state.down && this.inMode('eraser', 'pencil'))
				setStart = true;
			break;
		case 'up':
			if(state.down && !state.out)
				doAction = true;
			state.down = false;
			break;
		case 'out':
			state.out = true;
			if(state.down && this.inMode('eraser', 'pencil'))
				doAction = true;
			break;
		case 'move':
			if(state.down && this.inMode('eraser', 'pencil') && Date.now() - state.startTime > stepTime)
				doAction = true;
			break;
	}
		
	if(doAction) {
		
	 	if(state.pos.x != state.start.x || state.pos.y != state.start.y) {
			var seg = new BasicSegment(state.start.x, state.start.y, state.pos.x, state.pos.y);
			
			switch(this.mode) {
				case 'playerStart':
					seg.playerStart = true;
					seg.angle = getAngle(seg.x2 - seg.x1, seg.y2 - seg.y1);
					seg.x2 = seg.x1 + Math.cos(seg.angle) * (indicatorLength + 2 * indicatorArrowLength);
					seg.y2 = seg.y1 + Math.sin(seg.angle) * (indicatorLength + 2 * indicatorArrowLength);
					break;
				case 'teleport':
					//TODO: some visual feedback for these return statements - wat do u mean?
					if(getLength(seg.x2 - seg.x1, seg.y2 - seg.y1) < minTeleportSize)
						return;
					seg.teleportId = this.getNextTeleportId();
					if(seg.teleportId == -1)
						return;
					seg.color = playerColors[seg.teleportId];
					break;
				case 'eraser':
					var changed = false;
					for(var i = 0; i < this.segments.length; i++) {
						if(segmentCollision(this.segments[i], seg) != -1) {
							this.segments.splice(i--, 1);
							changed = true;
							this.mapChanged = true;
						}
					}
					if(changed)
						this.resize();
					break;
			}
			
			if(!this.inMode('eraser')) {
				this.segments.push(seg);
				this.mapChanged = true;
				this.drawSegment(seg);
			}
			
			setStart = true;
		}
	}
	
	if(setStart) {
		state.start = state.pos;
		state.startTime = Date.now();
	}
}

Editor.prototype.getNextTeleportId = function () {
	var ar = new Array(maxTeleports);
	for(var i = 0; i < maxTeleports; i++)
		ar[i] = 0;
	for(var i in this.segments) {
		var seg = this.segments[i];
		if(seg.teleportId != undefined)
			ar[seg.teleportId]++;
	}
	var id = -1;
	for(var i = 0; i < maxTeleports; i++) {
		if(ar[i] == 1)
			return i;
		else if(ar[i] == 0 && id == -1)
			id = i;
	}
	return id;
}

Editor.prototype.inMode = function() {
	for(var i = 0; i < arguments.length; i++)
		if(this.mode == arguments[i])
			return true;
	return false;
}

Editor.prototype.drawSegment = function(seg) {
	if(seg.x1 == seg.x2 && seg.y1 == seg.y2)
		return;

	if(seg.playerStart != undefined) {
		drawIndicatorArrow(this.context, seg.x1, seg.y1, seg.angle, playerColors[0]);
		setLineColor(this.context, mapSegmentColor, 1);
	}
	else if(seg.teleportId != undefined) { // FIXME: niet werken met undefined
		drawTeleport(this.context, seg);
		setLineColor(this.context, mapSegmentColor, 1);
	}
	else {
		this.context.beginPath();
		this.context.moveTo(seg.x1, seg.y1);
		this.context.lineTo(seg.x2, seg.y2);
		this.context.stroke();
	}
}

Editor.prototype.copy = function() {
	this.textField.value = JSON.stringify(this.segments);
}

Editor.prototype.load = function(str) {
	try {
		var segs = JSON.parse(str);
	}
	catch(ex) {
		this.game.gameMessage('JSON parse exception!');
	}

	/* FIXME: hier moet nog iets meer checks op segs komen
	 * het kan nu van alles zijn en dan krijg je later js errors */	

	this.segments = segs;
	this.resize();
	this.mapChanged = true;
}

Editor.prototype.undo = function() {
	if(this.segments.length > 0) {
		this.segments.pop();
		this.resize();
	}
}

Editor.prototype.resize = function() {
	var game = this.game;
	game.calcScale(document.getElementById('editorControls').offsetHeight + 1);
	var w = Math.round(game.scaleX * game.width);
	var h = Math.round(game.scaleY * game.height);
	var sizeChanged = w != this.canvas.width;
	this.canvas.width = w;
	this.canvas.height = h;
	this.context.scale(game.scaleX, game.scaleY);
	this.context.lineWidth = 3;
	setLineColor(this.context, mapSegmentColor, 1);
	this.context.lineCap = 'round';
	
	for(var i = 0; i < this.segments.length; i++)
		this.drawSegment(this.segments[i]);
		
	// stop drawing
	if(sizeChanged) {
		this.mouse.down = false;
	}
}
