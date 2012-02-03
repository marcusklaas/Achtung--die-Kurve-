/* global vars */
var enableSound = true;
var autoFullscreen = true;
var joinedLink = false;

/* controls */
var keyCodeLeft = 37;
var keyCodeRight = 39;

var serverURL = "ws://marcusklaas.nl:7681"; // websocket game server
if(location.href.indexOf('7681') != -1)
	serverURL = location.href.replace('http', 'ws');
else if(location.href.indexOf('C:/Dropbox') != -1)
	serverURL = "ws://localhost:7681";

/* visual stuff */
var gapAlpha = 0.2;
var lineWidth = 3; // only visual, does not influence collisions
var lineCapStyle = 'round';
var indicatorLength = 15;
var indicatorArrowLength = 8;
var indicatorArrowOffset = 2;
var syncTries = 2;
var syncDelays = 50;
var tickTockDifference = 2; // desired difference between tock and tick
var canvasMinimumWidth = 200;
var crossSize = 12;
var crossLineWidth = 2;
var crossColor = [0, 0, 0];
var rewardShowLength = 1000;
var rewardMaxTransitionLength = 1000;
var rewardOffsetY = 8;
var rewardWidth = 23; // TODO: should be read from document
var rewardHeight = 18;
var maxHiddenRewards = 20;
var startedGamesDisplay = 'below'; // show, below or hide

var safeTickDifference = 60; // TODO: should depend on 2*ping & SERVER_DELAY
var resizeDelay = 200; // the duration the window should have a constant size before calling resize
var paramUpdateInterval = 500; // don't send game intervals more often that one per this many msecs
var paramInputInterval = 2000; // wait for this duration before sending params to server after text edit
var unlockInterval = 0; // minimum time between last changing settings and gamestart in msecs

var customGameWaitMessage = 'Waiting for host to start the game..';
var autoMatchWaitMessage = 'Waiting for more players..';

/* touch */
var touchDevice = 'createTouch' in document;
var steerBoxSize = 0.15;
var pencilTreshold = 20; // minimum SCALED units you need to move to transform steertouch into penciltouch 

/* pencil */
var inkBufferTicks = 5;
var pencilAlpha = 0.2;

/* debugging */
var emulateTouch = false;
var ultraVerbose = false;
var simulatedPing = 1000;
var extraGameStartTimeDifference = 0;
var acceptGameTimeAdjustments = true;
var jsProfiling = false;
var simulateCPUlag = false;
var debugBaseContext = false; // sets different color for segments in basecontext
var displayDebugStatus = false;
var debugRewards = false;

var messageJson = 3;
/* server.h copy */
var messagePencil = 2;

/* editor */
var editorStepTime = 100;
var mapSegmentColor = [96, 96, 96];

/* these are the segment RGBs for the players. in client order, so the 
 * first one is always for the human player */
var playerColors = [[255, 0, 0], [0, 0, 255], [0, 255, 0],
 [255, 0, 255], [229, 91, 176], [78, 42, 4], [28, 182, 25], [126, 191, 241],
 [0, 0, 0], [254, 138, 14], [149, 150, 151], [16, 98, 70], [127, 200, 0]];
