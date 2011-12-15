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

static struct game *headgame = 0;

#include "helper.c"

static int usrc= 0;	// user count
static long serverstart = 0; // server start in msec since epoch
static unsigned long serverticks = 0; // yes this will underflow, but not fast ;p

void randomizePlayerStarts(struct game *gm, float *buf) {
	// diameter of your circle in pixels when you turn at max rate
	int i, turningCircle = ceil(2.0 * VELOCITY/ TURN_SPEED);

	if(DEBUG_MODE)
		printf("Entered randomization\n");

	for(i = 0; i < gm->n; i++) {
		buf[3 * i] = turningCircle + rand() % (gm->w - 2 * turningCircle);
		buf[3 * i + 1] = turningCircle + rand() % (gm->h - 2 * turningCircle);
		buf[3 * i + 2] = rand() % 618 / 100.0;
	}
}

void startgame(struct game *gm){ 
	if(DEBUG_MODE)
		printf("startgame called!\n");

	float *player_locations = smalloc(3 * gm->n * sizeof(float));
	randomizePlayerStarts(gm, player_locations);

	gm->start = epochmsecs();
	gm->state = GS_STARTED;

	// create JSON object
	cJSON *root = jsoncreate("startGame");
	cJSON *start_locations = cJSON_CreateArray();
	struct usern *usrn;
	struct user *usr;
	int i = 0;

	/* set the players locs and fill json object */
	for(usrn = gm->usrn; usrn; usrn = usrn->nxt) {
		usr = usrn->usr;

		usr->x = player_locations[3 * i];
		usr->y = player_locations[3 * i + 1];
		usr->angle = player_locations[3 * i + 2];

		cJSON *player = cJSON_CreateObject();
		cJSON_AddNumberToObject(player, "playerId", usr->id);
		cJSON_AddNumberToObject(player, "startX", usr->x);
		cJSON_AddNumberToObject(player, "startY", usr->y);
		cJSON_AddNumberToObject(player, "startAngle", usr->angle);
		cJSON_AddItemToArray(start_locations, player);

		i++;
	}

	/* spreading the word to all in the game */
	cJSON_AddItemToObject(root, "startPositions", start_locations);
	sendjsontogame(root, gm, 0);	
	
	free(player_locations);
	jsondel(root);
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

	if(DEBUG_MODE)
		printf("freeing up player nodes\n");
	
	for(current = gm->usrn; current; current = next) {
		next = current->nxt;
		free(current);
	}

	if(DEBUG_MODE)
		printf("freeing up segments\n");

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

	if(DEBUG_MODE)
		printf("freeing up game\n");

	free(gm);

	if(DEBUG_MODE)
		printf("end of remgame\n");
}

struct game *findgame(int nmin, int nmax) {
	struct game *gm;

	if(DEBUG_MODE)
		printf("findgame called \n");

	for(gm = headgame; gm; gm = gm->nxt)
		if(gm->state == GS_LOBBY && gm->nmin <= nmax && gm->nmax >= nmin) {
			gm->nmin = (gm->nmin > nmin) ? gm->nmin : nmin;
			gm->nmax = (gm->nmax < nmax) ? gm->nmax : nmax;
			return gm;
		}

	return NULL;
}

void leavegame(struct user *u) {
	struct game *gm;
	struct usern *current, *tmp;

	if(DEBUG_MODE)
		printf("leavegame called \n");

	if(!u || !(gm = u->gm))
		return;
		
	if(!gm->usrn){
		fprintf(stderr, "no users!\n");
		return;
	}
	
	if(gm->usrn->usr == u){
		tmp= gm->usrn;
		gm->usrn= gm->usrn->nxt;
		free(tmp);
	}else{
		for(current = gm->usrn; current->nxt && current->nxt->usr != u; current = current->nxt);

		// this should never be the case
		if(!current->nxt) {
			printf("this is not possible!\n");
			return;
		}

		tmp = current->nxt;
		current->nxt = tmp->nxt;
		free(tmp);
	}

	if(--gm->n == 0)
		remgame(gm);
	else {
		// send message to group: this player left
		cJSON *json = jsoncreate("playerLeft");
		jsonaddnum(json, "playerId", u->id);
		sendjsontogame(json, gm, 0);
		cJSON_Delete(json);
	}

	u->gm = NULL;	
	
	if(debug) printgames();
}

void joingame(struct game *gm, struct user *u) {
	struct usern *usrn;
	cJSON *json;
	char *lastusedname;

	if(DEBUG_MODE)
		printf("join game called \n");
		
	// tell user s/he joined a game. 
	json= jsoncreate("joinedGame");
	sendjson(json, u);
	jsondel(json);
	
	json= getjsongamepars(gm);
	sendjson(json, u);
	jsondel(json);
	
		
	// tell players of game someone new joined
	json= jsoncreate("newPlayer");
	jsonaddnum(json, "playerId", u->id);
	jsonaddstr(json, "playerName", lastusedname = u->name);
	sendjsontogame(json, gm, 0);

	printf("user %d has name %s\n", u->id, u->name);
	
	// send a message to the new player for every other player that is already in the game
	for(usrn = gm->usrn; usrn; usrn = usrn->nxt) {
		jsonsetint(json, "playerId", usrn->usr->id);
		jsonsetstr(json, "playerName", lastusedname = usrn->usr->name);
		sendjson(json, u);

		printf("user %d has name %s\n", usrn->usr->id, usrn->usr->name);
	}
	
	// here we replace the playername by a duplicate so that the original
	// name doesnt get freed
	jsonsetstr(json, "playerName", duplicatestring(lastusedname));
	jsondel(json);
	
	usrn = smalloc(sizeof(struct usern));
	usrn->usr = u;
	usrn->nxt = gm->usrn;
	gm->usrn = usrn;
	u->gm = gm;

	if(++gm->n >= gm->nmin)
		startgame(gm);
	
	if(debug){
		printf("user %d joined game %p\n", u->id, (void *)gm);
		printgames();
	}
}

