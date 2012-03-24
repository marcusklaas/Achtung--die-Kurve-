function MouseState() {
	this.down = false;
	this.out = true;
}

function Editor(game) {
	this.mapChanged = false;
	this.segments = new Array();
	
	this.resize = function() {
		game.calcScale(document.getElementById('editorControls').offsetHeight + 1);
		var w = Math.round(game.scaleX * game.width);
		var h = Math.round(game.scaleY * game.height);
		var sizeChanged = w != canvas.width;
		canvas.width = w;
		canvas.height = h;
		context.scale(game.scaleX, game.scaleY);
		context.lineWidth = 3;
		setLineColor(context, mapSegmentColor, 1);
		context.lineCap = 'round';
	
		for(var i = 0; i < this.segments.length; i++)
			drawSegment(this.segments[i]);
		
		// stop drawing
		if(sizeChanged) {
			mouse.down = false;
		}
	}

	this.load = function(str) {
		try {
			var segs = JSON.parse(str);
		}
		catch(ex) {
			game.gameMessage('JSON parse exception!');
		}

		/* FIXME: hier moet nog iets meer checks op segs komen
		 * het kan nu van alles zijn en dan krijg je later js errors */	

		this.segments = segs;
		this.resize();
		this.mapChanged = true;
	}

	this.onload = function() {
		var modal = document.getElementById('mapLoader');
		var overlay = document.getElementById('overlay');
		var modalHeader = document.getElementById('modalHeader');
		var pencilButton = document.getElementById('editorPencil');
		var lineButton = document.getElementById('editorLine');
		var eraserButton = document.getElementById('editorEraser');
		var playerStartButton = document.getElementById('editorPlayerStart');
		var teleportButton = document.getElementById('editorTeleport');
		var resetButton = document.getElementById('editorReset');
		var copyButton = document.getElementById('editorCopy');
		var loadButton = document.getElementById('editorLoad');
		var undoButton = document.getElementById('editorUndo');
		var startButton = document.getElementById('editorStart');
		var doneButton = document.getElementById('editorDone');
		var closeButton = document.getElementById('modalClose');
		var modalButton = document.getElementById('modalOk');

		canvas = document.getElementById('editorCanvas');
		context = canvas.getContext('2d');
		container = document.getElementById('editor');
		textField = document.getElementById('editorTextField');
		canvas.width = canvas.height = 0;
		pencilButton.className = 'btn active';
		pencilButton.mode = 'pencil';
		lineButton.mode = 'line';
		eraserButton.mode = 'eraser';
		playerStartButton.mode = 'playerStart';
		teleportButton.mode = 'teleport';

		function closeModal() {
			overlay.style.display = 'none';
			modal.style.display = 'none';
		}

		function activate(node) {
			var siblings = node.parentNode.getElementsByTagName('a');

			for(var i = 0; i < siblings.length; i++)
				siblings[i].className = 'btn';

			node.className = 'btn active';
		}
	
		function click(e) {
			activate(e.target);
			mode = e.target.mode;
		}

		function getTouchEvent(type) {
			return function(e) {
				for(var i = 0; i < e.changedTouches.length; i++) {
					var t = e.changedTouches[i];
					handleInput(type, t, t);
				}

				e.preventDefault();
			};
		}
	
		/* adding event listeners */
		canvas.addEventListener('mousedown', function(ev) { handleInput('down', ev, mouse); }, false);
		canvas.addEventListener('mousemove', function(ev) { handleInput('move', ev, mouse); }, false);
		window.addEventListener('mouseup', function(ev) { handleInput('up', ev, mouse); }, false);
		canvas.addEventListener('mouseout', function(ev) { handleInput('out', ev, mouse); }, false);
		canvas.addEventListener('mouseover', function(ev) { handleInput('over', ev, mouse); }, false);

		resetButton.addEventListener('click', function() { 
			self.segments = [];
			self.mapChanged = true;
			self.resize();	
		}, false);

		copyButton.addEventListener('click', function() {
			modalHeader.innerHTML = 'Store map';
			overlay.style.display = 'block';
			modal.style.display = 'block';
			modalButton.innerHTML = 'Done';
			copy();
		}, false);

		loadButton.addEventListener('click', function() {
			modalHeader.innerHTML = 'Load map';
			overlay.style.display = 'block';
			modal.style.display = 'block';
			modalButton.innerHTML = 'Load Map';
		}, false);

		modalButton.addEventListener('click', function() {
			if(modalButton.innerHTML == 'Load Map')
				self.load(textField.value);

			closeModal();
		});

		undoButton.addEventListener('click', function() {
			if(self.segments.length > 0) {
				self.segments.pop();
				self.resize();
			}
		}, false);

		startButton.addEventListener('click', function() {
			game.setGameState('editing');
			pos = findPos(canvas);
			self.resize();

			interval = window.setInterval(function() {
				handleInput('move', null, mouse);
			}, editorStepTime);

			if(game.noMapSent && self.segments.length > 0) {
				game.noMapSent = false;
				self.mapChanged = true;
			}
			window.scroll(document.body.offsetWidth, 0);
		}, false);

		doneButton.addEventListener('click', function() {
			game.setGameState('waiting'); 
			window.clearInterval(interval);
			canvas.height = canvas.width = 0;
		}, false);

		overlay.addEventListener('click', closeModal, false);
		closeButton.addEventListener('click', closeModal, false);
	
		pencilButton.addEventListener('click', click, false);
		lineButton.addEventListener('click', click, false);
		eraserButton.addEventListener('click', click, false);
		playerStartButton.addEventListener('click', click, false);
		teleportButton.addEventListener('click', click, false);
	
		canvas.addEventListener('touchstart', getTouchEvent('down'), false);
		canvas.addEventListener('touchmove', getTouchEvent('move'), false);
		canvas.addEventListener('touchend', getTouchEvent('up'), false);
		canvas.addEventListener('touchcancel', getTouchEvent('up'), false);
	}
}

