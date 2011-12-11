struct seg{
	float a, b, c, d;	// x1,y1,x2,y2
	int uid;		// van welke user dit segment is (miss handig?)
	struct seg *nxt;
};

struct game{
	int n, w, h, 		// number of players, width, height
		nmin, nmax, 	// desired number of players
		tilew, tileh, 	// tile width & height
		htiles, vtiles, // number of horizontal tiles & vertical tiles
		state;			// game state, 0: waiting for more players, 1: 
	double t;			// start time
	struct seg **seg;	// two dimensional array of linked lists, one for each tile
	struct usern *usrn;	// user list
	struct game *nxt;
} *headgame;

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

static int usrc= 0;	// user count

void startgame(struct game *gm){
	//unsigned char buf[LWS_SEND_BUFFER_PRE_PADDING + 1024 + LWS_SEND_BUFFER_POST_PADDING];
	gm->seg= smalloc(sizeof(struct seg*) * gm->htiles * gm->vtiles);
	
}

void remgame(struct game *gm){
	if(headgame == gm)
		headgame = gm->nxt;
	else {
		struct game *a;
		for(a = headgame; a->nxt != gm; a = a->nxt);
		a->nxt = gm->nxt;
	}

	/* freeing up player nodes. */
	struct usern *next, *current;
	
	for(current = gm->usrn; current; current = next) {
		next = current->nxt;
		free(current);
	}		

	/* freeing up segments */
	if(gm->seg){
		int i, num_tiles = gm->htiles * gm->vtiles;

		for(i=0; i < num_tiles; i++) {
			struct seg *a, *b;

			for(a = gm->seg[i]; a; a = b) {
				b = a->nxt;
				free(a);
			}
		}

		free(gm->seg);
	}

	free(gm);
}

struct game* findgame(int nmin, int nmax) {
	struct game *gm;

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->nmin <= nmax && gm->nmax >= nmin) {
			gm->nmin = (gm->nmin > nmin) ? gm->nmin : nmin;
			gm->nmax = (gm->nmax < nmax) ? gm->nmax : nmax;
			return gm;
		}

	return NULL;
}

void leavegame(struct user *u) {
	struct game *gm;
	struct usern *current, *tmp;
	
	if(!u || !(gm = u->gm))
		return;

	for(current = gm->usrn; current->nxt && current->nxt->usr != u; current = current->nxt);

	// this should never be the case
	if(!current->nxt)
		return;

	tmp = current->nxt;
	current->nxt = tmp->nxt;
	free(tmp);

	if(!--gm->n)
		remgame(gm);

	u->gm = NULL;

	/* TODO: send message to group: this player left */
}

void adduser(struct game *gm, struct user *u) {
	struct usern *current, *new;

	/* TODO: send message to group: we have new player */
	
	for(current = gm->usrn; current->nxt; current = current->nxt);

	new = smalloc(sizeof(struct usern));

	new->usr = u;
	new->nxt = NULL;
	current->nxt = new;
	u->gm = gm;

	if(++gm->n >= gm->nmin)
		startgame(gm);
}

struct game* creategame(int nmin, int nmax) {
	struct game *gm = smalloc(sizeof(struct game));

	gm->nmin = nmin; gm->nmax = nmax;
	gm->t = 0.0;
	gm->n= 0;
	gm->usrn= 0;
	gm->w= 800; gm->h= 800; // FIXME: these numbers should be defined as constant
	gm->tilew= 100; gm->tileh= 100; //ditto
	gm->htiles= gm->w / gm->tilew; gm->vtiles= gm->h / gm->tileh; // FIXME: round up, not down!
	gm->state= gs_lobby;
	gm->nxt = headgame;
	headgame = gm;
	gm->seg = smalloc(gm->htiles * gm->vtiles * sizeof(struct seg));

	return gm;
}

void mainloop(){
	
}
