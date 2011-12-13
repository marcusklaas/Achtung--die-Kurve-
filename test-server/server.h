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
		v, ts;			// velocity, turn speed
	double t;			// start time
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct usern *usrn;	// user list
	struct game *nxt;
};

struct user{
	int id;
	struct game *gm;
	char *name;
	char **sb;			// sendbuffer
	int sbat;			// sendbuffer at
	struct libwebsocket *wsi; // mag dit?
};

struct usern{			// user node
	struct user *usr;
	struct usern *nxt;
};


void *smalloc(size_t size);
cJSON *getjsongamepars(struct game *gm);
