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
var backupStates = [Infinity, 40, 10, 0]; // how many ticks the different backup states should trail
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
var jsProfiling = false;
var simulateCPUlag = true;
var displayDebugStatus = false;
var debugRewards = false;
var alwaysHideSidebar = false;
var debugPos = false;
var debugComputers = 0;
var debugMap = '';

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
var canvasColor = '#D0D0D0'; // wil dit lezen uit document met getComputedStyle, maar vindt chrome niet leuk
var playerColors = [[237, 28, 36], [63, 72, 204], [43, 177, 76],
 [0, 0, 0], [185, 122, 87], [163, 73, 164], [0, 162, 232], [136, 0, 21]];
