/* global vars */
var enableSound = true;
var joinedLink = false;

/* controls */
var keyCodeLeft = 37;
var keyCodeRight = 39;

var serverURL = "ws://diekurve.net:7681"; // websocket game server
if(location.href.indexOf('7681') != -1)
	serverURL = location.href.replace('http', 'ws');
else if(location.href.indexOf('C:/Dropbox') != -1)
	serverURL = "ws://localhost:7681";

/* visual stuff */
var holeAlpha = 0.2;
var lineWidth = 3; // only visual, does not influence collisions
var lineCapStyle = 'round';
var syncTries = 2;
var syncDelays = 50;
var tickTockDifference = 2; // desired difference between tock and tick
var canvasMinimumWidth = 150;
var crossSize = 12;
var crossLineWidth = 2;
var crossColor = [0, 0, 0];
var teleportLineWidth = 2;
var rewardShowLength = 1000;
var rewardMaxTransitionLength = 1000;
var rewardOffsetY = 8;
var rewardWidth = 23; // TODO: should be read from document
var rewardHeight = 18;
var maxHiddenRewards = 20;
var startedGamesDisplay = 'below'; // show, below or hide

/* general settings */
var backupStates = [Infinity, 100, 10, 0]; // how many ticks the different backup states should trail
var resizeDelay = 200; // the duration the window should have a constant size before calling resize
var paramUpdateInterval = 500; // don't send game intervals more often that one per this many msecs
var paramInputInterval = 2000; // wait for this duration before sending params to server after text edit

var customGameWaitMessage = 'Waiting for host to start the game..';
var autoMatchWaitMessage = 'Waiting for more players..';

/* touch */
var touchDevice = 'createTouch' in document;
var steerBoxSize = 0.15;
var pencilTreshold = 20; // minimum SCALED units movement required to transform steer to pencil 

/* pencil */
var inkBufferTicks = 5;
var pencilAlpha = 0.2;

/* debugging */
var emulateTouch = false;
var ultraVerbose = false;
var simulatedPing = 0;
var extraGameStartTimeDifference = 0;
var acceptGameTimeAdjustments = true;
var jsProfiling = true;
var simulateCPUlag = false;
var debugBaseContext = false; // sets different color for segments in basecontext
var displayDebugStatus = false;
var debugRewards = false;
var alwaysHideSidebar = false;
var debugPos = false;
var debugComputers = 1;
var debugMap = '[{"x1":1,"y1":1,"x2":510,"y2":2},{"x1":508,"y1":0,"x2":508,"y2":254},{"x1":508,"y1":254,"x2":1,"y2":252},{"x1":1,"y1":252,"x2":1,"y2":1},{"x1":1,"y1":104,"x2":95,"y2":43},{"x1":61,"y1":63,"x2":184,"y2":142},{"x1":75,"y1":151,"x2":36,"y2":191},{"x1":163,"y1":187,"x2":231,"y2":194},{"x1":126,"y1":134,"x2":116,"y2":195},{"x1":90,"y1":220,"x2":83,"y2":252},{"x1":287,"y1":1,"x2":284,"y2":59},{"x1":282,"y1":82,"x2":284,"y2":252},{"x1":207,"y1":1,"x2":195,"y2":21},{"x1":191,"y1":35,"x2":178,"y2":105}]';

/* server.h copy */
var maxNameLength = 20;
var modeModified = 0;
var modeTickUpdate = 1;
var modePencil = 2;
var modeJson = 3;
var modeOther = 7;
var modeSetMap = 8 + 7;
var unlockInterval = 0; // minimum time between last changing settings and gamestart in msecs
var minTeleportSize = 15;
var maxTeleports = 8;
var epsilon = 0.0001;
var serverDalay = 200;

/* indicators */
var indicatorLength = 15;
var indicatorArrowLength = 8;
var indicatorArrowOffset = 2;
var indicatorFont = 24;

/* editor */
var editorStepTime = 125;
var eraserStepTime = 50;
var mapSegmentColor = [96, 96, 96];

/* these are the segment RGBs for the players */
var playerColors = [[237, 28, 36], [63, 72, 204], [43, 177, 76],
 [0, 0, 0], [185, 122, 87], [163, 73, 164], [0, 162, 232], [136, 0, 21]];
