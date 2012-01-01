var enableSound = true; // this is not constant! may change during execution of game.js
var keyCodeLeft = 37; // left arrow button
var keyCodeRight = 39; // right arrow button
var chatSendKeyCode = 13; // enter

var serverURL = "ws://marcusklaas.nl:7681"; // websocket game server
if(location.href.indexOf('localhost') != -1)
	serverURL = "ws://localhost:" + location.href.substr(location.href.lastIndexOf(':') + 1);
else if(location.href.indexOf('82.161') != -1)
	serverURL = "ws://82.161.20.2:7681";
else if(location.href.indexOf('192.168.1.101') != -1)
	serverURL = "ws://192.168.1.101:7681";

var gapAlpha = 0.2;
var lineWidth = 3; // only visual, does not influence collisions
var canvasBgcolor = '#D0D0D0';
var lineCapStyle = 'round';
var indicatorLength = 15;
var indicatorArrowLength = 8;
var indicatorArrowOffset = 2;
var simStep = null; // in milliseconds
var syncTries = 2;
var syncDelays = 50;
var behind = 2; // desired difference between tock and tick
var canvasMinimumWidth = 200;

var game = null;
var localPlayer = null;
var touchDevice = null;
var safeTickDifference = 60; // TODO: should depend on 2*ping & SERVER_DELAY

/* debugging */
var ultraVerbose = false;
var simulatedPing = 0;
var extraGameStartTimeDifference = 0;
var acceptGameTimeAdjustments = true;
var jsProfiling = true;
var simulateCPUlag = false;
var debugBaseContext = false; // sets different color for segments in basecontext

/* pencil game */
var pencilGame = true;
var mousedownInk = 30;
var inkBufferTicks = 5;
var inkMinimumDistance = 5;
var maxInk = 200;
var startInk = maxInk;
var inkPerSec = 25;
var pencilAlpha = .2;

/* these are the segment RGBs for the players. in client order, so the 
 * first one is always for the human player */
var playerColors = [[255, 0, 0], [0, 0, 255], [255, 255, 0], [0, 255, 0],
 [255, 0, 255], [229, 91, 176], [78, 42, 4], [28, 182, 25], [126, 191, 241],
 [0, 0, 0], [254, 138, 14], [149, 150, 151], [16, 98, 70]];
