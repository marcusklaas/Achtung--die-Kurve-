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
	char **sb;			// sendbuffer
	int sbat;			// sendbuffer at

	float x, y, angle;	// last confirmed (these are thus ~500msec behind)
	int turn;			// -1, 0 or 1

	struct userinput *inputhead, // store unhandled user inputs in queue
					 *inputtail; // insert at tail, remove at head

	struct libwebsocket *wsi; // mag dit?
};

struct usern{			// user node
	struct user *usr;
	struct usern *nxt;
};


void *smalloc(size_t size);
cJSON *getjsongamepars(struct game *gm);
