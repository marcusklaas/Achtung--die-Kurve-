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

#define EPS 0.001
#define GAME_WIDTH 800
#define GAME_HEIGHT 800
#define TILE_WIDTH 80
#define TILE_HEIGHT 80
#define VELOCITY 90
#define TURN_SPEED 3
#define DEBUG_MODE 1

#include "helper.c"

static int usrc= 0;	// user count

void randomizePlayerStarts(struct game *gm, float *buf) {
	// diameter of your circle in pixels when you turn at max rate
	int i, turningCircle = ceil(2 * VELOCITY/ TURN_SPEED);

	for(i = 0; i < gm->n; i++) {
		buf[3 * i] = turningCircle + rand() % (gm->w - 2 * turningCircle);
		buf[3 * i + 1] = turningCircle + rand() % (gm->h - 2 * turningCircle);
		buf[3 * i + 2] = rand() % 618 / 100;
	}
}

void startgame(struct game *gm){
	//unsigned char buf[LWS_SEND_BUFFER_PRE_PADDING + 1024 + LWS_SEND_BUFFER_POST_PADDING];

	if(DEBUG_MODE)
		printf("startgame called!\n");

	float *player_locations = smalloc(3 * gm->n * sizeof(float));
	randomizePlayerStarts(gm, player_locations);

	// create JSON object
	cJSON *root = cJSON_CreateObject();
	cJSON_AddStringToObject(root, "mode", "startGame");

	cJSON *start_locations = cJSON_CreateArray();
	struct usern *usrn;
	int i = 0;

	/* we might SEGFAULT here, but only if gm->n < the actual number of players 
	 * in game */
	for(usrn = gm->usrn; usrn; usrn = usrn->nxt) {
		if(i == gm->n) {
			fprintf(stderr, "\"Nu sta ik voor de ruines van mijn wereldbeeld\"\n");
			exit(300); //exit to prevent imminent SEGFAULT
		}

		cJSON *player = cJSON_CreateObject();
		cJSON_AddNumberToObject(player, "playerId", usrn->usr->id);
		cJSON_AddNumberToObject(player, "startX", player_locations[3 * i]);
		cJSON_AddNumberToObject(player, "startY", player_locations[3 * i + 1]);
		cJSON_AddNumberToObject(player, "startAngle", player_locations[3 * i + 2]);
		cJSON_AddItemToArray(start_locations, player);

		i++;
	}

	/* spreading the word to all in the game */
	sendjsontogame(root, gm, 0);	

	/* TODO: being the server, we probably want to save those
	 * starting positions somewhere as well */

	cJSON_Delete(root);
}

void remgame(struct game *gm){
	if(DEBUG_MODE)
		printf("remgame called\n");

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

	if(DEBUG_MODE)
		printf("findgame called \n");

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
		
	if(!gm->usrn){
		fprintf(stderr, "no users!\n");
		return;
	}

	for(current = gm->usrn; current->nxt && current->nxt->usr != u; current = current->nxt);

	// this should never be the case
	if(!current->nxt) {
		fprintf(stderr, "this is not possible!\n");
		return;
	}

	tmp = current->nxt;
	current->nxt = tmp->nxt;
	free(tmp);

	if(--gm->n == 0)
		remgame(gm);

	u->gm = NULL;

	// send message to group: this player left
	cJSON *json = jsoncreate("playerLeft");
	jsonaddint(json, "playerId", u->id);
}

void joingame(struct game *gm, struct user *u) {
	struct usern *new;
	cJSON *json;

	if(DEBUG_MODE)
		printf("join game called \n");
	
	// tell players of game someone new joined
	json= jsoncreate("newPlayer");
	jsonaddint(json, "playerId", u->id);
	jsonaddstr(json, "playerName", u->name);
	sendjsontogame(json, gm, 0);
	cJSON_Delete(json);

	// TODO: send a message to the new player for every other player
	// that is already in the game
	
	new = smalloc(sizeof(struct usern));

	new->usr = u;
	new->nxt = gm->usrn;
	gm->usrn = new;
	u->gm = gm;

	if(++gm->n >= gm->nmin)
		startgame(gm);
}

struct game* creategame(int nmin, int nmax) {
	struct game *gm = smalloc(sizeof(struct game));