struct game *creategame(int nmin, int nmax) {
	struct game *gm = smalloc(sizeof(struct game));

	if(DEBUG_MODE)
		printf("creategame called \n");

	gm->nmin = nmin; gm->nmax = nmax;
	gm->start = 0;
	gm->n = 0;
	gm->usrn = 0;
	gm->tick = 0;
	gm->alive = 0;
	gm->w= GAME_WIDTH;
	gm->h= GAME_HEIGHT;
	gm->tilew = TILE_WIDTH;
	gm->tileh = TILE_HEIGHT;
	gm->htiles= ceil(1.0 * gm->w / gm->tilew);
	gm->vtiles= ceil(1.0 * gm->h / gm->tileh);
	gm->state= GS_LOBBY;
	gm->nxt = headgame;
	gm->v= VELOCITY;
	gm->ts= TURN_SPEED;
	headgame = gm;
	gm->seg = calloc(gm->htiles * gm->vtiles, sizeof(struct seg*));
	if(!gm->seg) {
		printf("Calloc failed in creategame!\n");
		exit(500);
	}

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

// returns 1 if player dies during this tick, 0 otherwise
int simuser(struct user *usr, struct game *gm, long simend) {
	/* usr sent us more than 1 input in a single tick? that's weird! might be
	 * possible though. ignore all but last */
	struct userinput *curr;

	for(curr = usr->inputhead; curr && curr->time <= simend; curr = curr->nxt) {
		usr->turn = curr->turn;
		free(curr);
	}

	struct seg *newseg = smalloc(sizeof(struct seg));
	newseg->nxt = 0;
	newseg->x1 = usr->x;
	newseg->y1 = usr->y;

	// WE TURN FIRST THEN STEP AHEAD!! this important.. i choose this for now
	// because we work in ticks and this somewhat counters the (slight) delay
	usr->angle += usr->turn * gm->ts * TICK_LENGTH / 1000.0;
	usr->x += cos(usr->angle) * gm->v * TICK_LENGTH / 1000.0;
	usr->y += sin(usr->angle) * gm->v * TICK_LENGTH / 1000.0;

	newseg->x2 = usr->x;
	newseg->y2 = usr->y;

	return addsegment(gm, newseg);
}

void simgame(struct game *gm) {
	struct usern *usrn;
	long simend = gm->start +++gm->tick * TICK_LENGTH - SERVER_DELAY;

	if(simend < 0)
		return;

	for(usrn = gm->usrn; usrn; usrn = usrn->nxt)
		gm->alive -= simuser(usrn->usr, gm, simend);

	if(gm->alive <= 1) {
		// TODO: game over! send msg to players who won
		remgame(gm);
	}
}

// FIXME: the mainloop itself is actually in a loop with sleep. this is not
// the 'bedoeling' -- fix this (this may be slightly harder for non-forking
// servers, but they are stupid anyway!!)
void mainloop() {
	int sleeptime;
	struct game *gm;

	while(5000) {
		for(gm = headgame; gm; gm = gm->nxt)
			if(gm->state == GS_STARTED)
				simgame(gm);

		sleeptime = serverstart +++serverticks * TICK_LENGTH - epochmsecs();
		if(sleeptime > 0)
			usleep(1000 * sleeptime);
	}
}

// okay here we handle the msg user sent us. TODO: note that currently we just 
// assume that the inputs in the inputqueue are increasing in time because we use 
// TCP. but client could try to cheat and this may no longer be case!
void interpretinput(cJSON *json, struct user *usr) {
	// put it in user queue
	struct userinput *input = smalloc(sizeof(struct userinput));
	input->time = cJSON_GetObjectItem(json, "gameTime")->valueint;
	input->turn = cJSON_GetObjectItem(json, "turn")->valueint;
	input->nxt = 0;

	if(!usr->inputtail)
		usr->inputhead = usr->inputtail = input;
	else
		usr->inputtail = usr->inputtail->nxt = input; // ingenious or wat

	// TODO: create new json object with some more info (last confirmed x, y, angle + 
	// current gametime), send it to all (even usr?)
	sendjsontogame(json, usr->gm, usr);
	jsondel(json);
}

cJSON *getjsongamepars(struct game *gm){
	cJSON *json= jsoncreate("gameParameters");
	jsonaddnum(json, "w", gm->w);
	jsonaddnum(json, "h", gm->h);
	jsonaddnum(json, "nmin", gm->nmin);
	jsonaddnum(json, "nmax", gm->nmax);
	jsonaddnum(json, "v", gm->v);
	jsonaddnum(json, "ts", gm->ts);
	return json;
}
