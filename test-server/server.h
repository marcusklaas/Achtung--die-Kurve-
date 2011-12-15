#define EPS 0.001
#define GAME_WIDTH 800
#define GAME_HEIGHT 400
#define TILE_WIDTH 80
#define TILE_HEIGHT 80
#define VELOCITY 90 // pixels per sec
#define TURN_SPEED 3 // radians per sec
#define DEBUG_MODE 1
#define TICK_LENGTH 15 // in msecs
#define SERVER_DELAY 495 // in msecs, preferably veelvoud of TICK_LENGTH
#define COUNTDOWN	3000
#define SB_MAX 10	// sendbuffer max size
#define DELTA_COUNT 6
#define DELTA_MAX 25
#define debug 1
#define showwarning 1
#define lwsprepadding	LWS_SEND_BUFFER_PRE_PADDING
#define lwspostpadding	LWS_SEND_BUFFER_POST_PADDING

/* game states */
#define GS_LOBBY 0
#define GS_STARTED 1

struct seg{
	float x1, y1, x2, y2;
	int uid;		// van welke user dit segment is (miss handig?)
	struct seg *nxt;
};

struct game{
	int n, w, h, 		// number of players, width, height
		nmin, nmax, 	// desired number of players
		tilew, tileh, 	// tile width & height
		htiles, vtiles, // number of horizontal tiles & vertical tiles
		state,			// game state, see GS_* definitions
		v, ts,			// velocity, turn speed
		tick, alive;	// #ticks that have passed, #alive players

	long start;			// start time in milliseconds after epoch
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct usern *usrn;	// user list
	struct game *nxt;
};

struct userinput {
	long time;
	int turn;
	struct userinput *nxt;
};

struct user{
	int id;
	struct game *gm;
	char *name;
	char *sb[SB_MAX];	// sendbuffer
	int sbat;			// sendbuffer at

	float x, y, angle;	// last confirmed (these are thus ~500msec behind)
	int turn;			// -1, 0 or 1

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi;
	int delta[DELTA_COUNT];
	int deltaat;
	char deltaon;
};

struct usern{			// user node
	struct user *usr;
	struct usern *nxt;
};


void *smalloc(size_t size);
cJSON *getjsongamepars(struct game *gm);