	if(DEBUG_MODE)
		printf("creategame called \n");

	gm->nmin = nmin; gm->nmax = nmax;
	gm->t = 0.0;
	gm->n= 0;
	gm->usrn= 0;
	gm->w= GAME_WIDTH;
	gm->h= GAME_HEIGHT;
	gm->tilew = TILE_WIDTH;
	gm->tileh = TILE_HEIGHT;
	gm->htiles= ceil(gm->w / gm->tilew);
	gm->vtiles= ceil(gm->h / gm->tileh);
	gm->state= gs_lobby;
	gm->nxt = headgame;
	headgame = gm;
	gm->seg = smalloc(gm->htiles * gm->vtiles * sizeof(struct seg*));

	return gm;
}

// returns 1 if collision, 0 if no collision
int segcollision(struct seg *seg1, struct seg *seg2) {
	int denom = (seg1->x1 - seg1->x2) * (seg2->y1 - seg2->y2) -
	 (seg1->y1 - seg1->y2) * (seg2->x1 - seg2->x2);

	int numer_a = (seg2->x2 - seg2->x1) * (seg1->y1 - seg2->y1) -
	 (seg2->y2 - seg2->y1) * (seg1->x1 - seg2->x1);

	int numer_b = (seg1->x2 - seg1->x1) * (seg1->y1 - seg2->y1) -
	 (seg1->y2 - seg1->y1) * (seg1->x1 - seg2->x1);

	/* lines coincide */
	if(abs(numer_a) < EPS && abs(numer_b) < EPS && abs(denom) < EPS)
		return 1;

	/* lines parallel */
	if(abs(denom) < EPS)
		return 0;

	int a = numer_a/ denom;
	int b = numer_b/ denom;

	if(a < 0 || a > 1 || b < 0 || b > 1)
		return 0;

	return 1;
}

// returns 1 in case the segment intersects the box
int lineboxcollision(struct seg *seg, int left, int bottom, int right, int top) {
	/* if the segment intersects box, either both points are in box, 
	 * or there is intersection with the edges. note: this is naive way.
	 * there is probably a more efficient way to do it */

	if(seg->x1 >= left && seg->x1 < right && seg->y1 >= bottom && seg->y1 < top)
		return 1;

	if(seg->x2 >= left && seg->x2 < right && seg->y2 >= bottom && seg->y2 < top)
		return 1;

	struct seg edge;

	/* check intersect left border */
	edge.x1 = edge.x2 = left;
	edge.y1 = bottom;
	edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect right border */
	edge.x1 = edge.x2 = right;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.x1 = left;
	edge.y1 = edge.y2 = top;
	if(segcollision(seg, &edge))
		return 1;

	/* check intersect top border */
	edge.y1 = edge.y2 = bottom;
	if(segcollision(seg, &edge))
		return 1;

	return 0;
}

// returns 1 in case of collision, 0 other wise
int addsegment(struct game *gm, struct seg *seg) {
	int left_tile, right_tile, bottom_tile, top_tile, swap;
	struct seg *current, *copy;

	left_tile = seg->x1/ gm->tilew;
	right_tile = seg->x2/ gm->tilew;
	if(left_tile > right_tile) {
		swap = left_tile; left_tile = right_tile; right_tile = swap;
	}

	bottom_tile = seg->y1/ gm->tileh;
	top_tile = seg->y2/ gm->tileh;
	if(bottom_tile > top_tile) {
		swap = bottom_tile; bottom_tile = top_tile; top_tile = swap;
	}

	for(int i = left_tile; i <= right_tile; i++) {
		for(int j = bottom_tile; j <= top_tile; j++) {
			if(!lineboxcollision(seg, i * gm->tilew, j * gm->tileh,
			 (i + 1) * gm->tilew, (j + 1) * gm->tileh))
				continue;

			for(current = gm->seg[gm->htiles * j + i]; current; current = current->nxt)
				if(segcollision(seg, current))
					return 1;

			copy = smalloc(sizeof(struct seg));
			memcpy(copy, seg, sizeof(struct seg));
			copy->nxt = gm->seg[gm->htiles * j + i];
		}
	}

	// we dont need the original any more: free it
	free(seg);

	return 0;
}

void mainloop(){
	
}
