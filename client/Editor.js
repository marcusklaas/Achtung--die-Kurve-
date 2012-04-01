function MouseState() {
	this.down = false;
	this.out = true;
}

function createEditor(game) {
	var mouse = new MouseState();
	var pos = [0, 0];
	var mode = 'pencil';
	var domManager = game.domManager;
	var canvasManager = game.canvasManager;
	var textField, canvas, context, container, interval;
	var modal, pencilButton, lineButton, eraserButton, playerStartButton, teleportButton;

	function handleInput(type, ev, state) {
		var stepTime = mode == 'eraser' ? eraserStepTime : editorStepTime;
		var setStart = false;
		var doAction = false;

		if(ev != null) {
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
				var seg = new EditorSegment(state.start.x, state.start.y, state.pos.x, state.pos.y, mode);
			
				switch(mode) {
					case 'playerStart':
						seg.angle = getAngle(seg.x2 - seg.x1, seg.y2 - seg.y1);
						break;
					case 'teleport':
						//TODO: some visual feedback for these return statements - wat do u mean?
						if(getLength(seg.x2 - seg.x1, seg.y2 - seg.y1) < minTeleportSize ||
						 (seg.teleportId = getNextTeleportId()) == -1)
							return;
						break;
					case 'eraser':
						var changed = false;
						for(var i = 0; i < editor.segments.length; i++) {
							if(segmentCollision(editor.segments[i], seg) != -1) {
								editor.segments.splice(i--, 1);
								changed = true;
								editor.mapChanged = true;
							}
						}

						if(changed)
							editor.resize();
				}
			
				if(!inMode('eraser')) {
					editor.segments.push(seg);
					editor.mapChanged = true;
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

		for(var i in editor.segments) {
			var seg = editor.segments[i];
			if(seg.mode == 'teleport')
				ar[seg.teleportId]++;
		}

		for(var i = 0; i < maxTeleports; i++) {
			if(ar[i] == 1)
				return i;

			if(ar[i] == 0 && id == -1)
				id = i;
		}

		return id;
	}

	function copy() {
		textField.value = JSON.stringify(editor.segments);
	}

	function undo() {
		if(editor.segments.length > 0) {
			editor.segments.pop();
			editor.resize();
		}
	}

	function closeModal() {
		overlay.style.display = 'none';
		modal.style.display = 'none';
	}

	function inMode() {
		for(var i = 0; i < arguments.length; i++)
			if(mode == arguments[i])
				return true;

		return false;
	}

	function drawSegment(seg) {
		if(seg.x1 == seg.x2 && seg.y1 == seg.y2)
			return;

		if(seg.mode == 'playerStart') {
			canvasManager.drawIndicatorArrow(context, seg.x1, seg.y1, seg.angle, playerColors[0]);
			canvasManager.setLineColor(context, mapSegmentColor, 1);
		}
		else if(seg.mode == 'teleport') {
			canvasManager.drawTeleport(context, seg);
			canvasManager.setLineColor(context, mapSegmentColor, 1);
		}
		else {
			context.beginPath();
			context.moveTo(seg.x1, seg.y1);
			context.lineTo(seg.x2, seg.y2);
			context.stroke();
		}
	}

	/* return public object */
	var editor = {
		mapChanged: false,
		segments: new Array(),
	
		resize: function() {
			game.calcScale(document.getElementById('editorControls').offsetHeight + 1);
			var w = Math.round(game.scaleX * game.width);
			var h = Math.round(game.scaleY * game.height);
			var sizeChanged = w != canvas.width;
			canvas.width = w;
			canvas.height = h;
			context.scale(game.scaleX, game.scaleY);
			context.lineWidth = 3;
			canvasManager.setLineColor(context, mapSegmentColor, 1);
			context.lineCap = 'round';
	
			for(var i = 0; i < this.segments.length; i++)
				drawSegment(this.segments[i]);
		
			if(sizeChanged)
				mouse.down = false;
		},

		load: function(str) {
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
		},

		handleKeyEvent: function(e) {
			if(modal.style.display != 'block') {
				switch(String.fromCharCode(e.keyCode)) {
					case 'U':
						undo();
						break;

					case 'P': case '1':
						simulateClick(pencilButton);
						break;

					case 'L': case '2':
						simulateClick(lineButton);
						break;

					case 'S': case '3':
						simulateClick(playerStartButton);
						break;

					case 'T': case '4':
						simulateClick(teleportButton);
						break;

					case 'E': case '5':
						simulateClick(eraserButton);
						break;
	
					default:
						return;
				}
			}
			else if(e.keyCode == 27)
				closeModal();

			e.preventDefault();
		},

		onload: function() {
			var overlay = document.getElementById('overlay');
			var modalHeader = document.getElementById('modalHeader');
			var resetButton = document.getElementById('editorReset');
			var copyButton = document.getElementById('editorCopy');
			var loadButton = document.getElementById('editorLoad');
			var undoButton = document.getElementById('editorUndo');
			var startButton = document.getElementById('editorStart');
			var doneButton = document.getElementById('editorDone');
			var closeButton = document.getElementById('modalClose');
			var modalButton = document.getElementById('modalOk');

			modal = document.getElementById('mapLoader');
			pencilButton = document.getElementById('editorPencil');
			lineButton = document.getElementById('editorLine');
			eraserButton = document.getElementById('editorEraser');
			playerStartButton = document.getElementById('editorPlayerStart');
			teleportButton = document.getElementById('editorTeleport');
			canvas = document.getElementById('editorCanvas');
			container = document.getElementById('editor');
			textField = document.getElementById('editorTextField');

			context = canvas.getContext('2d');
			canvas.width = canvas.height = 0;
			pencilButton.className = 'btn active';
			pencilButton.mode = 'pencil';
			lineButton.mode = 'line';
			eraserButton.mode = 'eraser';
			playerStartButton.mode = 'playerStart';
			teleportButton.mode = 'teleport';

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
				editor.segments = [];
				editor.mapChanged = true;
				editor.resize();	
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
					editor.load(textField.value);

				closeModal();
			});

			undoButton.addEventListener('click', undo, false);

			startButton.addEventListener('click', function() {
				game.setGameState('editing');
				pos = domManager.findPos(canvas);
				editor.resize();

				interval = window.setInterval(function() {
					handleInput('move', null, mouse);
				}, editorStepTime);

				if(game.noMapSent && editor.segments.length > 0) {
					game.noMapSent = false;
					editor.mapChanged = true;
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
	};
	
	return editor;
}