var editor = (function() {
	var self = new Editor();
	var mouse = new MouseState();
	var pos = [0, 0];
	var mode = 'pencil';
	var textField, canvas, context, container, interval;

	function handleInput(type, ev, state) {
		var stepTime = mode == 'eraser' ? eraserStepTime : editorStepTime;
		var setStart = false;
		var doAction = false;
	
		if(ev != undefined) {
			state.pos = game.getGamePos(ev);
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
				if(state.down && inMode('eraser', 'pencil'))
					setStart = true;
				break;
			case 'up':
				if(state.down && !state.out)
					doAction = true;
				state.down = false;
				break;
			case 'out':
				state.out = true;
				if(state.down && inMode('eraser', 'pencil'))
					doAction = true;
				break;
			case 'move':
				if(state.down && inMode('eraser', 'pencil') && Date.now() - state.startTime > stepTime)
					doAction = true;
				break;
		}
		
		if(doAction) {
		 	if(state.pos.x != state.start.x || state.pos.y != state.start.y) {
				var seg = new Segment(state.start.x, state.start.y, state.pos.x, state.pos.y);
			
				switch(mode) {
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

						if((seg.teleportId = getNextTeleportId()) == -1)
							return;

						seg.color = playerColors[seg.teleportId];
						break;
					case 'eraser':
						var changed = false;
						for(var i = 0; i < self.segments.length; i++) {
							if(segmentCollision(self.segments[i], seg) != -1) {
								self.segments.splice(i--, 1);
								changed = true;
								self.mapChanged = true;
							}
						}

						if(changed)
							self.resize();
				}
			
				if(!inMode('eraser')) {
					this.segments.push(seg);
					self.mapChanged = true;
					drawSegment(seg);
				}
			
				setStart = true;
			}
		}
	
		if(setStart) {
			state.start = state.pos;
			state.startTime = Date.now();
		}
	}

	function getNextTeleportId() {
		var ar = new Array(maxTeleports);
		var id = -1;

		for(var i = 0; i < maxTeleports; i++)
			ar[i] = 0;

		for(var i in self.segments) {
			var seg = self.segments[i];
			if(seg.teleportId != undefined)
				ar[seg.teleportId]++;
		}

		for(var i = 0; i < maxTeleports; i++) {
			if(ar[i] == 1)
				return i;
			else if(ar[i] == 0 && id == -1)
				id = i;
		}

		return id;
	}

	function copy() {
		textField.value = JSON.stringify(self.segments);
	}

	function inMode(arguments) {
		for(var i = 0; i < arguments.length; i++)
			if(mode == arguments[i])
				return true;

		return false;
	}

	function drawSegment(seg) {
		if(seg.x1 == seg.x2 && seg.y1 == seg.y2)
			return;

		if(seg.playerStart != undefined) {
			drawIndicatorArrow(context, seg.x1, seg.y1, seg.angle, playerColors[0]);
			setLineColor(context, mapSegmentColor, 1);
		}
		else if(seg.teleportId != undefined) { // FIXME: niet werken met undefined
			drawTeleport(context, seg);
			setLineColor(context, mapSegmentColor, 1);
		}
		else {
			context.beginPath();
			context.moveTo(seg.x1, seg.y1);
			context.lineTo(seg.x2, seg.y2);
			context.stroke();
		}
	}

	/* return public object */
	return self;
})();
