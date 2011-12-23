#define EPS 0.00000001
#define GAME_WIDTH 800
#define GAME_HEIGHT 400
#define TILE_SIZE_MULTIPLIER 4 // tilesize/ segmentlength
#define VELOCITY 70 // pixels per sec
#define TURN_SPEED 3 // radians per sec
#define HOLE_SIZE 10 // in ticks
#define HOLE_FREQ 100 // number of ticks between holes
#define HOLE_START_MIN 50 // after how many ticks first hole may appear
#define HOLE_START_MAX 200 // after how many ticks first hole must have appeared
#define DEBUG_MODE 1
#define TICK_LENGTH 24 // in msecs
#define SERVER_DELAY 200 // multiple of TICK_LENGTH
#define COUNTDOWN 1008 // multiple of TICK_LENGTH
#define SB_MAX 10	// sendbuffer max size
#define DELTA_COUNT 11
#define DELTA_MAX 25
#define ULTRA_VERBOSE 0
#define SHOW_WARNING 1
#define PRE_PADDING	LWS_SEND_BUFFER_PRE_PADDING
#define POST_PADDING	LWS_SEND_BUFFER_POST_PADDING
#define SEND_SEGMENTS 30 // om de hoeveel ticks het moet gebeuren (0=nooit)
#define SHOW_DELAY 1

/* game states */
#define GS_LOBBY 0
#define GS_STARTED 1

struct seg{
	float x1, y1, x2, y2;
	struct seg *nxt;
};

struct game{
	int n, w, h,			// number of players, width, height
		nmin, nmax,			// desired number of players
		tilew, tileh,		// tile width & height
		htiles, vtiles,		// number of horizontal tiles & vertical tiles
		state,				// game state, see GS_* definitions
		v, ts,				// velocity, turn speed
		tick, alive,		// #ticks that have passed, #alive players
		hsize, hfreq,		// hole size and frequency in ticks
		hmin, hmax;			// min/ max ticks before start of first hole

	long start;			// start time in milliseconds after epoch
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct user *usr;	// user list
	struct game *nxt;
	struct seg *tosend;
};

struct userinput {
	int tick;
	int turn;
	struct userinput *nxt;
};

struct user{
	int id;
	struct game *gm;
	struct user *nxt;

	char *name;			// kan null blijven
	char *sb[SB_MAX];	// sendbuffer
	int sbat;			// sendbuffer at

	float x, y, angle;	// used in simulation (these are thus ~500msec behind)
	int turn;			// -1, 0 or 1
	char alive;			// 1 for alive, 0 else

	int hstart, hsize, hfreq;	// hole start, hole size, hole frequency

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi;
	int delta[DELTA_COUNT];
	int deltaat;
	char deltaon;
};

void *smalloc(size_t size);
void *scalloc(size_t num, size_t size);
cJSON *getjsongamepars(struct game *gm);
